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
    Factory function to create the appropriate BookmarkExtractor based on config.

    Primary extractor is always Gemini (using DEFAULT_LLM_MODEL).
    Falls back to the extractor defined by BOOKMARK_EXTRACTOR_LLM if Gemini fails.

    Args:
        config: Configuration object

    Returns:
        GeminiBookmarkExtractor with a fallback extractor wired up
    """
    gemini_model = config.DEFAULT_LLM_MODEL or "gemini-2.5-flash"
    fallback_llm_type = config.BOOKMARK_EXTRACTOR_LLM

    log_handle.info(
        "Creating bookmark extractor: primary=gemini(%s), fallback=%s",
        gemini_model, fallback_llm_type
    )

    primary = GeminiBookmarkExtractor(model=gemini_model)

    if fallback_llm_type:
        primary._fallback_extractor = create_bookmark_extractor_by_name(fallback_llm_type)

    return primary