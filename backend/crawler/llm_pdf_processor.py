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

from backend.common.language import languages_in
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


def extract_indic_text(image, model_name: str = "gemini-2.5-flash", language: str = "hi") -> list:
    """
    Extract and categorise text blocks from a Jain scripture image using Gemini.

    Public API — used by eval/api.py for single-page extraction.
    Delegates to LLMPDFProcessor._process_single_page_llm for consistency.

    Args:
        image: PIL.Image object of the page
        model_name: Gemini model to use
        language: scan_config-style language hint ("hi", "gu", "hi+gu", "dhundhari");
                   selects which prompt is sent, see select_prompt()

    Returns:
        List of dicts with "type" and "text" keys (plus "original_text" for
        Dhundhari-register hindi_text/hindi_verse blocks when language="dhundhari")
    """
    _, blocks = LLMPDFProcessor._process_single_page_llm(0, image, model_name, language=language)
    return blocks

# Canonical list of all block types produced by LLMPDFProcessor.
# Used in the prompts below, in the classifier API, and in the eval UI.
# Prose/verse types are per language (hindi_*/gujarati_*); which of them a
# given prompt offers depends on the book's language, see _build_prompt().
BLOCK_TYPES = [
    "sanskrit_text",
    "prakrit_text",
    "hindi_text",
    "gujarati_text",
    "sanskrit_verse",
    "prakrit_verse",
    "hindi_verse",
    "gujarati_verse",
    "footnote",
    "chapter_heading",
]

# Per-language wording for the prompt. Keys are normalized language keys
# (backend.common.language.languages_in).
_LANG_SPEC = {
    "hi": {
        "name": "Hindi",
        "text_type": "hindi_text",
        "verse_type": "hindi_verse",
        "heading_ex": "अध्याय १",
        "text_ex": "इसका अर्थ है...",
        "footnote_ex": "१. यह पाठान्तर है",
    },
    "gu": {
        "name": "Gujarati",
        "text_type": "gujarati_text",
        "verse_type": "gujarati_verse",
        "heading_ex": "અધ્યાય ૧",
        "text_ex": "આનો અર્થ આ છે...",
        "footnote_ex": "૧. આ પાઠાંતર છે",
    },
}


def _types_for(langs: list) -> list:
    """BLOCK_TYPES minus the prose/verse types of languages not in `langs`."""
    excluded = {
        t
        for lang, spec in _LANG_SPEC.items() if lang not in langs
        for t in (spec["text_type"], spec["verse_type"])
    }
    return [t for t in BLOCK_TYPES if t not in excluded]


def _bullet_list(types: list) -> str:
    return "\n".join(f'- "{t}"' for t in types)


def _build_prompt(langs: list) -> str:
    """
    Extraction prompt for a book in the given language(s) — ["hi"], ["gu"] or
    ["hi", "gu"]. Sanskrit/Prakrit/footnote/heading handling is identical for
    all; only the Hindi/Gujarati prose and verse categories vary.
    """
    specs = [_LANG_SPEC[lang] for lang in langs]
    names = " and ".join(sp["name"] for sp in specs)
    verse_lines = "\n".join(f"- {sp['name']} Verses" for sp in specs)
    text_lines = "\n".join(
        f"- {sp['name']} text (which may contain sanskrit or prakrit words in brackets)"
        for sp in specs
    )
    mixed_note = ""
    if len(specs) > 1:
        mixed_note = (
            "\nThis book mixes Hindi and Gujarati. Tag each block by the language it is "
            "actually written in (Devanagari script → Hindi, Gujarati script → Gujarati), "
            "not by the language of the rest of the page.\n"
        )
    # Hindi-only books keep the original prompt wording untouched. Gujarati books
    # need explicit script rules: the model otherwise drifts into Devanagari for
    # Gujarati prose (and into Gujarati script for Sanskrit).
    script_note = ""
    if "gu" in langs:
        devanagari_types = ", ".join(
            f'"{t}"' for t in _types_for(langs) if t.split("_")[0] in ("sanskrit", "prakrit", "hindi")
        )
        script_note = f"""
Script rules. Copy each block's script exactly as printed on the page, and never transliterate one script into the other:
- "gujarati_text" and "gujarati_verse" must be in Gujarati script.
- {devanagari_types} must be in Devanagari script, even when the rest of the page is in Gujarati script.
- "footnote" and "chapter_heading": keep each word in the script it is printed in.
- Inside a Gujarati block, Sanskrit or Prakrit terms in brackets or quotes stay in Devanagari as printed; every other word of the sentence must be in Gujarati script.
Wrong (Gujarati words written in Devanagari): "राजाए पण कहुं, “शुं सत्यघोषने चोरी संभव छे?”"
Right (Gujarati script): "રાજાએ પણ કહ્યું, “શું સત્યઘોષને ચોરી સંભવ છે?”"
"""

    heading = f'  {{{{"type": "chapter_heading", "text": "{specs[0]["heading_ex"]}"}}}},'
    sanskrit = '  {{"type": "sanskrit_verse", "text": "ॐ नमो भगवते..."}},'
    prose = [f'  {{{{"type": "{sp["text_type"]}", "text": "{sp["text_ex"]}"}}}},' for sp in specs]
    footnote = f'  {{{{"type": "footnote", "text": "{specs[0]["footnote_ex"]}"}}}}'
    if "gu" in langs:
        # Gujarati example first, so the Devanagari Sanskrit example doesn't set the tone.
        examples = [heading, *prose, sanskrit, footnote]
    else:
        examples = [heading, sanskrit, *prose, footnote]
    examples_block = "\n".join(examples).replace("{{", "{").replace("}}", "}")

    return f"""
The attached image is from a Jain Scripture. It has different types of text:

- Sanskrit text (often separated by lines or in blocks)
- Prakrit Verses
- Sanskrit Verses
{verse_lines}
{text_lines}
- Footnotes (usually at the bottom with smaller text or marked with small numbers)
- Chapter headings (will be in bigger font)
{mixed_note}
Your job is to parse the image and categorise each block of text into one of the above categories.
{script_note}
Valid values for "type":
{_bullet_list(_types_for(langs))}

Output a JSON array of objects, each with "type" and "text" keys. Example:
[
{examples_block}
]

Preserve the order in which the text appears on the page. Output ONLY the JSON array.
"""


# Default (Hindi) prompt, kept as a module constant for callers that import it.
PROMPT = _build_prompt(["hi"])

_HINDI_BULLET_LIST = _bullet_list(_types_for(["hi"]))

# Dhundhari mode — used only when scan_config.json's "language" is "dhundhari".
# Older commentaries in this collection mix an archaic Rajasthani/Marwari-inflected
# register of Hindi ("Dhundhari") with plain modern Hindi (e.g. the Prastavana is
# often plain Hindi even in an otherwise-Dhundhari book) and Sanskrit/Prakrit verses.
#
# Deliberately reuses the Hindi prompt's exact "type" enum — a Dhundhari block is
# still tagged "hindi_text"/"hindi_verse", with the natural modern-Hindi rendering
# in "text" (as always) and the archaic original in an extra "original_text" field.
# That keeps every downstream consumer (paragraph/verse generators, indexing) able
# to treat this book exactly like any other Hindi book with zero code changes —
# "original_text" is just an inert extra key nothing else reads.
PROMPT_DHUNDHARI = f"""
The attached image is from a Jain Scripture. It has different types of text:

- Sanskrit text (often separated by lines or in blocks)
- Prakrit Verses
- Sanskrit Verses
- Hindi Verses
- Hindi text (which may contain sanskrit or prakrit words in brackets)
- Footnotes (usually at the bottom with smaller text or marked with small numbers)
- Chapter headings (will be in bigger font)

Some of the Hindi text/verses in this book are written in an archaic
Rajasthani/Marwari-inflected register called Dhundhari, e.g. "kahiye", "bahuri",
"jātaiṁ", "kāhūkai", "tinahīkūṃ", "yākai" where modern Hindi would use "kehte
hain", "phir", "jisase", "kisi", "unako", "usaka". This book mixes such Dhundhari
commentary with plain modern Hindi — for example, the Prastavana/introduction is
often plain Hindi even when the rest of the book is Dhundhari — so judge each
block on its own merits; do not assume a block is Dhundhari just because other
blocks on the page or other pages of the book are.

Your job is to parse the image and categorise each block of text into one of the
categories below. For a block written in the Dhundhari register, still tag it
"hindi_text" or "hindi_verse" as appropriate, but put a natural, modern Hindi
rendering of it in "text" and the original archaic Dhundhari wording verbatim in
an additional "original_text" field. For a block already in plain modern Hindi
(or any other category), do not add "original_text".

Valid values for "type":
{_HINDI_BULLET_LIST}

Output a JSON array of objects, each with "type" and "text" keys, plus an
"original_text" key only for Dhundhari-register "hindi_text"/"hindi_verse"
blocks. Example:
[
  {{"type": "chapter_heading", "text": "अध्याय १"}},
  {{"type": "sanskrit_verse", "text": "ॐ नमो भगवते..."}},
  {{"type": "hindi_text", "text": "यहाँ कोई कहता है...", "original_text": "इहां कोई कहिये..."}},
  {{"type": "hindi_text", "text": "प्रस्तावना में यह स्पष्ट है कि..."}},
  {{"type": "footnote", "text": "१. यह पाठान्तर है"}}
]

Preserve the order in which the text appears on the page. Output ONLY the JSON array.
"""

def select_prompt(language: str | None) -> str:
    """
    Picks the extraction prompt for a scan_config-style language value:
    "hi"/"hin", "gu"/"guj", a mix such as "hi+gu" or "gu+hi", or "dhundhari"
    (Hindi commentary in an archaic register, see PROMPT_DHUNDHARI).
    Unrecognized values get the Hindi prompt.
    """
    if (language or "").lower() == "dhundhari":
        return PROMPT_DHUNDHARI
    return _build_prompt(languages_in(language))


# Retry settings for Gemini API rate limiting
_MAX_RETRIES = 5
_INITIAL_BACKOFF = 2  # seconds


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
        self._fallback_model = config.SECONDARY_LLM_MODEL
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
        language = scan_config.get("language", "hi")

        images, page_numbers = self._get_image(pdf_file, missing_pages, scan_config)

        _, failed_pages = self._generate_paragraphs_llm(
            images, page_numbers, llm_model, llm_workers, output_ocr_dir, language
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
            language: str = "hi",
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
            f"model={llm_model}, workers={llm_workers}, language={language}"
        )

        with ThreadPoolExecutor(max_workers=llm_workers) as executor:
            future_to_page = {
                executor.submit(
                    self._process_single_page_llm, page_num, image, llm_model, self._fallback_model, language
                ): page_num
                for page_num, image in tasks
            }

            for future in tqdm(as_completed(future_to_page), total=len(tasks), desc="LLM Pages"):
                page_num = future_to_page[future]
                try:
                    page_num, blocks = future.result()
                    if blocks is None:
                        failed_pages.append(page_num)
                    else:
                        if not blocks:
                            log_handle.info(f"Page {page_num}: empty blocks (blank page), marking as success")
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
    def _try_single_model(image, model_name: str, num_tries: int = _MAX_RETRIES, language: str = "hi") -> list | None:
        """
        Attempts to extract text blocks from a page image using a single model.
        Retries with exponential backoff up to num_tries times.

        Returns:
            list of blocks on success (may be empty for blank pages),
            None on total failure.
        """
        backoff = _INITIAL_BACKOFF
        prompt = select_prompt(language)

        for attempt in range(num_tries):
            try:
                response = _get_gemini_client().models.generate_content(
                    model=model_name,
                    contents=[prompt, image],
                    config=types.GenerateContentConfig(
                        response_mime_type="application/json"
                    )
                )
                raw = response.text
                if raw is None:
                    raise ValueError("Gemini returned None response text (possible safety block or transient error)")
                return json.loads(raw)

            except Exception as e:
                error_str = str(e)
                if "404" in error_str:
                    log_handle.warning(f"Model {model_name} not found (404), giving up on this model.")
                    return None
                is_rate_limit = "429" in error_str or "quota" in error_str.lower()
                if attempt < num_tries - 1:
                    log_handle.warning(
                        f"Model {model_name}: {'rate limited' if is_rate_limit else 'transient error'} "
                        f"(attempt {attempt + 1}): {e}. Retrying in {backoff}s..."
                    )
                    time.sleep(backoff)
                    backoff *= 2
                else:
                    log_handle.error(f"Model {model_name}: failed after {attempt + 1} attempts: {e}")
                    traceback.print_exc()

        return None

    @staticmethod
    def _process_single_page_llm(
            page_num: int, image, llm_model: str, fallback_model: str = None, language: str = "hi"
    ) -> tuple[int, list]:
        """
        Calls Gemini to extract and categorise text from a single page image.
        Falls back to fallback_model if the primary model fails entirely.
        """
        blocks = LLMPDFProcessor._try_single_model(image, llm_model, language=language)
        if blocks is not None:
            log_handle.info(f"Page {page_num}: extracted {len(blocks)} blocks via {llm_model}")
            return page_num, blocks

        if fallback_model:
            log_handle.warning(
                f"Page {page_num}: primary model {llm_model} failed, switching to {fallback_model}"
            )
            blocks = LLMPDFProcessor._try_single_model(image, fallback_model, language=language)
            if blocks is not None:
                log_handle.info(f"Page {page_num}: extracted {len(blocks)} blocks via {fallback_model}")
                return page_num, blocks

        log_handle.error(f"Page {page_num}: all models failed, skipping.")
        return page_num, None

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