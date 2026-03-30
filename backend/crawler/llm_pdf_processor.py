"""
LLM-based PDF processor that extracts and categorises text from scripture pages
using Google Gemini, as an alternative to Tesseract OCR.
"""
import json
import logging
import os
import threading
import time
import traceback
from concurrent.futures import ThreadPoolExecutor, as_completed
from tqdm import tqdm

from google import genai
from google.genai import types

from backend.crawler.pdf_processor import PDFProcessor

log_handle = logging.getLogger(__name__)

# Thread-local storage so each worker thread gets its own genai.Client.
# A single shared client is not thread-safe because its underlying async
# HTTP transport can be closed by one thread while another is mid-request.
_thread_local = threading.local()


def _get_gemini_client():
    if not getattr(_thread_local, "client", None):
        api_key = os.environ.get("GEMINI_API_KEY", "")
        if not api_key:
            raise ValueError("GEMINI_API_KEY environment variable is not set")
        _thread_local.client = genai.Client(api_key=api_key)
    return _thread_local.client


def extract_indic_text(image, model_name: str = "gemini-2.5-flash") -> list:
    """
    Extract and categorise text blocks from a Jain scripture image using Gemini.

    Public API — used by eval/api.py for single-page extraction.
    Delegates to LLMPDFProcessor._process_single_page_llm for consistency.

    Args:
        image: PIL.Image object of the page
        model_name: Gemini model to use

    Returns:
        List of dicts with "type" and "text" keys
    """
    _, blocks = LLMPDFProcessor._process_single_page_llm(0, image, model_name)
    return blocks

# Canonical list of all block types produced by LLMPDFProcessor.
# Used in the prompt below, in the classifier API, and in the eval UI.
BLOCK_TYPES = [
    "sanskrit_text",
    "prakrit_text",
    "hindi_text",
    "sanskrit_verse",
    "prakrit_verse",
    "hindi_verse",
    "footnote",
    "chapter_heading",
]

_BLOCK_TYPES_BULLET_LIST = "\n".join(f'- "{t}"' for t in BLOCK_TYPES)

PROMPT = f"""
The attached image is from a Jain Scripture. It has different types of text:

- Sanskrit text (often separated by lines or in blocks)
- Prakrit Verses
- Sanskrit Verses
- Hindi Verses
- Hindi text (which may contain sanskrit or prakrit words in brackets)
- Footnotes (usually at the bottom with smaller text or marked with small numbers)
- Chapter headings (will be in bigger font)

Your job is to parse the image and categorise each block of text into one of the above categories.

Valid values for "type":
{_BLOCK_TYPES_BULLET_LIST}

Output a JSON array of objects, each with "type" and "text" keys. Example:
[
  {{"type": "chapter_heading", "text": "अध्याय १"}},
  {{"type": "sanskrit_verse", "text": "ॐ नमो भगवते..."}},
  {{"type": "hindi_text", "text": "इसका अर्थ है..."}},
  {{"type": "footnote", "text": "१. यह पाठान्तर है"}}
]

Preserve the order in which the text appears on the page. Output ONLY the JSON array.
"""

# Retry settings for Gemini API rate limiting
_MAX_RETRIES = 5
_INITIAL_BACKOFF = 10  # seconds


class LLMPDFProcessor(PDFProcessor):
    """
    LLM-based PDF processor using Google Gemini for text extraction.

    Extends PDFProcessor, reusing _get_image() for PDF→PIL rendering.
    Replaces Tesseract OCR with Gemini LLM calls via ThreadPoolExecutor
    to respect API rate limits (especially free tier ~10 RPM).
    """

    def __init__(self, config, llm_model: str = None, llm_workers: int = None):
        super().__init__(config)
        self._llm_model = llm_model or config.DEFAULT_LLM_MODEL
        self._llm_workers = llm_workers or config.LLM_WORKERS

    def get_output_file_extension(self) -> str:
        return ".json"

    def process_pdf(self, pdf_file: str, scan_config: dict, pages_list: list[int]):
        """
        Override: does not delete existing output dir.
        Only processes pages whose output file is missing (resume-safe).
        """
        if not os.path.exists(pdf_file):
            raise FileNotFoundError(f"Error: File {pdf_file} not found.")

        relative_pdf_path = os.path.relpath(pdf_file, self._base_pdf_folder)
        output_ocr_dir = f"{self._base_ocr_folder}/{os.path.splitext(relative_pdf_path)[0]}"
        log_handle.info(f"Output OCR directory: {output_ocr_dir}")

        os.makedirs(output_ocr_dir, exist_ok=True)

        # Determine which pages still need processing
        missing_pages = [
            p for p in pages_list
            if not os.path.exists(f"{output_ocr_dir}/page_{p:04d}.json")
        ]

        if not missing_pages:
            log_handle.info(f"All {len(pages_list)} pages already processed in {output_ocr_dir}")
            return True

        log_handle.info(
            f"Processing {len(missing_pages)}/{len(pages_list)} missing pages "
            f"for {pdf_file} using LLM model {self._llm_model}"
        )

        # Get model/worker overrides from scan_config
        llm_model = scan_config.get("llm_model", self._llm_model)
        llm_workers = scan_config.get("llm_workers", self._llm_workers)

        images, page_numbers = self._get_image(pdf_file, missing_pages, scan_config)

        _, failed_pages = self._generate_paragraphs_llm(
            images, page_numbers, llm_model, llm_workers, output_ocr_dir
        )

        if failed_pages:
            log_handle.error(
                f"LLM extraction completed with {len(failed_pages)} failed page(s) for {pdf_file}: {failed_pages}. "
                f"IndexState will NOT be updated — re-run to retry."
            )
            return False

        log_handle.info(f"LLM extraction completed for {pdf_file} in {output_ocr_dir}")
        return True

    def _generate_paragraphs_llm(
            self,
            images: list,
            page_numbers: list[int],
            llm_model: str,
            llm_workers: int,
            output_ocr_dir: str,
    ) -> tuple[list, list]:
        """
        Runs LLM extraction concurrently using ThreadPoolExecutor.
        I/O-bound (network) so threads are appropriate here.
        """
        tasks = list(zip(page_numbers, images))
        results = []
        failed_pages = []

        log_handle.info(
            f"Starting LLM extraction: {len(tasks)} pages, "
            f"model={llm_model}, workers={llm_workers}"
        )

        with ThreadPoolExecutor(max_workers=llm_workers) as executor:
            future_to_page = {
                executor.submit(self._process_single_page_llm, page_num, image, llm_model): page_num
                for page_num, image in tasks
            }

            for future in tqdm(as_completed(future_to_page), total=len(tasks), desc="LLM Pages"):
                page_num = future_to_page[future]
                try:
                    page_num, blocks = future.result()
                    if blocks:
                        self._write_output_to_file(output_ocr_dir, [(page_num, blocks)])
                        results.append((page_num, blocks))
                    else:
                        log_handle.info(f"Page {page_num}: returned empty blocks (blank page), marking as success")
                        self._write_output_to_file(output_ocr_dir, [(page_num, blocks)])
                        results.append((page_num, blocks))
                except Exception as e:
                    log_handle.error(f"Failed to process page {page_num}: {e}")
                    failed_pages.append(page_num)

        results.sort(key=lambda x: x[0])
        log_handle.info(
            f"LLM extraction summary: {len(results)}/{len(tasks)} pages succeeded, "
            f"{len(failed_pages)} failed"
        )
        return results, failed_pages

    @staticmethod
    def _process_single_page_llm(page_num: int, image, llm_model: str) -> tuple[int, list]:
        """
        Calls Gemini to extract and categorise text from a single page image.
        Retries with exponential backoff on 429 rate limit errors.
        """
        backoff = _INITIAL_BACKOFF

        for attempt in range(_MAX_RETRIES):
            try:
                response = _get_gemini_client().models.generate_content(
                    model=llm_model,
                    contents=[PROMPT, image],
                    config=types.GenerateContentConfig(
                        response_mime_type="application/json"
                    )
                )
                raw = response.text
                if raw is None:
                    raise ValueError("Gemini returned None response text (possible safety block or transient error)")
                blocks = json.loads(raw)
                log_handle.info(
                    f"Page {page_num}: extracted {len(blocks)} blocks "
                    f"(attempt {attempt + 1})"
                )
                return page_num, blocks

            except Exception as e:
                error_str = str(e)
                is_rate_limit = "429" in error_str or "quota" in error_str.lower()

                if attempt < _MAX_RETRIES - 1:
                    log_handle.warning(
                        f"Page {page_num}: {'rate limited' if is_rate_limit else 'transient error'} "
                        f"(attempt {attempt + 1}): {e}. Retrying in {backoff}s..."
                    )
                    time.sleep(backoff)
                    backoff *= 2
                else:
                    log_handle.error(
                        f"Page {page_num}: failed after {attempt + 1} attempts: {e}"
                    )
                    traceback.print_exc()
                    return page_num, []

        return page_num, []

    def _write_output_to_file(self, output_ocr_dir: str, paragraphs: list[tuple[int, list]]):
        """
        Writes LLM extraction results as JSON arrays to page_%04d.json files.
        """
        for page_num, blocks in paragraphs:
            fname = f"{output_ocr_dir}/page_{page_num:04d}.json"
            try:
                with open(fname, 'w', encoding='utf-8') as fh:
                    json.dump(blocks, fh, ensure_ascii=False, indent=2)
                log_handle.info(f"Written {fname}")
            except IOError as e:
                log_handle.error(f"Failed to write {fname}: {e}")

    def read_paragraphs(self, ocr_dir: str, pages_list: list[int]) -> list[tuple[int, list[dict]]]:
        """
        Reads LLM-extracted JSON files and returns typed block lists per page.

        Args:
            ocr_dir: Directory containing page_NNNN.json files
            pages_list: List of page numbers to read

        Returns:
            List of (page_num, blocks) where blocks is a list of
            {"type": str, "text": str} dicts as written by _write_output_to_file
        """
        pages = []
        for page_num in pages_list:
            ocr_file = f"{ocr_dir}/page_{page_num:04d}.json"
            try:
                with open(ocr_file, 'r', encoding='utf-8') as fh:
                    blocks = json.load(fh)
                pages.append((page_num, blocks))
            except (IOError, json.JSONDecodeError) as e:
                log_handle.error(f"Could not read {ocr_file}: {e}")
        return pages

    # Tesseract-specific methods — not used by this processor
    def _generate_paragraphs(self, pdf_file, page_list, scan_config, language):
        raise NotImplementedError("LLMPDFProcessor uses _generate_paragraphs_llm instead")

    @staticmethod
    def _process_single_page(args):
        raise NotImplementedError("LLMPDFProcessor uses _process_single_page_llm instead")