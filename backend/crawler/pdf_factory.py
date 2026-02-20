"""
Factory for creating PDF processors based on configuration.
"""
import logging

from backend.config import Config
from backend.crawler.pdf_processor import PDFProcessor
from backend.crawler.advanced_pdf_processor import AdvancedPDFProcessor
from backend.crawler.llm_pdf_processor import LLMPDFProcessor

log_handle = logging.getLogger(__name__)


def create_pdf_processor(config: Config, chunk_strategy: str = None,
                         scan_config: dict = None):
    """
    Factory function to create the appropriate PDFProcessor.

    ocr_engine from scan_config (or config.OCR_ENGINE) determines the extraction method.
    chunk_strategy determines paragraph chunking (only relevant for non-LLM processors).

    Args:
        config: Configuration object
        chunk_strategy: Optional chunk strategy override (for Tesseract processors)
        scan_config: Optional merged scan config dict; used to read ocr_engine, llm_model, llm_workers

    Returns:
        PDFProcessor, AdvancedPDFProcessor, or LLMPDFProcessor instance
    """
    scan_config = scan_config or {}

    # ocr_engine from scan_config overrides config default
    ocr_engine = scan_config.get("ocr_engine", config.OCR_ENGINE)

    if ocr_engine == "llm":
        llm_model = scan_config.get("llm_model", config.DEFAULT_LLM_MODEL)
        llm_workers = scan_config.get("llm_workers", config.LLM_WORKERS)
        log_handle.info(
            f"Creating LLMPDFProcessor: model={llm_model}, workers={llm_workers}"
        )
        return LLMPDFProcessor(config, llm_model=llm_model, llm_workers=llm_workers)

    # Tesseract-based processors — selected by chunk_strategy
    strategy = chunk_strategy if chunk_strategy is not None else config.CHUNK_STRATEGY

    if strategy == "advanced":
        log_handle.info(f"Creating AdvancedPDFProcessor based on chunk_strategy={strategy}")
        return AdvancedPDFProcessor(config)
    else:
        log_handle.info(f"Creating PDFProcessor based on chunk_strategy={strategy}")
        return PDFProcessor(config)
