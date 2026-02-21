"""
Factory for creating paragraph generators based on configuration.
"""
import logging

from backend.config import Config
from backend.crawler.paragraph_generator.base import BaseParagraphGenerator
from backend.crawler.paragraph_generator.advanced import AdvancedParagraphGenerator
from backend.crawler.paragraph_generator.granth import GranthParagraphGenerator
from backend.crawler.paragraph_generator.language_meta import LanguageMeta

log_handle = logging.getLogger(__name__)


def create_paragraph_generator(config: Config, language_meta: LanguageMeta,
                               chunk_strategy: str = None, scan_config: dict = None):
    """
    Factory function to create the appropriate ParagraphGenerator.

    ocr_engine from scan_config (or config.OCR_ENGINE) takes precedence:
    if ocr_engine == "llm", GranthParagraphGenerator is always used.
    chunk_strategy is used for Tesseract-based processors.

    Args:
        config: Configuration object
        language_meta: LanguageMeta instance for language-specific behavior
        chunk_strategy: Optional chunk strategy override. If not provided, uses config.CHUNK_STRATEGY
        scan_config: Optional scan config dict; used to read ocr_engine

    Returns:
        BaseParagraphGenerator, AdvancedParagraphGenerator, or GranthParagraphGenerator instance
    """
    scan_config = scan_config or {}

    # ocr_engine == "llm" always maps to GranthParagraphGenerator
    ocr_engine = scan_config.get("ocr_engine", config.OCR_ENGINE)
    if ocr_engine == "llm":
        log_handle.info("Creating GranthParagraphGenerator based on ocr_engine=llm")
        return GranthParagraphGenerator(config, language_meta)

    # Tesseract-based processors — selected by chunk_strategy
    strategy = chunk_strategy if chunk_strategy is not None else config.CHUNK_STRATEGY

    if strategy == "granth":
        log_handle.info(f"Creating GranthParagraphGenerator based on chunk_strategy={strategy}")
        return GranthParagraphGenerator(config, language_meta)
    elif strategy == "advanced":
        log_handle.info(f"Creating AdvancedParagraphGenerator based on chunk_strategy={strategy}")
        return AdvancedParagraphGenerator(config, language_meta)
    else:
        log_handle.info(f"Creating BaseParagraphGenerator based on chunk_strategy={strategy}")
        return BaseParagraphGenerator(config, language_meta)