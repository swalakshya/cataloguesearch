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
      2. The next block's text starts with a stop or QA prefix, OR
      3. The next block is a chapter_heading.
  - stop_words from scan_config provides the stop prefix list.

Phase 1.5 — Q&A tagging:
  - Takes Phase 1 output and tags each paragraph as QA or non-QA.
  - A paragraph is QA if its text starts with a question_prefix or
    answer_prefix (from scan_config) after stripping optional leading
    number markers like '(२) ', '(3) '.

Phase 2 — Minimum-length combining (target: 100 words):
  - Takes Phase 1.5 output (List[Tuple[int, str, bool, bool]]) and:
      * Combines consecutive QA paragraphs with '\n' (like advanced.py Phase 2)
      * Greedily merges consecutive non-QA paragraphs until >= 100 words
  - Hard flush boundaries (never merge across), in priority order:
      * is_chapter_start=True — chapter boundary, always flushes
      * QA ↔ non-QA type change
      * stop prefix — paragraph begins a commentary section (non-QA only)
  - The 100-word threshold is a soft minimum; if a logical section never
    reaches 100 words, it is output as-is.

Output: List[Tuple[int, str]] compatible with index_generator._write_paragraphs().
page_num in each tuple is the page of the first block in the paragraph.
"""
import logging
import re
from typing import List, Tuple

from backend.config import Config
from backend.crawler.paragraph_generator.base import BaseParagraphGenerator
from backend.crawler.paragraph_generator.language_meta import LanguageMeta

log_handle = logging.getLogger(__name__)

_MIN_PARA_LENGTH = 100  # minimum words per output paragraph

# Strips optional leading number markers like '(२) ', '(3) ', '3. ' before
# QA prefix matching. Handles ASCII and Devanagari digits.
_QA_MARKER_RE = re.compile(r'^[\s([{\'"]*[0-9०-९]+[\s.)\]}\'"]*')


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
                - "stop_words":      list[str]      — prefixes that close the buffer
                - "question_prefix": list[str]      — question paragraph prefixes
                - "answer_prefix":   list[str]      — answer paragraph prefixes
                - "typo_list":       list[[str,str]] — typo corrections

        Returns:
            List of (page_num, paragraph_text) tuples.
        """
        stop_prefixes = tuple(scan_config.get("stop_words", []))
        question_prefixes = tuple(scan_config.get("question_prefix", []))
        answer_prefixes = tuple(scan_config.get("answer_prefix", []))
        typo_list = scan_config.get("typo_list", [])

        qa_prefixes = question_prefixes + answer_prefixes
        phase1 = self._phase1_sentence_boundaries(pages_data, stop_prefixes, qa_prefixes, typo_list)
        phase1_5 = self._phase1_5_tag_qa(phase1, question_prefixes, answer_prefixes)
        phase2 = self._phase2_min_length(phase1_5, stop_prefixes)

        log_handle.info(
            "GranthParagraphGenerator: %d pages → %d (phase1) → %d (phase1.5) → %d (phase2) paragraphs",
            len(pages_data), len(phase1), len(phase1_5), len(phase2)
        )
        return phase2

    # ------------------------------------------------------------------
    # Phase 1 — sentence-boundary combining
    # ------------------------------------------------------------------

    def _phase1_sentence_boundaries(
        self,
        pages_data: List[Tuple[int, List[dict]]],
        stop_prefixes: tuple,
        qa_prefixes: tuple,
        typo_list: list,
    ) -> List[Tuple[int, str, bool]]:
        """
        Combine hindi_text blocks into complete sentences.

        Buffer is flushed on:
          1. Punctuation suffix at end of current text.
          2. Next block starts with a stop or QA prefix.
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

                if buffer and (self._starts_with_prefix(text, stop_prefixes) or
                               self._starts_with_prefix(text, qa_prefixes)):
                    _flush()

                if not buffer:
                    buffer_page = page_num

                buffer.append(text)

                if text.endswith(self.punctuation_suffixes):
                    _flush()

        _flush()
        return result

    # ------------------------------------------------------------------
    # Phase 1.5 — Q&A tagging
    # ------------------------------------------------------------------

    def _phase1_5_tag_qa(
        self,
        paragraphs: List[Tuple[int, str, bool]],
        question_prefixes: tuple,
        answer_prefixes: tuple,
    ) -> List[Tuple[int, str, bool, bool]]:
        """
        Tag each paragraph as QA or non-QA.

        A paragraph is tagged as QA if its text starts with a question or
        answer prefix after optionally stripping leading number markers
        (e.g. '(२) प्रश्न:' → 'प्रश्न:').

        Returns List[Tuple[page_num, text, is_chapter_start, is_qa]].
        Combining of consecutive QA blocks is handled by Phase 2.
        """
        qa_prefixes = question_prefixes + answer_prefixes
        result: List[Tuple[int, str, bool, bool]] = []

        for page_num, text, is_chapter_start in paragraphs:
            stripped = _QA_MARKER_RE.sub('', text)
            is_qa = (self._starts_with_prefix(text, qa_prefixes) or
                     self._starts_with_prefix(stripped, qa_prefixes))
            result.append((page_num, text, is_chapter_start, is_qa))

        return result

    # ------------------------------------------------------------------
    # Phase 2 — minimum-length combining
    # ------------------------------------------------------------------

    def _phase2_min_length(
        self,
        paragraphs: List[Tuple[int, str, bool, bool]],
        stop_prefixes: tuple,
    ) -> List[Tuple[int, str]]:
        """
        Combine consecutive QA paragraphs with '\\n', and greedily merge
        consecutive non-QA paragraphs until _MIN_PARA_LENGTH words.

        Hard flush boundaries (never merge across), in priority order:
          - is_chapter_start=True  — chapter boundary, always flushes
          - QA ↔ non-QA type change
          - stop prefix            — paragraph begins a commentary section (non-QA only)

        Soft flush: once non-QA buffer_len >= _MIN_PARA_LENGTH words, flush.
        """
        result: List[Tuple[int, str]] = []
        buffer: List[str] = []
        buffer_len: int = 0
        buffer_page: int | None = None
        buffer_is_qa: bool = False

        def _flush():
            nonlocal buffer, buffer_len, buffer_page, buffer_is_qa
            if buffer:
                result.append((buffer_page, '\n'.join(buffer)))
            buffer = []
            buffer_len = 0
            buffer_page = None
            buffer_is_qa = False

        for page_num, text, is_chapter_start, is_qa in paragraphs:
            # Chapter boundary always flushes — regardless of QA or non-QA
            if buffer and is_chapter_start:
                _flush()

            # Flush on type change (QA ↔ non-QA)
            if buffer and is_qa != buffer_is_qa:
                _flush()

            # stop_prefix is a hard boundary for non-QA only
            if not is_qa and buffer and self._starts_with_prefix(text, stop_prefixes):
                _flush()

            if not buffer:
                buffer_page = page_num
                buffer_is_qa = is_qa

            buffer.append(text)

            if not is_qa:
                buffer_len += len(text.split())
                if buffer_len >= _MIN_PARA_LENGTH:
                    _flush()

        _flush()
        return result