"""
Legacy PSM-based OCR utility — preserved for reference only.

This module contains the Tesseract PSM6/PSM3 single-page OCR implementation
that was previously used in the eval UI. It is no longer wired into the eval
pipeline. The eval UI now exclusively uses the 'advanced' mode
(process_image_to_paragraphs from scratch/para_gen/para_gen.py).

Kept here as a safety backup in case PSM-based single-page processing is
needed in the future. To re-enable, import process_single_page_psm and call
it with a (page_num, pil_image, lang_code, psm) tuple.
"""
import logging
import traceback

import pytesseract

log_handle = logging.getLogger(__name__)


def process_single_page_psm(args):
    """
    Process a single image with Tesseract using a specific PSM mode.

    Args:
        args: Tuple of (page_num, image, language_code, psm)
            - page_num: Page number (int)
            - image: PIL.Image object
            - language_code: Tesseract language code (e.g. 'hin', 'guj')
            - psm: Tesseract PSM mode (3 or 6); defaults to 3 for 3-element tuples

    Returns:
        Tuple of (page_num, list of paragraph strings)
    """
    if len(args) == 3:
        page_num, image, language_code = args
        psm = 3
    else:
        page_num, image, language_code, psm = args
    try:
        if image.mode != 'RGB':
            processed_image = image.convert('RGB')
        else:
            processed_image = image

        config = f'--psm {psm} -l {language_code}'
        text = pytesseract.image_to_string(processed_image, config=config)
        paragraphs = [p.strip() for p in text.split('\n\n') if p.strip()]
        return page_num, paragraphs

    except Exception as page_error:
        log_handle.error(f"An error occurred while processing page {page_num}: {page_error}")
        traceback.print_exc()
        return page_num, []