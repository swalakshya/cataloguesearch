"""
MultiPagePDFProcessor: handles PDFs where each physical page contains two logical pages
side-by-side (e.g. scanned book spreads).

Each PDF page is split vertically at split_percentage, and each half is OCR-processed
independently using the inner processor (LLM or Tesseract). Output files are named by
logical page number so the downstream pipeline (ParagraphGenerator, IndexGenerator)
requires no changes.

A page_mapping.json sidecar file is written to ocr_dir mapping logical page numbers to
PDF page numbers, enabling "View PDF" to open the correct PDF page.
"""
import json
import logging
import os

from PIL import Image

from backend.crawler.advanced_pdf_processor import AdvancedPDFProcessor
from backend.crawler.llm_pdf_processor import LLMPDFProcessor

log_handle = logging.getLogger(__name__)


class MultiPagePDFProcessor:
    """
    Wraps an inner PDFProcessor (LLMPDFProcessor or AdvancedPDFProcessor) and adds
    vertical page splitting, mapping each PDF page to two logical pages.

    Configuration (from scan_config):
        split_percentage  (int,  default 50):     % from left where the vertical split occurs
        book_start_page   (int,  default 1):      PDF page number where the book content begins;
                                                  logical page 1 is the primary half of this page
        book_start_side   (str,  default "left"): which physical side of book_start_page carries
                                                  logical page 1 ("left" or "right")
    """

    PAGE_MAPPING_FILE = "page_mapping.json"

    def __init__(self, inner_processor, scan_config: dict):
        self._inner = inner_processor
        self._split_percentage = scan_config.get("split_percentage", 50)
        # start_page doubles as the PDF range start and the logical page anchor.
        # start_side replaces first_page_side; fall back to first_page_side for
        # backward compatibility with existing scan_config.json files.
        self._book_start_page = scan_config.get("book_start_page", 1)
        self._book_start_side = scan_config.get("book_start_side", "left")

    def get_output_file_extension(self) -> str:
        return self._inner.get_output_file_extension()

    @property
    def inner_processor(self):
        """Return the unwrapped inner processor (no expand_pages)."""
        return self._inner

    def expand_pages(self, pdf_pages: list[int]) -> list[int]:
        """Map a list of 1-based PDF page numbers to their logical page numbers."""
        logical = []
        for pdf_page in pdf_pages:
            left, right = self._logical_pages(pdf_page)
            logical.extend([p for p in [left, right] if p > 0])
        return logical

    def expand_pages_with_bounds(
        self,
        pdf_pages: list[int],
        start_page: int,
        start_side: str,
        end_page: int,
        end_side: str,
    ) -> list[int]:
        """
        Like expand_pages() but respects start/end side boundaries for sub-sections.

        For a sub-section that begins mid-page (e.g. right side of PDF page 10) or
        ends mid-page (e.g. left side of PDF page 20), this ensures only the correct
        logical pages are included — preventing overlap between adjacent sub-sections.

        start_side: 'left'|'right' — which side of start_page is the first logical page
        end_side:   'left'|'right' — which side of end_page is the last logical page
        """
        result = []
        for pdf_page in pdf_pages:
            left, right = self._logical_pages(pdf_page)
            side_map = {"left": left, "right": right}

            start_lp = side_map[start_side] if pdf_page == start_page else None
            end_lp   = side_map[end_side]   if pdf_page == end_page   else None

            for lp in [left, right]:
                if lp <= 0:
                    continue
                if start_lp is not None and lp < start_lp:
                    continue
                if end_lp is not None and lp > end_lp:
                    continue
                result.append(lp)

        return result

    def process_pdf(
        self,
        pdf_file: str,
        scan_config: dict,
        pages_list: list[int],
        allowed_logical_pages: set[int] | None = None,
    ) -> bool:
        """
        Process a PDF where each physical page contains two logical pages.

        pages_list: 1-based PDF page numbers to process.
        allowed_logical_pages: optional set of logical page numbers to write.
          When provided, any half whose logical page number is not in the set is
          silently skipped.  Use this to enforce sub-section side boundaries
          (e.g. only write logical page 146, not 147, for the last physical page).
        Writes page_{logical:04d}<ext> for each half and updates page_mapping.json.
        """
        if not os.path.exists(pdf_file):
            raise FileNotFoundError(f"File not found: {pdf_file}")

        relative_pdf_path = os.path.relpath(pdf_file, self._inner._base_pdf_folder)
        output_ocr_dir = (
            f"{self._inner._base_ocr_folder}/{os.path.splitext(relative_pdf_path)[0]}"
        )
        os.makedirs(output_ocr_dir, exist_ok=True)

        ext = self.get_output_file_extension()

        # Only process PDF pages where at least one logical half is missing
        pages_to_process = []
        for pdf_page in pages_list:
            lp_left, lp_right = self._logical_pages(pdf_page)
            left_exists = (
                lp_left <= 0
                or os.path.exists(f"{output_ocr_dir}/page_{lp_left:04d}{ext}")
            )
            right_exists = (
                lp_right <= 0
                or os.path.exists(f"{output_ocr_dir}/page_{lp_right:04d}{ext}")
            )
            if not (left_exists and right_exists):
                pages_to_process.append(pdf_page)

        if not pages_to_process:
            log_handle.info(
                f"All {len(pages_list)} PDF pages already processed in {output_ocr_dir}"
            )
            return True

        log_handle.info(
            f"Processing {len(pages_to_process)}/{len(pages_list)} PDF pages "
            f"(split_percentage={self._split_percentage}, "
            f"start_side={self._book_start_side})"
        )

        images, pdf_page_numbers = self._inner._get_image(
            pdf_file, pages_to_process, scan_config
        )

        page_mapping = self._load_page_mapping(output_ocr_dir)
        failed = False

        for pdf_page, image in zip(pdf_page_numbers, images):
            left_img, right_img = self._split_image(image)
            lp_left, lp_right = self._logical_pages(pdf_page)

            # Respect side-boundary filter when provided
            write_left = lp_left > 0 and (
                allowed_logical_pages is None or lp_left in allowed_logical_pages
            )
            write_right = lp_right > 0 and (
                allowed_logical_pages is None or lp_right in allowed_logical_pages
            )

            ok1 = self._ocr_and_write(left_img, lp_left, scan_config, output_ocr_dir) if write_left else True
            ok2 = self._ocr_and_write(right_img, lp_right, scan_config, output_ocr_dir) if write_right else True

            # Update mapping per-half so a successfully written half is never
            # orphaned (file on disk but no mapping entry) when the other half
            # fails.  Save after every PDF page regardless of partial failure.
            if ok1 and write_left:
                page_mapping[str(lp_left)] = pdf_page
            if ok2 and write_right:
                page_mapping[str(lp_right)] = pdf_page
            self._save_page_mapping(output_ocr_dir, page_mapping)

            if not ok1 or not ok2:
                log_handle.error(
                    f"PDF page {pdf_page}: OCR failed for one or both halves "
                    f"(logical pages {lp_left}, {lp_right})"
                )
                failed = True
        return not failed

    def read_paragraphs(self, ocr_dir: str, pages_list: list[int]):
        """Delegate to inner processor. pages_list must be logical page numbers."""
        return self._inner.read_paragraphs(ocr_dir, pages_list)

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    def _logical_pages(self, pdf_page: int) -> tuple[int, int]:
        """
        Return (left_logical, right_logical) for a 1-based PDF page number.

        Reading order within every spread is always left → right.
        book_start_side controls only the offset on the very first PDF page:

        book_start_side="left":  both halves of book_start_page are book pages.
          e.g. book_start_page=1: page1→(1,2), page2→(3,4)

        book_start_side="right": only the right half of book_start_page is a book page.
          left=0 for book_start_page signals "no left page" and is filtered by callers.
          e.g. book_start_page=5: page5→(0,1), page6→(2,3), page7→(4,5)
        """
        if self._book_start_side == "right":
            left = (pdf_page - self._book_start_page) * 2
        else:
            left = (pdf_page - self._book_start_page) * 2 + 1
        return left, left + 1

    def _split_image(self, image: Image.Image) -> tuple[Image.Image, Image.Image]:
        """
        Split image vertically at split_percentage.
        Always returns (left_half, right_half) matching the (left, right) logical page order.
        """
        width, height = image.size
        split_x = int(width * self._split_percentage / 100)
        left_half = image.crop((0, 0, split_x, height))
        right_half = image.crop((split_x, 0, width, height))
        return left_half, right_half

    def _ocr_and_write(
        self, image: Image.Image, logical_page: int,
        scan_config: dict, ocr_dir: str
    ) -> bool:
        """Run OCR on a half-image and write the result file. Returns True on success."""
        if isinstance(self._inner, LLMPDFProcessor):
            return self._ocr_llm(image, logical_page, scan_config, ocr_dir)
        elif isinstance(self._inner, AdvancedPDFProcessor):
            return self._ocr_tesseract(image, logical_page, scan_config, ocr_dir)
        log_handle.error(f"Unsupported inner processor type: {type(self._inner)}")
        return False

    def _ocr_llm(self, image, logical_page: int, scan_config: dict, ocr_dir: str) -> bool:
        llm_model = scan_config.get("llm_model", self._inner._llm_model)
        page_num, blocks = LLMPDFProcessor._process_single_page_llm(
            logical_page, image, llm_model
        )
        if not blocks:
            log_handle.warning(f"LLM returned empty blocks for logical page {logical_page}")
            return False
        self._inner._write_output_to_file(ocr_dir, [(page_num, blocks)])
        return True

    def _ocr_tesseract(self, image, logical_page: int, scan_config: dict, ocr_dir: str) -> bool:
        language = scan_config.get("language", "hi")
        pyt_lang = self._inner._pytesseract_language_map.get(language)
        psm = scan_config.get("psm")
        args = (
            (logical_page, image, pyt_lang, psm)
            if psm is not None
            else (logical_page, image, pyt_lang)
        )
        page_num, data = AdvancedPDFProcessor._process_single_page(args)
        if not data:
            log_handle.warning(f"Tesseract returned empty data for logical page {logical_page}")
            return False
        self._inner._write_output_to_file(ocr_dir, [(page_num, data)])
        return True

    def _load_page_mapping(self, ocr_dir: str) -> dict:
        """Load existing page_mapping.json or return empty dict."""
        path = os.path.join(ocr_dir, self.PAGE_MAPPING_FILE)
        if os.path.exists(path):
            try:
                with open(path, "r", encoding="utf-8") as fh:
                    return json.load(fh)
            except (IOError, json.JSONDecodeError) as e:
                log_handle.warning(f"Could not read {path}: {e}. Starting fresh.")
        return {}

    def _save_page_mapping(self, ocr_dir: str, mapping: dict) -> None:
        """Write page_mapping.json to ocr_dir (append-safe for sub-section indexing)."""
        path = os.path.join(ocr_dir, self.PAGE_MAPPING_FILE)
        try:
            with open(path, "w", encoding="utf-8") as fh:
                json.dump(mapping, fh, ensure_ascii=False, indent=2)
            log_handle.info(f"Written page mapping ({len(mapping)} entries) to {path}")
        except IOError as e:
            log_handle.error(f"Failed to write {path}: {e}")