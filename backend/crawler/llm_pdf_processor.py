"""
LLM-based PDF processor that extracts and categorises text from scripture pages
using Google Gemini, as an alternative to Tesseract OCR.
"""
import json
import logging
import os
import time
import traceback
from concurrent.futures import ThreadPoolExecutor, as_completed

import google.generativeai as genai

from backend.crawler.pdf_processor import PDFProcessor

log_handle = logging.getLogger(__name__)

# Configure Gemini API key from environment
genai.configure(api_key=os.environ.get("GEMINI_API_KEY", ""))

PROMPT = """
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
- "sanskrit_text"
- "prakrit_text"
- "hindi_text"
- "sanskrit_verse"
- "prakrit_verse"
- "hindi_verse"
- "footnote"
- "chapter_heading"

Output a JSON array of objects, each with "type" and "text" keys. Example:
[
  {"type": "chapter_heading", "text": "अध्याय १"},
  {"type": "sanskrit_verse", "text": "ॐ नमो भगवते..."},
  {"type": "hindi_text", "text": "इसका अर्थ है..."},
  {"type": "footnote", "text": "१. यह पाठान्तर है"}
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

        paragraphs = self._generate_paragraphs_llm(
            images, page_numbers, output_ocr_dir, llm_model, llm_workers
        )

        self._write_output_to_file(output_ocr_dir, paragraphs)

        log_handle.info(f"LLM extraction completed for {pdf_file} in {output_ocr_dir}")
        return True

    def _generate_paragraphs_llm(
            self,
            images: list,
            page_numbers: list[int],
            output_ocr_dir: str,
            llm_model: str,
            llm_workers: int
    ) -> list[tuple[int, list]]:
        """
        Runs LLM extraction concurrently using ThreadPoolExecutor.
        I/O-bound (network) so threads are appropriate here.
        """
        tasks = list(zip(page_numbers, images))
        results = []

        log_handle.info(
            f"Starting LLM extraction: {len(tasks)} pages, "
            f"model={llm_model}, workers={llm_workers}"
        )

        with ThreadPoolExecutor(max_workers=llm_workers) as executor:
            future_to_page = {
                executor.submit(self._process_single_page_llm, page_num, image, llm_model): page_num
                for page_num, image in tasks
            }

            for future in as_completed(future_to_page):
                page_num = future_to_page[future]
                try:
                    result = future.result()
                    results.append(result)
                    log_handle.info(f"Completed page {page_num}")
                except Exception as e:
                    log_handle.error(f"Failed to process page {page_num}: {e}")
                    results.append((page_num, []))

        results.sort(key=lambda x: x[0])
        return results

    @staticmethod
    def _process_single_page_llm(page_num: int, image, llm_model: str) -> tuple[int, list]:
        """
        Calls Gemini to extract and categorise text from a single page image.
        Retries with exponential backoff on 429 rate limit errors.
        """
        backoff = _INITIAL_BACKOFF

        for attempt in range(_MAX_RETRIES):
            try:
                model = genai.GenerativeModel(llm_model)
                response = model.generate_content(
                    [PROMPT, image],
                    generation_config={"response_mime_type": "application/json"}
                )
                blocks = json.loads(response.text)
                log_handle.info(
                    f"Page {page_num}: extracted {len(blocks)} blocks "
                    f"(attempt {attempt + 1})"
                )
                return page_num, blocks

            except Exception as e:
                error_str = str(e)
                is_rate_limit = "429" in error_str or "quota" in error_str.lower()

                if is_rate_limit and attempt < _MAX_RETRIES - 1:
                    log_handle.warning(
                        f"Page {page_num}: rate limited (attempt {attempt + 1}). "
                        f"Retrying in {backoff}s..."
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
            if not blocks:
                log_handle.warning(f"No blocks for page {page_num}, skipping write")
                continue
            fname = f"{output_ocr_dir}/page_{page_num:04d}.json"
            try:
                with open(fname, 'w', encoding='utf-8') as fh:
                    json.dump(blocks, fh, ensure_ascii=False, indent=2)
                log_handle.info(f"Written {fname}")
            except IOError as e:
                log_handle.error(f"Failed to write {fname}: {e}")

    # Tesseract-specific methods — not used by this processor
    def _generate_paragraphs(self, pdf_file, page_list, scan_config, language):
        raise NotImplementedError("LLMPDFProcessor uses _generate_paragraphs_llm instead")

    @staticmethod
    def _process_single_page(args):
        raise NotImplementedError("LLMPDFProcessor uses _process_single_page_llm instead")