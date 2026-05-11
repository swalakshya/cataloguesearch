import json
import logging
import traceback

import pandas as pd
import pytesseract

from backend.crawler.pdf_processor import PDFProcessor

# Setup logging for this module
log_handle = logging.getLogger(__name__)

# Set by AdvancedPDFProcessor.__init__ from config.TESSDATA_DIR.
# Empty string means use the system default tessdata.
_TESSDATA_FLAG = ""


class AdvancedPDFProcessor(PDFProcessor):
    """
    Advanced PDF processor that extracts raw OCR data with line-level metadata.

    Unlike the base PDFProcessor which generates paragraphs directly, this class
    extracts raw line data (text + position metadata) and saves it as JSON files
    for later processing with the paragraph generation algorithm.
    """

    def __init__(self, config):
        super().__init__(config)
        global _TESSDATA_FLAG
        tessdata_dir = config.TESSDATA_DIR
        _TESSDATA_FLAG = f'--tessdata-dir "{tessdata_dir}"' if tessdata_dir else ""
        log_handle.info(f"Tessdata: {tessdata_dir if tessdata_dir else 'system default'}")

    def get_output_file_extension(self) -> str:
        """
        Returns the file extension for OCR output files.

        Returns:
            str: File extension including the dot (e.g., '.json')
        """
        return ".json"

    def _write_output_to_file(self, output_ocr_dir: str, paragraphs: list[tuple[int, list[str]]]):
        """
        Overridden to write JSON files instead of text files.

        Args:
            output_ocr_dir: Directory where output files should be written
            paragraphs: List of tuples (page_num, list with single JSON string)
        """
        for page_num, page_data_list in paragraphs:
            fname = f"{output_ocr_dir}/page_{page_num:04d}.json"
            # page_data_list contains a single JSON string
            json_content = page_data_list[0] if page_data_list else "{}"
            try:
                with open(fname, 'w', encoding='utf-8') as fh:
                    fh.write(json_content)
            except IOError as e:
                traceback.print_exc()
                log_handle.error(f"Failed to write OCR file {fname}: {e}")

    def read_paragraphs(self, ocr_dir: str, pages_list: list[int]) -> list[dict]:
        """
        Overridden to read JSON files with raw OCR line data.

        Args:
            ocr_dir: Directory containing OCR JSON files
            pages_list: List of page numbers to read

        Returns:
            List of dictionaries containing page data with metadata and lines
        """
        pages_data = []
        for page_num in pages_list:
            json_file = f"{ocr_dir}/page_{page_num:04d}.json"
            try:
                with open(json_file, 'r', encoding='utf-8') as f:
                    page_data = json.load(f)
                # Old format: flat list of line dicts — wrap into the expected envelope
                if isinstance(page_data, list):
                    page_data = {
                        "page_num": page_num,
                        "metadata": {
                            "avg_left_margin": 0,
                            "avg_right_margin": 0,
                            "prose_left_margin": 0,
                            "prose_right_margin": 0
                        },
                        "lines": page_data
                    }
                pages_data.append(page_data)
            except (IOError, json.JSONDecodeError) as e:
                log_handle.error(f"Failed to read JSON file {json_file}: {e}")
                # Return empty page data on error
                pages_data.append({
                    "page_num": page_num,
                    "metadata": {
                        "avg_left_margin": 0,
                        "avg_right_margin": 0,
                        "prose_left_margin": 0,
                        "prose_right_margin": 0
                    },
                    "lines": []
                })
        return pages_data

    @staticmethod
    def _process_single_page(args):
        """
        Overridden to extract raw OCR line data with positioning metadata.

        Uses the exact algorithm from para_gen.py for line reconstruction and
        margin calculation.

        Args:
            args: Tuple of (page_num, image, language_code, psm) or (page_num, image, language_code)

        Returns:
            Tuple of (page_num, [json_string]) where json_string contains raw OCR data
        """
        # Backward compatible: support both 3-element and 4-element tuples
        if len(args) == 3:
            page_num, image, language_code = args
            psm = 6  # Default PSM
        else:
            page_num, image, language_code, psm = args

        try:
            ocr_data = pytesseract.image_to_data(
                image, lang=language_code, output_type=pytesseract.Output.DATAFRAME,
                config=f'--psm {psm} {_TESSDATA_FLAG}'.strip()
            )

            ocr_data = ocr_data.dropna(subset=['text'])
            ocr_data = ocr_data[ocr_data.conf > 10]

            if ocr_data.empty:
                page_data = {
                    "page_num": page_num,
                    "metadata": {
                        "avg_left_margin": 0,
                        "avg_right_margin": 0,
                        "prose_left_margin": 0,
                        "prose_right_margin": 0
                    },
                    "lines": []
                }
                return page_num, [json.dumps(page_data, ensure_ascii=False)]

            # Reconstruct lines from word data
            lines_on_page = []
            for _, line_df in ocr_data.groupby(['block_num', 'par_num', 'line_num']):
                text = ' '.join(line_df['text'].astype(str))
                x_start = line_df['left'].min()
                x_end = (line_df['left'] + line_df['width']).max()
                lines_on_page.append({'text': text, 'x_start': x_start, 'x_end': x_end})

            if not lines_on_page:
                page_data = {
                    "page_num": page_num,
                    "metadata": {
                        "avg_left_margin": 0,
                        "avg_right_margin": 0,
                        "prose_left_margin": 0,
                        "prose_right_margin": 0
                    },
                    "lines": []
                }
                return page_num, [json.dumps(page_data, ensure_ascii=False)]

            # --- Robust Margin Calculation by Averaging the Two Extremes ---
            if len(lines_on_page) < 4:
                # With too few lines, a simple median is the safest option.
                sorted_left = sorted([l['x_start'] for l in lines_on_page])
                sorted_right = sorted([l['x_end'] for l in lines_on_page])
                prose_left_margin = sorted_left[len(sorted_left) // 2]
                prose_right_margin = sorted_right[len(sorted_right) // 2]
            else:
                # Sort all margins once
                sorted_left_margins = sorted([line['x_start'] for line in lines_on_page])
                sorted_right_margins = sorted([line['x_end'] for line in lines_on_page])

                # Average the 2 smallest left margins
                prose_left_margin = (sorted_left_margins[0] + sorted_left_margins[1]) / 2
                # Average the 2 largest right margins
                prose_right_margin = (sorted_right_margins[-1] + sorted_right_margins[-2]) / 2

            # Calculate average margins
            avg_left_margin = sum(l['x_start'] for l in lines_on_page) / len(lines_on_page)
            avg_right_margin = sum(l['x_end'] for l in lines_on_page) / len(lines_on_page)

            # Build JSON structure
            page_data = {
                "page_num": page_num,
                "metadata": {
                    "avg_left_margin": float(avg_left_margin),
                    "avg_right_margin": float(avg_right_margin),
                    "prose_left_margin": float(prose_left_margin),
                    "prose_right_margin": float(prose_right_margin)
                },
                "lines": [
                    {
                        "line_num": idx,
                        "text": line['text'],
                        "x_start": int(line['x_start']),
                        "x_end": int(line['x_end'])
                    }
                    for idx, line in enumerate(lines_on_page)
                ]
            }

            json_string = json.dumps(page_data, ensure_ascii=False, indent=2)
            return page_num, [json_string]

        except Exception as page_error:
            log_handle.error(f"An error occurred while processing page {page_num}: {page_error}")
            traceback.print_exc()
            return page_num, []