"""
Cached Bookmark Extractor for tests.

This module provides a caching wrapper around real bookmark extractors (eg. Ollama).
It caches LLM responses based on the input bookmark titles, dramatically speeding up tests
by avoiding redundant LLM calls for the same bookmarks.

Key features:
- Caches at call_llm() level using hash of indexed_titles as key
- Self-invalidating: different bookmarks = cache miss = correct behavior
- Session-scoped: cache shared across all test files
- Transparent: no changes needed to upstream code (Discovery, PDFProcessor, etc.)
"""

import hashlib
import json
import logging
from typing import List, Dict, Any, Optional

from backend.crawler.bookmark_extractor.base import BookmarkExtractor

log_handle = logging.getLogger(__name__)


class CachedBookmarkExtractor(BookmarkExtractor):
    """
    Caching wrapper for BookmarkExtractor implementations.

    This class wraps any BookmarkExtractor (eg. Ollama) and caches
    the results of call_llm() based on the input bookmark titles.

    Cache Key Strategy:
    - Uses SHA256 hash of the indexed_titles input (first 16 chars)
    - Same bookmarks → same hash → cache hit
    - Different bookmarks → different hash → cache miss → correct!

    Example:
        cache = {}  # Session-scoped cache dict
        real_extractor = OllamaBookmarkExtractor(model="phi4:14b")
        cached_extractor = CachedBookmarkExtractor(real_extractor, cache)

        # First call: cache miss, calls LLM (~15s)
        result1 = cached_extractor.call_llm([...])

        # Second call with same bookmarks: cache hit (~0.001s)
        result2 = cached_extractor.call_llm([...])
    """

    def __init__(self, real_extractor: BookmarkExtractor, cache: dict):
        """
        Initialize cached bookmark extractor.

        Args:
            real_extractor: The actual BookmarkExtractor instance (eg. Ollama)
            cache: Dictionary to store cached results (should be session-scoped)
        """
        super().__init__()
        self.real_extractor = real_extractor
        self.cache = cache

        # Expose system_prompt for compatibility
        self.system_prompt = real_extractor.system_prompt

        log_handle.info(
            f"Initialized CachedBookmarkExtractor wrapping {type(real_extractor).__name__}"
        )

    def parse_bookmarks(self, pdf_file: str, batch_size: int = 100) -> List[Dict[str, str]]:
        """
        Parse bookmarks from PDF using cached LLM calls.

        This method is copied from base.py but modified to use self.call_llm()
        which goes through the cache, instead of forwarding to real_extractor
        which would bypass the cache.

        Args:
            pdf_file: Path to PDF file
            batch_size: Number of bookmarks per LLM batch

        Returns:
            List of parsed bookmark dictionaries
        """
        log_handle.info("Starting bookmark extraction for PDF: %s", pdf_file)

        # Step 1: Extract bookmarks from PDF
        bookmark_json = self.real_extractor._extract_bookmarks_from_pdf(pdf_file)

        if not bookmark_json.get('bookmarks'):
            log_handle.warning("No bookmarks found in PDF: %s", pdf_file)
            return []

        log_handle.info("Found %s bookmarks in PDF", bookmark_json['total'])

        # Step 2: Prepare indexed titles for LLM
        bookmarks = bookmark_json['bookmarks']
        indexed_titles = [
            {"index": i, "title": item.get('title', '')}
            for i, item in enumerate(bookmarks)
        ]

        # Step 3: Process in batches to avoid timeouts
        all_extracted_data = []
        total_batches = (len(indexed_titles) + batch_size - 1) // batch_size

        log_handle.info("Processing %s bookmarks in %s batches of %s", len(indexed_titles), total_batches, batch_size)

        for batch_num in range(total_batches):
            start_idx = batch_num * batch_size
            end_idx = min((batch_num + 1) * batch_size, len(indexed_titles))
            batch = indexed_titles[start_idx:end_idx]

            log_handle.info("Processing batch %s/%s (%s bookmarks)", batch_num + 1, total_batches, len(batch))

            # Call LLM for this batch - THIS GOES THROUGH THE CACHE!
            extracted_data = self.call_llm(batch)

            if not extracted_data:
                log_handle.error("Failed to extract data from LLM for batch %s/%s", batch_num + 1, total_batches)
                return []

            all_extracted_data.extend(extracted_data)
            log_handle.info("Successfully processed batch %s/%s", batch_num + 1, total_batches)

        log_handle.info("Successfully extracted data from all %s batches", total_batches)

        # Step 4: Merge extracted data back with original page numbers
        result = self.real_extractor._merge_results(bookmarks, all_extracted_data)
        log_handle.info("Bookmark extraction completed. Processed %s bookmarks", len(result))
        return result

    def call_llm(self, indexed_titles: List[Dict[str, Any]]) -> Optional[List[Dict[str, str]]]:
        """
        Cache-aware LLM call.

        Checks cache before calling real extractor. Cache key is based on the
        hash of indexed_titles, making it self-invalidating when bookmarks change.

        Args:
            indexed_titles: List of dicts with 'index' and 'title' keys
                Example: [{"index": 0, "title": "Prav 244, Date: 07-11-1965"}, ...]

        Returns:
            List of dicts with 'index', 'pravachan_no', 'date' keys, or None if failed
        """
        # Generate cache key from input
        cache_key = self._get_cache_key(indexed_titles)

        # Check cache
        if cache_key in self.cache:
            log_handle.info(
                f"📦 CACHE HIT: Returning cached result for {len(indexed_titles)} bookmark(s) "
                f"(key: {cache_key})"
            )
            return self.cache[cache_key]

        # Cache miss - call real extractor
        log_handle.info(
            f"🔍 CACHE MISS: Calling real LLM for {len(indexed_titles)} bookmark(s) "
            f"(key: {cache_key})"
        )

        result = self.real_extractor.call_llm(indexed_titles)

        if result is not None:
            self.cache[cache_key] = result
            log_handle.info(
                f"✅ Cached LLM result for key {cache_key} "
                f"(cache size: {len(self.cache)} entries)"
            )
        else:
            log_handle.warning(
                f"⚠️  LLM call returned None for key {cache_key}, not caching to allow retry when LLM is available"
            )

        return result

    def _get_cache_key(self, indexed_titles: List[Dict[str, Any]]) -> str:
        """
        Generate cache key from extractor type + indexed_titles input.

        Includes the real extractor's class name so Ollama and Gemini results
        are stored in separate cache entries and never cross-contaminate.

        Args:
            indexed_titles: List of {"index": i, "title": "..."} dicts

        Returns:
            16-character hex string (truncated SHA256 hash)

        Examples:
            OllamaBookmarkExtractor + [{"index": 0, "title": "Prav 244"}] → "a3f2b1c4d5e6f7a8"
            GeminiBookmarkExtractor + [{"index": 0, "title": "Prav 244"}] → "d1e2f3a4b5c6d7e8" (different!)
        """
        # Include extractor type so Ollama and Gemini use separate cache entries
        extractor_type = type(self.real_extractor).__name__

        # Serialize to stable JSON
        # - sort_keys=True ensures consistent ordering
        # - ensure_ascii=False handles Unicode properly
        titles_json = json.dumps(
            indexed_titles,
            sort_keys=True,
            ensure_ascii=False
        )

        # Hash extractor type + titles together
        content = f"{extractor_type}:{titles_json}"
        hash_obj = hashlib.sha256(content.encode('utf-8'))
        cache_key = hash_obj.hexdigest()[:16]  # First 16 chars for readability

        return cache_key
