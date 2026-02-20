"""
Factory for creating bookmark extractors based on configuration.
"""
import logging
import os

from backend.config import Config
from backend.crawler.bookmark_extractor.base import BookmarkExtractor
from backend.crawler.bookmark_extractor.gemini import GeminiBookmarkExtractor
from backend.crawler.bookmark_extractor.ollama import OllamaBookmarkExtractor

log_handle = logging.getLogger(__name__)


def create_bookmark_extractor_by_name(llm_type: str, model: str = None) -> BookmarkExtractor:
    """
    Factory function to create a BookmarkExtractor by LLM provider name.

    Args:
        llm_type: LLM provider name ("ollama" or "mock")
        model: Optional model name override (for Ollama)

    Returns:
        BookmarkExtractor instance (OllamaBookmarkExtractor or MockBookmarkExtractor)

    Raises:
        ValueError: If the LLM type is not supported
    """
    llm_type_lower = llm_type.lower()

    if llm_type_lower == "ollama":
        ollama_model = model or os.getenv("OLLAMA_MODEL", "phi4:14b")
        log_handle.info("Creating OllamaBookmarkExtractor with model=%s", ollama_model)
        return OllamaBookmarkExtractor(model=ollama_model)

    elif llm_type_lower == "gemini":
        gemini_model = model or os.getenv("GEMINI_BOOKMARK_MODEL", "gemini-2.5-flash")
        log_handle.info("Creating GeminiBookmarkExtractor with model=%s", gemini_model)
        return GeminiBookmarkExtractor(model=gemini_model)

    else:
        raise ValueError(
            f"Unsupported bookmark extractor LLM: {llm_type}. "
            f"Supported values: 'ollama', 'gemini'"
        )


def create_bookmark_extractor(config: Config) -> BookmarkExtractor:
    """
    Factory function to create the appropriate BookmarkExtractor based on BOOKMARK_EXTRACTOR_LLM config.

    Args:
        config: Configuration object

    Returns:
        BookmarkExtractor instance (OllamaBookmarkExtractor)
        based on BOOKMARK_EXTRACTOR_LLM config

    Raises:
        ValueError: If the configured LLM is not supported
    """
    llm_type = config.BOOKMARK_EXTRACTOR_LLM
    log_handle.info(f"Creating bookmark extractor from config: {llm_type}")
    return create_bookmark_extractor_by_name(llm_type)