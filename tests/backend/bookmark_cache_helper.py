"""
Helper utilities for enabling bookmark caching in tests.

This module provides functions to enable bookmark caching in tests without
modifying production code. It works by monkey-patching the bookmark extractor
factory to wrap extractors with CachedBookmarkExtractor.
"""

import logging
from typing import Optional

from backend.crawler.bookmark_extractor import factory
from backend.crawler.bookmark_extractor.base import BookmarkExtractor
from tests.backend.cached_bookmark_extractor import CachedBookmarkExtractor

log_handle = logging.getLogger(__name__)

# Store the original factory function
_original_create_by_name = None
_original_create = None
_active_cache = None


def enable_bookmark_caching(cache: dict):
    """
    Enable bookmark caching for all bookmark extractors created via factory.

    This monkey-patches the factory functions to wrap all extractors with
    CachedBookmarkExtractor. Call this at the start of your test session.

    Args:
        cache: Session-scoped cache dictionary (from bookmark_cache fixture)

    Example:
        def test_something(bookmark_cache):
            enable_bookmark_caching(bookmark_cache)
            # Now all bookmark extractors will use caching
            discovery.crawl(...)
    """
    global _original_create_by_name, _original_create, _active_cache

    if _original_create_by_name is not None:
        # Already enabled
        log_handle.info("Bookmark caching already enabled")
        return

    _active_cache = cache

    # Save original functions
    _original_create_by_name = factory.create_bookmark_extractor_by_name
    _original_create = factory.create_bookmark_extractor

    def cached_create_by_name(llm_type: str, model: str = None) -> BookmarkExtractor:
        real_extractor = _original_create_by_name(llm_type, model)
        cached_extractor = CachedBookmarkExtractor(real_extractor, _active_cache)
        log_handle.info(f"🔧 Wrapped {type(real_extractor).__name__} with CachedBookmarkExtractor (by_name)")
        return cached_extractor

    def cached_create(config) -> BookmarkExtractor:
        # create_bookmark_extractor directly instantiates GeminiBookmarkExtractor
        # without going through create_bookmark_extractor_by_name, so the primary
        # extractor was never cached. Wrapping here fixes that.
        real_extractor = _original_create(config)
        cached_extractor = CachedBookmarkExtractor(real_extractor, _active_cache)
        log_handle.info(f"🔧 Wrapped {type(real_extractor).__name__} with CachedBookmarkExtractor (config)")
        return cached_extractor

    factory.create_bookmark_extractor_by_name = cached_create_by_name
    factory.create_bookmark_extractor = cached_create

    log_handle.info("✅ Bookmark caching enabled for all extractors")


def disable_bookmark_caching():
    """
    Disable bookmark caching and restore original factory functions.

    Call this in test teardown if needed (usually not necessary).
    """
    global _original_create_by_name, _original_create, _active_cache

    if _original_create_by_name is None:
        # Not enabled
        return

    # Restore originals
    factory.create_bookmark_extractor_by_name = _original_create_by_name
    factory.create_bookmark_extractor = _original_create

    _original_create_by_name = None
    _original_create = None
    _active_cache = None

    log_handle.info("❌ Bookmark caching disabled, factory restored")