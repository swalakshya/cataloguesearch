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
      2. The last added text ends with a verse marker (e.g. ।।67।।), OR
      3. The next block's text starts with a stop or QA prefix, OR
      4. The next block is a chapter_heading.
  - stop_words from scan_config provides the stop prefix list.

Phase 1.5 — Q&A tagging:
  - Takes Phase 1 output (List[ParaInfo]) and sets is_qa on each paragraph.
  - A paragraph is QA if its text starts with a question_prefix or
    answer_prefix (from scan_config) after stripping optional leading
    number markers like '(२) ', '(3) '.

Phase 2 — Minimum-length combining (target: 50 words):
  - Takes Phase 1.5 output (List[ParaInfo]) and:
      * Flushes immediately after is_verse_end paragraphs (hard boundary)
      * Combines consecutive QA paragraphs with '\\n'
      * Greedily merges consecutive non-QA paragraphs until >= 50 words
  - Hard flush boundaries (never merge across), in priority order:
      * is_chapter_start=True — chapter boundary, always flushes before
      * QA ↔ non-QA type change
      * stop prefix — paragraph begins a commentary section (non-QA only)
      * is_verse_end=True — flushes after adding the paragraph
  - The 50-word threshold is a soft minimum; if a logical section never
    reaches 50 words, it is output as-is.

Output: List[Tuple[int, str]] compatible with index_generator._write_paragraphs().
page_num in each tuple is the page of the first block in the paragraph.
"""
import logging
import re
from typing import List, Tuple

from backend.config import Config
from backend.crawler.paragraph_generator.base import BaseParagraphGenerator, ParaInfo
from backend.crawler.paragraph_generator.language_meta import LanguageMeta

log_handle = logging.getLogger(__name__)

_MIN_PARA_LENGTH = 50  # minimum words per output paragraph

# Strips optional leading number markers like '(२) ', '(3) ', '3. ' before
# QA prefix matching. Handles ASCII and Devanagari digits.
_QA_MARKER_RE = re.compile(r'^[\s([{\'"]*[0-9०-९]+[\s.)\]}\'"]*')

# Matches verse-number markers at the end of a block, e.g.:
#   ।।67।।   ।67।   ||67||   |67|   ।।68-199।।
# Optionally followed by closing quote characters.
_VERSE_END_RE = re.compile(
    r'[।|]{1,2}[0-9०-९][-–—0-9०-९]*[।|]{1,2}["\'\u201c\u201d\u2018\u2019\s]*$'
)


class GranthParagraphGenerator(BaseParagraphGenerator):
    """
    Paragraph generator for Granth LLM-extracted typed blocks.

    Unlike BaseParagraphGenerator / AdvancedParagraphGenerator which operate
    on Tesseract-style line data, this generator takes LLM-extracted
    (page_num, [{\"type\": ..., \"text\": ...}]) data directly.

    generate_paragraphs() runs Phase 1 → Phase 1.5 → Phase 2 and returns
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
        qa_prefixes: tuple,
        typo_list: list,
    ) -> List[ParaInfo]:
        """
        Combine hindi_text blocks into complete sentences.

        Buffer is flushed on:
          1. Punctuation suffix at end of current text.
          2. Verse marker at end of current text (e.g. ।।67।।, optionally with trailing quote).
          3. Next block starts with a stop or QA prefix.
          4. Next block is a chapter_heading (hard break; heading not emitted).

        Returns List[ParaInfo] where:
          - is_chapter_start=True marks the first paragraph after a chapter_heading.
          - is_verse_end=True marks a paragraph whose last line ends with a verse marker.
        """
        result: List[ParaInfo] = []
        buffer: List[str] = []
        buffer_page: int | None = None
        chapter_break: bool = False  # signals next flush output is chapter_start

        def _flush():
            nonlocal buffer, buffer_page, chapter_break
            if buffer:
                text = '\n'.join(buffer)
                is_verse_end = bool(_VERSE_END_RE.search(buffer[-1]))
                result.append(ParaInfo(
                    page_num=buffer_page,
                    text=text,
                    is_chapter_start=chapter_break,
                    is_verse_end=is_verse_end,
                ))
                chapter_break = False
            buffer.clear()
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

                if text.endswith(self.punctuation_suffixes) or _VERSE_END_RE.search(text):
                    _flush()

        _flush()
        return result

    # ------------------------------------------------------------------
    # Phase 1.5 — Q&A tagging
    # ------------------------------------------------------------------

    def _phase1_5_tag_qa(
        self,
        paragraphs: List[ParaInfo],
        question_prefixes: tuple,
        answer_prefixes: tuple,
    ) -> List[ParaInfo]:
        """
        Tag each paragraph as QA or non-QA by setting is_qa on each ParaInfo.

        A paragraph is tagged as QA if its text starts with a question or
        answer prefix after optionally stripping leading number markers
        (e.g. '(२) प्रश्न:' → 'प्रश्न:').
        """
        qa_prefixes = question_prefixes + answer_prefixes
        for para in paragraphs:
            stripped = _QA_MARKER_RE.sub('', para.text)
            para.is_qa = (self._starts_with_prefix(para.text, qa_prefixes) or
                          self._starts_with_prefix(stripped, qa_prefixes))
        return paragraphs

    # ------------------------------------------------------------------
    # Phase 2 — minimum-length combining
    # ------------------------------------------------------------------

    def _phase2_min_length(
        self,
        paragraphs: List[ParaInfo],
        stop_prefixes: tuple,
    ) -> List[Tuple[int, str]]:
        """
        Combine consecutive QA paragraphs with '\\n', and greedily merge
        consecutive non-QA paragraphs until _MIN_PARA_LENGTH words.

        Hard flush boundaries (never merge across), in priority order:
          - is_chapter_start=True  — chapter boundary, flushes before
          - QA ↔ non-QA type change
          - stop prefix            — paragraph begins a commentary section (non-QA only)
          - is_verse_end=True      — flushes after adding the paragraph

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
            buffer.clear()
            buffer_len = 0
            buffer_page = None
            buffer_is_qa = False

        for para in paragraphs:
            # Chapter boundary always flushes — regardless of QA or non-QA
            if buffer and para.is_chapter_start:
                _flush()

            # Flush on type change (QA ↔ non-QA)
            if buffer and para.is_qa != buffer_is_qa:
                _flush()

            # stop_prefix is a hard boundary for non-QA only
            if not para.is_qa and buffer and self._starts_with_prefix(para.text, stop_prefixes):
                _flush()

            if not buffer:
                buffer_page = para.page_num
                buffer_is_qa = para.is_qa

            buffer.append(para.text)

            # Verse-end: flush immediately after adding (hard post-flush boundary)
            if para.is_verse_end:
                _flush()
            elif not para.is_qa:
                buffer_len += len(para.text.split())
                if buffer_len >= _MIN_PARA_LENGTH:
                    _flush()

        _flush()
        return result