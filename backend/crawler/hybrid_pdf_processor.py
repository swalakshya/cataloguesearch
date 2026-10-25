"""Physical-page Auto Tesseract overrides around an unchanged regular processor."""
import json
from pathlib import Path
import uuid

from backend.common.auto_tesseract_config import (
    included_pages, ocr_directory, prepare_ocr_cache, validate_auto_pages,
)
from backend.crawler.advanced_pdf_processor import AdvancedPDFProcessor
from backend.crawler.auto_tesseract import auto_page_data


class AutoTesseractPDFProcessor(AdvancedPDFProcessor):
    @staticmethod
    def _process_single_page(args):
        page, image, language = args[:3]
        return page, [json.dumps(auto_page_data(page, image, language), ensure_ascii=False)]


class HybridPDFProcessor:
    def __init__(self, regular_processor, config):
        self.regular_processor = regular_processor
        self._config = config
        self.auto_processor = AutoTesseractPDFProcessor(config)

    def __getattr__(self, name):
        return getattr(self.regular_processor, name)

    def process_pdf(self, pdf_file, scan_config, pages_list):
        auto = set(validate_auto_pages(scan_config))
        pages = included_pages(pages_list, scan_config)
        changed = prepare_ocr_cache(pdf_file, scan_config, self._config)
        if changed and hasattr(self.regular_processor, "_index_state"):
            relative = str(Path(pdf_file).relative_to(self._config.BASE_PDF_PATH))
            self.regular_processor._index_state.clear_batch_job(str(uuid.uuid5(uuid.NAMESPACE_URL, relative)))
        regular_pages = [p for p in pages if p not in auto]
        auto_pages = [p for p in pages if p in auto]
        # The regular processor owns its online/batch lifecycle and native data
        # format. Do not call it with [] (which could submit an empty batch).
        regular_done = self.regular_processor.process_pdf(pdf_file, scan_config, regular_pages) if regular_pages else True
        auto_done = self.auto_processor.process_pdf(pdf_file, scan_config, auto_pages) if auto_pages else True
        directory = ocr_directory(pdf_file, self._config)
        return bool(regular_done and auto_done and all((directory / f"page_{p:04d}.json").exists() for p in pages))

    def read_paragraphs(self, ocr_dir, pages_list):
        result = []
        for page in pages_list:
            path = Path(ocr_dir) / f"page_{page:04d}.json"
            data = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(data, dict) and data.get("ocr_mode") == "auto_tesseract":
                # A tuple envelope is recognized by the hybrid paragraph
                # generator and safely skipped by LLM verse extraction.
                result.append((page, data))
            else:
                result.extend(self.regular_processor.read_paragraphs(ocr_dir, [page]))
        return result
