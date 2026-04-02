import json
import logging
import os
import re
from dataclasses import dataclass, field
from enum import Enum, auto
from typing import List, Set, Optional, Tuple

from backend.crawler.paragraph_generator.base import BaseParagraphGenerator, ParaInfo
from backend.crawler.paragraph_generator.language_meta import LanguageMeta
from backend.crawler.paragraph_generator.sizer import split_long_para, ABSOLUTE_TERM_RE

log_handle = logging.getLogger(__name__)


# --- State and Data Structures (EXACT copy from para_gen.py) ---

class State(Enum):
    """Represents the current processing state of the generator."""
    STANDARD_PROSE = auto()
    VERSE_BLOCK = auto()
    QA_BLOCK = auto()


@dataclass
class Line:
    """Represents a single line of text with its properties and classifications."""
    text: str
    x_start: int
    x_end: int
    page_num: int
    line_num: int
    tags: Set[str] = field(default_factory=set)
    speaker: Optional[str] = None


@dataclass
class Paragraph:
    """Represents a finalized paragraph with type information."""
    text: str
    page_num: int
    paragraph_type: State
    start_line: int
    end_line: int


# --- Configuration Constants (from para_gen.py) ---

HEADING_MARKERS = ()
# HEADING_MARKERS = (
#     '★',
#     'काव्य -',
#     'काव्य-',
#     'अर्थः',
#     'शब्दार्थः',
#     'शब्दार्थ',
# )

HINDI_SENTENCE_TERMINATORS = ('।', '?', '!', '।।', ')', ']', '}')
GUJARATI_SENTENCE_TERMINATORS = ('।', '.', '?', '!', '।।', ')', ']', '}')

_MIN_PARA_LENGTH = 50   # default minimum words per output paragraph
_MAX_PARA_LENGTH = 250  # default maximum words per output paragraph (override via scan_config max_words_per_para)


# --- LineClassifier (EXACT copy from para_gen.py) ---

class LineClassifier:
    """
    Analyzes raw line data and assigns classification tags.
    """

    def __init__(self, avg_left_margin, avg_right_margin, indent_threshold=15,
                 center_threshold=20, header_regexes=None,
                 question_prefix=None, answer_prefix=None, sentence_terminators=None):
        self.avg_left_margin = avg_left_margin
        self.avg_right_margin = avg_right_margin
        self.indent_threshold = indent_threshold
        self.center_threshold = center_threshold
        self.header_regexes = header_regexes if header_regexes is not None else []
        self.question_prefix = question_prefix if question_prefix is not None else []
        self.answer_prefix = answer_prefix if answer_prefix is not None else []
        self.sentence_terminators = sentence_terminators if sentence_terminators is not None else HINDI_SENTENCE_TERMINATORS

    def classify(self, text: str, x_start: int, x_end: int, page_num: int,
                 line_num: int) -> Line:
        """Assigns a set of tags to a line based on its properties."""
        tags = set()
        speaker = None

        is_indented = (x_start - self.avg_left_margin) > self.indent_threshold
        left_indent_amount = x_start - self.avg_left_margin
        right_indent_amount = self.avg_right_margin - x_end
        is_centered = (
                is_indented and
                right_indent_amount > self.center_threshold
        )
        is_not_right_justified = (
                right_indent_amount > self.indent_threshold
        )

        if is_centered:
            tags.add('IS_CENTERED')
        elif is_indented:
            tags.add('IS_INDENTED')

        if is_not_right_justified:
            tags.add('IS_NOT_RIGHT_JUSTIFIED')

        stripped_text = text.strip()
        if not stripped_text:
            tags.add('IS_EMPTY')
            return Line(text, int(x_start), int(x_end), page_num, line_num, tags, speaker)

        # Detect very short centered lines (likely decorative elements misread by OCR)
        # Examples: stars (★ ★ ★) OCR'd as random chars like "और #औ", dashes, etc.
        # Treat them as headers so they become standalone paragraphs and don't break prose flow
        if is_centered and len(stripped_text) <= 10:
            tags.add('IS_HEADER_REGEX')

        # Check for header regex matches
        for pattern in self.header_regexes:
            if re.search(pattern, stripped_text):
                tags.add('IS_HEADER_REGEX')
                break

        # Check if line starts with any QA prefix
        for prefix in self.question_prefix + self.answer_prefix:
            if stripped_text.startswith(prefix):
                tags.add('IS_QA')
                speaker = prefix
                break

        if stripped_text.startswith(HEADING_MARKERS):
            tags.add('IS_HEADING')

        if stripped_text.endswith(self.sentence_terminators):
            tags.add('HAS_SENTENCE_TERMINATOR')

        if re.search(r'।।\d+।।$', stripped_text):
            tags.add('IS_ABSOLUTE_TERMINATOR')

        return Line(text, int(x_start), int(x_end), page_num, line_num, tags, speaker)


# --- ParagraphGenerator State Machine (EXACT copy from para_gen.py) ---

class ParagraphGenerator:
    """
    A state-based engine that processes classified lines to generate paragraphs.
    """

    def __init__(self):
        self.state = State.STANDARD_PROSE
        self.paragraphs: List[Paragraph] = []
        self._reset_current_paragraph()

    def _reset_current_paragraph(self, line: Optional[Line] = None):
        self.current_paragraph_lines: List[Line] = []
        self.current_paragraph_speaker: Optional[str] = None
        if line:
            self.paragraph_start_line = line.line_num
            self.paragraph_page_num = line.page_num
        else:
            self.paragraph_start_line = -1
            self.paragraph_page_num = -1

    def _finalize_paragraph(self):
        if not self.current_paragraph_lines:
            return
        # Use newlines for verses and Q&A to preserve line structure, spaces for prose
        separator = '\n' if self.state in (State.VERSE_BLOCK, State.QA_BLOCK) else ' '
        full_text = separator.join(
            line.text.strip() for line in self.current_paragraph_lines).strip()
        if full_text:
            end_line = self.current_paragraph_lines[-1].line_num
            para = Paragraph(
                text=full_text,
                page_num=self.paragraph_page_num,
                paragraph_type=self.state,
                start_line=self.paragraph_start_line,
                end_line=end_line
            )
            self.paragraphs.append(para)

    def process_line(self, line: Line):
        if 'IS_EMPTY' in line.tags:
            return
        # Handle header regex matches: end paragraph, reset state, and skip the line
        if 'IS_HEADER_REGEX' in line.tags:
            self._finalize_paragraph()
            self._reset_current_paragraph()
            self.state = State.STANDARD_PROSE
            return
        initial_state = self.state
        handler = getattr(self, f'_handle_{initial_state.name.lower()}_state')
        reprocess = handler(line)
        if reprocess:
            self.process_line(line)

    def flush(self):
        self._finalize_paragraph()
        return self.paragraphs

    def _handle_standard_prose_state(self, line: Line) -> bool:
        # IS_HEADING should be its own standalone paragraph
        if 'IS_HEADING' in line.tags:
            self._finalize_paragraph()
            self._reset_current_paragraph(line)
            self.current_paragraph_lines.append(line)
            self._finalize_paragraph()
            self._reset_current_paragraph()
            return False

        # IS_ABSOLUTE_TERMINATOR should end the current paragraph (be the last line)
        if 'IS_ABSOLUTE_TERMINATOR' in line.tags:
            if not self.current_paragraph_lines:
                self._reset_current_paragraph(line)
            self.current_paragraph_lines.append(line)
            self._finalize_paragraph()
            self._reset_current_paragraph()
            return False

        # Check IS_QA before IS_CENTERED because Q&A lines take priority
        # (short Q&A lines can be both centered and QA, but should be treated as QA)
        if 'IS_QA' in line.tags:
            self._finalize_paragraph()
            self._reset_current_paragraph(line)
            self.state = State.QA_BLOCK
            return True
        if 'IS_CENTERED' in line.tags:
            self._finalize_paragraph()
            self._reset_current_paragraph(line)
            self.state = State.VERSE_BLOCK
            return True

        # IS_INDENTED should start a new paragraph
        if 'IS_INDENTED' in line.tags:
            self._finalize_paragraph()
            self._reset_current_paragraph(line)
            self.current_paragraph_lines.append(line)
            return False

        if not self.current_paragraph_lines:
            self._reset_current_paragraph(line)
        self.current_paragraph_lines.append(line)
        is_last_line = ('HAS_SENTENCE_TERMINATOR' in line.tags and
                        'IS_NOT_RIGHT_JUSTIFIED' in line.tags)
        if is_last_line:
            self._finalize_paragraph()
            self._reset_current_paragraph()
        return False

    def _handle_verse_block_state(self, line: Line) -> bool:
        if 'IS_CENTERED' in line.tags:
            self.current_paragraph_lines.append(line)
            return False
        else:
            self._finalize_paragraph()
            self._reset_current_paragraph(line)
            self.state = State.STANDARD_PROSE
            return True

    def _handle_qa_block_state(self, line: Line) -> bool:
        """
        Handle QA block state. Exit when encountering:
        1. Headers (IS_HEADING)
        2. Absolute terminators (IS_ABSOLUTE_TERMINATOR)
        3. New QA blocks (IS_QA - start of new question/answer)
        4. Verse blocks (IS_CENTERED)
        5. New prose paragraphs (IS_INDENTED but not IS_QA)
        """
        # IS_HEADING should end QA block and switch to prose state
        if 'IS_HEADING' in line.tags:
            self._finalize_paragraph()
            self._reset_current_paragraph(line)
            self.state = State.STANDARD_PROSE
            return True

        # IS_ABSOLUTE_TERMINATOR should end the current QA paragraph
        if 'IS_ABSOLUTE_TERMINATOR' in line.tags:
            if not self.current_paragraph_lines:
                self._reset_current_paragraph(line)
            self.current_paragraph_lines.append(line)
            self._finalize_paragraph()
            self._reset_current_paragraph()
            self.state = State.STANDARD_PROSE
            return False

        # New QA block (new question/answer starts) - end current and start new
        if 'IS_QA' in line.tags:
            self._finalize_paragraph()
            self._reset_current_paragraph(line)
            self.current_paragraph_lines.append(line)
            # Stay in QA_BLOCK state, don't reprocess
            return False

        # Centered text (verse) - end QA block and switch to verse
        if 'IS_CENTERED' in line.tags:
            self._finalize_paragraph()
            self._reset_current_paragraph(line)
            self.state = State.VERSE_BLOCK
            return True

        # Indented non-QA lines (new prose paragraph) - end QA block and switch to prose
        if 'IS_INDENTED' in line.tags:
            self._finalize_paragraph()
            self._reset_current_paragraph(line)
            self.state = State.STANDARD_PROSE
            return True

        # Add the line to current paragraph (no speaker-based splitting)
        if not self.current_paragraph_lines:
            self._reset_current_paragraph(line)
        self.current_paragraph_lines.append(line)
        return False


# --- AdvancedParagraphGenerator ---

class AdvancedParagraphGenerator(BaseParagraphGenerator):
    """
    Advanced paragraph generator that processes raw OCR JSON data.

    Three-phase processing:
    1. Lines → typed paragraphs (using state machine)
    2. Combine consecutive VERSE_BLOCK and QA_BLOCK
    3. Combine prose blocks based on punctuation
    """

    def __init__(self, config, language_meta: LanguageMeta):
        super().__init__(config, language_meta)

    def generate_paragraphs(self, pages_data: list[dict],
                            scan_config: dict) -> List[Tuple[int, str]]:
        """
        Generate paragraphs from raw OCR data.

        Args:
            pages_data: List of dictionaries with page_num, metadata, and lines
            scan_config: Configuration with typo_list, header_regex, question_prefix, etc.

        Returns:
            List of (page_num, paragraph_text) tuples
        """
        min_words = scan_config.get("min_words_per_para", _MIN_PARA_LENGTH)
        max_words = scan_config.get("max_words_per_para", _MAX_PARA_LENGTH)

        # Phase 1: Convert lines to typed paragraphs
        typed_paragraphs = self._phase1_lines_to_typed_paragraphs(
            pages_data, scan_config
        )

        # Phase 2: Combine consecutive blocks by type
        combined_by_type = self._phase2_combine_by_type(typed_paragraphs)

        # Phase 3: Merge to min word length, build page_spans
        phase3 = self._phase3_combine_prose(combined_by_type, min_words)

        # Phase 4: Split oversized paragraphs (only if max configured)
        if max_words is not None:
            phase4 = self._phase4_split_to_max(phase3, max_words)
        else:
            phase4 = phase3

        return [(p.page_num, p.text) for p in phase4]

    def _phase1_lines_to_typed_paragraphs(
            self, pages_data: list[dict],
            scan_config: dict) -> List[Tuple[int, str, State]]:
        """
        Phase 1: Normalize lines and apply state machine.

        Args:
            pages_data: List of page dictionaries with metadata and lines
            scan_config: Configuration dictionary

        Returns:
            List of (page_num, paragraph_text, paragraph_type) tuples
        """
        header_regexes = scan_config.get("header_regex", [])
        strip_regex = scan_config.get("strip_regex", [])
        question_prefix = scan_config.get("question_prefix", [])
        answer_prefix = scan_config.get("answer_prefix", [])
        typo_list = scan_config.get("typo_list", [])

        all_typed_paragraphs = []

        for page_data in pages_data:
            page_num = page_data.get("page_num", 0)
            lines_data = page_data.get("lines", [])
            metadata = page_data.get("metadata", {})

            if not lines_data:
                continue

            # Get margin metadata
            prose_left_margin = metadata.get("prose_left_margin", 0)
            prose_right_margin = metadata.get("prose_right_margin", 0)

            # Get language-specific sentence terminators from language_meta
            sentence_terminators = self._language_meta.sentence_terminators

            # Create classifier with margins and QA prefixes
            classifier = LineClassifier(
                prose_left_margin, prose_right_margin,
                header_regexes=header_regexes,
                question_prefix=question_prefix,
                answer_prefix=answer_prefix,
                sentence_terminators=sentence_terminators
            )

            # Normalize lines and classify
            generator = ParagraphGenerator()
            for line_data in lines_data:
                # Normalize text using base class method (which delegates to language_meta)
                raw_text = line_data.get("text", "")
                normalized_text = self._normalize_text(raw_text, typo_list, strip_regex)

                # Create classified line
                classified_line = classifier.classify(
                    text=normalized_text,
                    x_start=line_data.get("x_start", 0),
                    x_end=line_data.get("x_end", 0),
                    page_num=page_num,
                    line_num=line_data.get("line_num", 0)
                )

                generator.process_line(classified_line)

            # Get paragraphs with types
            page_paragraphs = generator.flush()
            for para in page_paragraphs:
                all_typed_paragraphs.append((para.page_num, para.text, para.paragraph_type))

        return all_typed_paragraphs

    def _phase2_combine_by_type(
            self, typed_paragraphs: List[Tuple[int, str, State]]) -> List[Tuple[int, str, State]]:
        """
        Phase 2: Combine consecutive VERSE_BLOCK and QA_BLOCK paragraphs.

        Returns:
            List of (page_num, paragraph_text, paragraph_type) tuples
        """
        if not typed_paragraphs:
            return []

        combined = []
        i = 0

        while i < len(typed_paragraphs):
            page_num, text, para_type = typed_paragraphs[i]

            if para_type == State.VERSE_BLOCK:
                # Combine consecutive VERSE_BLOCK
                verse_texts = [text]
                i += 1
                while i < len(typed_paragraphs) and typed_paragraphs[i][2] == State.VERSE_BLOCK:
                    verse_texts.append(typed_paragraphs[i][1])
                    i += 1
                combined_text = '\n'.join(verse_texts)
                combined.append((page_num, combined_text, State.VERSE_BLOCK))

            elif para_type == State.QA_BLOCK:
                # Combine consecutive QA_BLOCK
                qa_texts = [text]
                i += 1
                while i < len(typed_paragraphs) and typed_paragraphs[i][2] == State.QA_BLOCK:
                    qa_texts.append(typed_paragraphs[i][1])
                    i += 1
                combined_text = '\n'.join(qa_texts)
                combined.append((page_num, combined_text, State.QA_BLOCK))

            else:
                # STANDARD_PROSE - keep as is for now
                combined.append((page_num, text, para_type))
                i += 1

        return combined

    def _phase3_combine_prose(
            self,
            typed_paragraphs: List[Tuple[int, str, State]],
            min_para_len: int = _MIN_PARA_LENGTH,
    ) -> List[ParaInfo]:
        """
        Phase 3: Merge paragraphs to min word length, same logic as granth Phase 2.

        Hard flush boundaries:
          - VERSE_BLOCK: emit immediately, never merged
          - QA_BLOCK ↔ STANDARD_PROSE type change

        For STANDARD_PROSE: merge consecutive blocks until min_para_len words.
        For QA_BLOCK: combine with '\\n'; type change is the only hard boundary.

        Builds page_spans tracking word offsets at page transitions.
        """
        if not typed_paragraphs:
            return []

        result: List[ParaInfo] = []
        buffer: List[str] = []
        buffer_len: int = 0       # word count for threshold (prose only)
        buffer_wc: int = 0        # total word count for page_spans tracking
        buffer_page: int | None = None
        buffer_type: State | None = None
        buffer_page_spans: list = []

        def _flush():
            nonlocal buffer, buffer_len, buffer_wc, buffer_page, buffer_type, buffer_page_spans
            if buffer:
                separator = '\n' if buffer_type == State.QA_BLOCK else ' '
                result.append(ParaInfo(
                    page_num=buffer_page,
                    text=separator.join(buffer),
                    page_spans=buffer_page_spans[:],
                ))
            buffer.clear()
            buffer_len = 0
            buffer_wc = 0
            buffer_page = None
            buffer_type = None
            buffer_page_spans = []

        for page_num, text, para_type in typed_paragraphs:
            # VERSE_BLOCK: flush buffer, emit immediately
            if para_type == State.VERSE_BLOCK:
                _flush()
                result.append(ParaInfo(
                    page_num=page_num,
                    text=text,
                    page_spans=[(page_num, 0)],
                ))
                continue

            # Type change: flush
            if buffer and para_type != buffer_type:
                _flush()

            wc = len(text.split())

            if not buffer:
                buffer_page = page_num
                buffer_type = para_type
                buffer_page_spans = [(page_num, 0)]
            else:
                if page_num != buffer_page_spans[-1][0]:
                    buffer_page_spans.append((page_num, buffer_wc))

            buffer.append(text)
            buffer_wc += wc

            if para_type == State.STANDARD_PROSE:
                buffer_len += wc
                if ABSOLUTE_TERM_RE.search(text):
                    _flush()
                elif buffer_len >= min_para_len and text.strip().endswith(
                        tuple(self._language_meta.sentence_terminators)):
                    _flush()
            # QA_BLOCK: no word-count threshold; type change flushes

        _flush()
        return result

    # ------------------------------------------------------------------
    # Phase 4 — split oversized paragraphs
    # ------------------------------------------------------------------

    def _phase4_split_to_max(
            self,
            paragraphs: List[ParaInfo],
            max_words: int,
    ) -> List[ParaInfo]:
        """
        Split any paragraph exceeding max_words at sentence boundaries.
        Delegates to sizer.split_long_para using language-specific terminators.
        """
        result: List[ParaInfo] = []
        for para in paragraphs:
            result.extend(split_long_para(para, max_words, self._language_meta.sentence_terminators))
        return result

