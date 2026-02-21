"""
GranthParagraphGenerator

Processes LLM-extracted typed blocks from Granth (Jain scripture) JSON files
and combines hindi_text blocks into logically complete paragraphs.

Phase 1 — Sentence-boundary combining:
  - Only hindi_text blocks are processed; all others are skipped.
  - chapter_heading blocks act as hard breaks (terminate the current buffer;
    the heading itself is not added to any paragraph).
  - The running buffer is flushed when:
      1. The last added text ends with a punctuation suffix (।?!:)]}), OR
      2. The next block's text starts with a configured stop prefix
         (e.g. अर्थ, टीका, भावार्थ) after stripping leading brackets/quotes, OR
      3. The next block is a chapter_heading.
  - stop_words from scan_config provides the stop prefix list.

Phase 2 — Minimum-length combining (target: 100 words):
  - Takes Phase 1 output (List[Tuple[int, str, bool]]) and greedily merges
    consecutive paragraphs until the buffer reaches >= 100 words.
  - Hard flush boundaries (never merge across):
      * is_chapter_start=True — paragraph follows a chapter_heading
      * stop prefix — paragraph begins a commentary section
  - The 100-word threshold is a soft minimum; if a logical section never
    reaches 100 words, it is output as-is.

Output: List[Tuple[int, str]] compatible with index_generator._write_paragraphs().
page_num in each tuple is the page of the first block in the paragraph.
"""
import logging
from typing import List, Tuple

from backend.config import Config
from backend.crawler.paragraph_generator.base import BaseParagraphGenerator
from backend.crawler.paragraph_generator.language_meta import LanguageMeta

log_handle = logging.getLogger(__name__)

# Characters that can legally precede a stop-prefix word
_LEADING_STRIP = '([{\'"'

# Characters that can legally follow a stop-prefix word (separators)
_STOP_WORD_SEPARATORS = set(':ः- —\t[({\'"')
_MIN_PARA_LENGTH = 100  # minimum words per output paragraph


def _starts_with_stop_prefix(text: str, stop_prefixes: tuple) -> bool:
    """
    Return True if *text* begins with one of *stop_prefixes* (as a complete
    word) after stripping any leading bracket / quote characters.

    A complete word match requires that the character immediately after the
    prefix is a known separator (:, ः, -, —, space, bracket, quote) or
    end-of-text. This prevents partial matches like 'अर्थात्' matching 'अर्थ'.

    Handles patterns like:
        अर्थ:—        →  ':' is a separator  → match
        अर्थ :—       →  ' ' is a separator  → match
        गाथार्थः      →  'ः' is a separator  → match
        गाथार्थ -     →  ' ' is a separator  → match
        [टीका:-       →  strip '[', ':' follows → match
        अर्थात्...    →  'ा' is NOT a separator → no match
    """
    if not stop_prefixes:
        return False
    stripped = text.lstrip(_LEADING_STRIP)
    for prefix in stop_prefixes:
        if stripped.startswith(prefix):
            rest = stripped[len(prefix):]
            # Match if end-of-text or next char is a known separator.
            # This ensures the stop word is a complete word — e.g. 'अर्थ'
            # matches 'अर्थ:' and 'अर्थः' but NOT 'अर्थात्' (where 'ा'
            # is not a separator).
            if not rest or rest[0] in _STOP_WORD_SEPARATORS:
                return True
    return False


class GranthParagraphGenerator(BaseParagraphGenerator):
    """
    Paragraph generator for Granth LLM-extracted typed blocks.

    Unlike BaseParagraphGenerator / AdvancedParagraphGenerator which operate
    on Tesseract-style line data, this generator takes LLM-extracted
    (page_num, [{"type": ..., "text": ...}]) data directly.

    generate_paragraphs() runs Phase 1 followed by Phase 2 and returns
    List[Tuple[int, str]] compatible with index_generator._write_paragraphs().
    """

    def __init__(self, config: Config, language_meta: LanguageMeta):
        super().__init__(config, language_meta)

    def generate_paragraphs(
        self,
        pages_data: List[Tuple[int, List[dict]]],
        scan_config: dict,
    ) -> List[Tuple[int, str]]:
        """
        Generate paragraphs from LLM-extracted Granth blocks.

        Args:
            pages_data: List of (page_num, blocks) where blocks is a list of
                        {"type": str, "text": str} dicts (from LLMPDFProcessor).
            scan_config: Document scan configuration; reads:
                - "stop_words": list[str]     — prefixes that close the buffer
                - "typo_list":  list[[str,str]] — typo corrections

        Returns:
            List of (page_num, paragraph_text) tuples.
        """
        stop_prefixes = tuple(scan_config.get("stop_words", []))
        typo_list = scan_config.get("typo_list", [])

        phase1 = self._phase1_sentence_boundaries(pages_data, stop_prefixes, typo_list)
        phase2 = self._phase2_min_length(phase1, stop_prefixes)

        log_handle.info(
            "GranthParagraphGenerator: %d pages → %d (phase1) → %d (phase2) paragraphs",
            len(pages_data), len(phase1), len(phase2)
        )
        return phase2

    # ------------------------------------------------------------------
    # Phase 1 — sentence-boundary combining
    # ------------------------------------------------------------------

    def _phase1_sentence_boundaries(
        self,
        pages_data: List[Tuple[int, List[dict]]],
        stop_prefixes: tuple,
        typo_list: list,
    ) -> List[Tuple[int, str, bool]]:
        """
        Combine hindi_text blocks into complete sentences.

        Buffer is flushed on:
          1. Punctuation suffix at end of current text.
          2. Next block starts with a stop prefix.
          3. Next block is a chapter_heading (hard break; heading not emitted).

        Returns List[Tuple[page_num, text, is_chapter_start]] where
        is_chapter_start=True marks the first paragraph after a chapter_heading.
        Phase 2 uses this flag as a hard merge boundary.
        """
        result: List[Tuple[int, str, bool]] = []
        buffer: List[str] = []
        buffer_page: int | None = None
        chapter_break: bool = False  # signals next flush output is chapter_start

        def _flush():
            nonlocal buffer, buffer_page, chapter_break
            if buffer:
                result.append((buffer_page, '\n'.join(buffer), chapter_break))
                chapter_break = False
            buffer = []
            buffer_page = None

        for page_num, blocks in pages_data:
            for block in blocks:
                block_type = block.get("type", "")
                text = block.get("text", "").strip()

                if block_type == "chapter_heading":
                    _flush()
                    chapter_break = True  # next paragraph starts a new chapter
                    continue

                if block_type != "hindi_text":
                    continue

                if not text:
                    continue

                text = self._normalize_text(text, typo_list)
                if not text:
                    continue

                if buffer and _starts_with_stop_prefix(text, stop_prefixes):
                    _flush()

                if not buffer:
                    buffer_page = page_num

                buffer.append(text)

                if text.endswith(self.punctuation_suffixes):
                    _flush()

        _flush()
        return result

    # ------------------------------------------------------------------
    # Phase 2 — minimum-length combining
    # ------------------------------------------------------------------

    @staticmethod
    def _phase2_min_length(
        paragraphs: List[Tuple[int, str, bool]],
        stop_prefixes: tuple,
    ) -> List[Tuple[int, str]]:
        """
        Merge consecutive short paragraphs until the buffer reaches
        _MIN_PARA_LENGTH words.

        Hard flush boundaries (never merge across):
          - is_chapter_start=True  — paragraph follows a chapter_heading
          - stop prefix            — paragraph begins a commentary section

        Soft flush: once buffer_len >= _MIN_PARA_LENGTH words, flush.
        """
        result: List[Tuple[int, str]] = []
        buffer: List[str] = []
        buffer_len: int = 0
        buffer_page: int | None = None

        def _flush():
            nonlocal buffer, buffer_len, buffer_page
            if buffer:
                result.append((buffer_page, '\n'.join(buffer)))
            buffer = []
            buffer_len = 0
            buffer_page = None

        for page_num, text, is_chapter_start in paragraphs:
            # Hard boundaries — flush before absorbing this paragraph
            if buffer and (is_chapter_start or
                           _starts_with_stop_prefix(text, stop_prefixes)):
                _flush()

            if not buffer:
                buffer_page = page_num

            buffer.append(text)
            buffer_len += len(text.split())

            if buffer_len >= _MIN_PARA_LENGTH:
                _flush()

        _flush()
        return result