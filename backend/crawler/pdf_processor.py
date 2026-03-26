import logging
import os
import shutil
import traceback
from concurrent.futures import ProcessPoolExecutor

import fitz
from PIL import Image
from tqdm import tqdm

from backend.config import Config

# Disable tokenizers parallelism to avoid fork conflicts
os.environ["TOKENIZERS_PARALLELISM"] = "false"

# Setup logging for this module
log_handle = logging.getLogger(__name__)


class PDFProcessor:
    """
    Handles PDF processing, including OCR, text extraction, bookmark extraction.
    """
    def __init__(self, config: Config):
        if shutil.which("pdftoppm") is None:
            raise RuntimeError(
                "Poppler is not installed or not in PATH. "
                "Please configure it for this module to work."
            )
        self._pytesseract_language_map = {
            "hi": "hin",
            "gu": "guj"
        }
        self._config = config
        self._base_ocr_folder = config.BASE_OCR_PATH
        self._base_pdf_folder = config.BASE_PDF_PATH

    def expand_pages(self, pages_list: list[int]) -> list[int]:
        """
        Return the logical page numbers for the given PDF page numbers.
        For single-page-per-PDF processors this is an identity operation.
        MultiPagePDFProcessor overrides this to expand each PDF page to two logical pages.
        """
        return pages_list

    def get_output_file_extension(self) -> str:
        """
        Returns the file extension for OCR output files.

        Returns:
            str: File extension including the dot (e.g., '.txt')
        """
        return ".txt"

    def process_pdf(
            self, pdf_file: str, scan_config: dict,
            pages_list: list[int]):
        if not os.path.exists(pdf_file):
            raise FileNotFoundError(f"Error: File {pdf_file} not found.")

        log_handle.info(f"base_pdf_folder: {self._base_pdf_folder}")
        log_handle.info(f"pdf_file: {pdf_file}")
        relative_pdf_path = os.path.relpath(pdf_file, self._base_pdf_folder)
        output_ocr_dir = f"{self._base_ocr_folder}/{os.path.splitext(relative_pdf_path)[0]}"
        log_handle.info(f"Output OCR directory: {output_ocr_dir}")

        # Check if output directory exists and has all required pages
        if os.path.exists(output_ocr_dir):
            expected_extension = self.get_output_file_extension()
            existing_files = set()
            for filename in os.listdir(output_ocr_dir):
                if filename.startswith("page_") and filename.endswith(expected_extension):
                    # Extract page number from filename (page_0001.txt -> 1)
                    try:
                        page_num = int(filename[5:9])  # Extract 4-digit number
                        existing_files.add(page_num)
                    except ValueError:
                        continue

            # If all required pages exist, return early
            if set(pages_list).issubset(existing_files):
                log_handle.info(f"All required pages already processed in {output_ocr_dir}")
                return True

            # Otherwise, remove existing directory to reprocess
            missing_pages = set(pages_list) - existing_files
            log_handle.info(
                f"OCR directory exists but needs reprocessing. "
                f"Required pages: {len(pages_list)}, Found: {len(existing_files)}, "
                f"Missing: {len(missing_pages)}. First few missing: {sorted(list(missing_pages))[:10]}"
            )
            shutil.rmtree(output_ocr_dir)

        os.makedirs(output_ocr_dir, exist_ok=True)
        language = scan_config.get("language", "hi")
        paragraphs = self._generate_paragraphs(
            pdf_file, pages_list, scan_config, language)

        # Write to the OCR directory
        self._write_output_to_file(output_ocr_dir, paragraphs)

        log_handle.info(f"Generated OCR text files for {pdf_file} in dir {output_ocr_dir}")
        return True

    def _generate_paragraphs(
            self, pdf_file: str, page_list: list[int], scan_config: dict,
            language: str) -> list[tuple[int, list[str]]]:
        """
        Extracts paragraphs from a specified list of pages in a PDF file.

        This function converts each page of the PDF into an image and then
        uses OCR to extract text.

        Args:
            pdf_file: The file path to the PDF document.
            page_list: A list of 1-based page numbers to process.
            language: The language code for OCR (e.g., 'hi', 'gu').

        Returns:
            A list of tuples, where each tuple contains the page number
            and a list of paragraph strings extracted from that page.
            Example: [(1, ["Para 1...", "Para 2..."]), (5, [...])]
        """
        if not os.path.exists(pdf_file):
            raise FileNotFoundError(f"Error: File {pdf_file} not found.")

        if not page_list:
            return []

        images, page_numbers_for_images = self._get_image(
            pdf_file, page_list, scan_config
        )

        pyt_lang = self._pytesseract_language_map.get(language)
        log_handle.info(f"Scanning total pages: {len(page_list)}")

        # Extract PSM from scan_config if present
        psm = scan_config.get("psm")

        # Build tasks tuple - include PSM only if specified
        if psm is not None:
            tasks = [(page_num, image, pyt_lang, psm)
                     for page_num, image in zip(page_numbers_for_images, images)]
        else:
            tasks = [(page_num, image, pyt_lang)
                     for page_num, image in zip(page_numbers_for_images, images)]

        if not tasks:
            return []

        extracted_data = []
        with ProcessPoolExecutor(max_workers=8) as executor:
            results = list(tqdm(
                executor.map(self.__class__._process_single_page, tasks),
                total=len(tasks), desc="Processing Pages"))
            extracted_data = results

        # Sort results by page number to guarantee order
        extracted_data.sort(key=lambda x: x[0])

        return extracted_data

    def _get_image(self, pdf_file, page_list, scan_config):
        images = []
        page_numbers_for_images = []
        # Check for cropping configuration once at the beginning
        crop_config = None
        if "crop" in scan_config:
            crop_config = scan_config["crop"]
            top_percent = crop_config.get("top", 0)
            bottom_percent = crop_config.get("bottom", 0)
            left_percent = crop_config.get("left", 0)
            right_percent = crop_config.get("right", 0)
            if top_percent > 0 or bottom_percent > 0 or left_percent > 0 or right_percent > 0:
                log_handle.info(
                    f"Cropping enabled: {top_percent}% from top, "
                    f"{bottom_percent}% from bottom, "
                    f"{left_percent}% from left, "
                    f"{right_percent}% from right")
            else:
                crop_config = None  # No actual cropping needed

        try:
            doc = fitz.open(pdf_file)
            total_pages = len(doc)

            for page_num in page_list:
                # Validate page number (1-based) against total pages
                if not 1 <= page_num <= total_pages:
                    log_handle.warning(
                        f"Page number {page_num} is out of bounds for PDF {pdf_file} "
                        f"which has {total_pages} pages. Skipping."
                    )
                    continue

                # PyMuPDF uses 0-based indexing for pages, so we subtract 1
                page = doc.load_page(page_num - 1)

                pix = page.get_pixmap(dpi=350)
                img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)

                # Apply cropping if enabled
                if crop_config:
                    width, height = img.size
                    top_crop = int(height * top_percent / 100)
                    bottom_crop = int(height * bottom_percent / 100)
                    left_crop = int(width * left_percent / 100)
                    right_crop = int(width * right_percent / 100)

                    # Crop the image (left, top, right, bottom)
                    img = img.crop((left_crop, top_crop, width - right_crop, height - bottom_crop))
                images.append(img)
                page_numbers_for_images.append(page_num)

            doc.close()
            return images, page_numbers_for_images

        except Exception as pdf_error:
            log_handle.error(
                f"Error during PDF to image conversion with PyMuPDF: {pdf_error}")
            traceback.print_exc()
            return [], []
