import re
import pytesseract
import pandas as pd
from pdf2image import convert_from_path
from enum import Enum, auto
from dataclasses import dataclass, field
from typing import List, Set, Optional, Tuple
import logging

from backend.utils import json_dumps
from backend.crawler.paragraph_generator.base import BaseParagraphGenerator
from backend.crawler.paragraph_generator.language_meta import get_language_meta
from backend.config import Config

log_handle = logging.getLogger(__name__)

# --- Configuration Constants ---

# Heading markers that indicate structural breaks in the document
HEADING_MARKERS = (
    '★',
    'काव्य -',
    'काव्य-',
    'अर्थः',
    'शब्दार्थः',
    'शब्दार्थ',
)

# Header regex patterns - lines matching these will end paragraphs and be excluded
HEADER_REGEX = [
    # Add your regex patterns here, e.g.:
    # r'^\s*Page\s+\d+',  # Page numbers
    # r'^\s*Chapter\s+\d+',  # Chapter headings
]

# Sentence terminators in Devanagari script
SENTENCE_TERMINATORS = ('।', '?', '!', '।।', ')', ']', '}')


# --- Data Structures and State Enum ---

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
    """Represents a finalized paragraph."""
    text: str
    page_num: int
    paragraph_type: State
    start_line: int
    end_line: int

    def __repr__(self):
        return (
            f"--- PARAGRAPH (Page: {self.page_num}, Type: {self.paragraph_type.name}, "
            f"Lines: {self.start_line}-{self.end_line}) ---\n"
            f"{self.text.strip()}\n"
            f"---------------------------------------------------\n"
        )


# --- Classification Logic (Unchanged) ---

class LineClassifier:
    """
    Analyzes raw line data and assigns classification tags.
    This class determines the "what" for each line.
    """

    def __init__(self, avg_left_margin, avg_right_margin, indent_threshold=15,
                 center_threshold=20, header_regexes=None,
                 question_prefix=None, answer_prefix=None):
        self.avg_left_margin = avg_left_margin
        self.avg_right_margin = avg_right_margin
        self.indent_threshold = indent_threshold
        self.center_threshold = center_threshold
        # Use provided header_regexes or fall back to default HEADER_REGEX
        self.header_regexes = header_regexes if header_regexes is not None else HEADER_REGEX
        # Use provided QA prefixes or empty lists
        self.question_prefix = question_prefix if question_prefix is not None else []
        self.answer_prefix = answer_prefix if answer_prefix is not None else []

    def classify(self, text: str, x_start: int, x_end: int, page_num: int,
                 line_num: int) -> Line:
        """Assigns a set of tags to a line based on its properties."""
        tags = set()
        speaker = None

        left_indent_amount = x_start - self.avg_left_margin
        right_indent_amount = self.avg_right_margin - x_end
        is_indented = left_indent_amount > self.indent_threshold
        is_centered = (
                is_indented and
                right_indent_amount > self.center_threshold
        )
        is_not_right_justified = (
                right_indent_amount > self.indent_threshold
        )

        stripped_text = text.strip()

        # Check QA prefixes first — a recognised speaker tag takes priority over
        # geometry. A short QA line can look "centered" but must not be treated
        # as a verse.
        for prefix in self.question_prefix + self.answer_prefix:
            if stripped_text.startswith(prefix):
                tags.add('IS_QA')
                speaker = prefix
                break

        # Only apply geometry tags when the line is not already a QA line.
        if 'IS_QA' not in tags:
            if is_centered:
                tags.add('IS_CENTERED')
            elif is_indented:
                tags.add('IS_INDENTED')

        # Debug logging for centered/indented lines
        if is_indented and not is_centered:
            log_handle.verbose(
                f"Line {line_num}: INDENTED but NOT CENTERED - "
                f"left_indent={left_indent_amount:.1f}, right_indent={right_indent_amount:.1f}, "
                f"center_threshold={self.center_threshold}, text='{stripped_text}'"
            )
        elif is_centered and 'IS_QA' not in tags:
            log_handle.verbose(
                f"Line {line_num}: CENTERED - "
                f"left_indent={left_indent_amount:.1f}, right_indent={right_indent_amount:.1f}, "
                f"text='{stripped_text}'"
            )

        if is_not_right_justified:
            tags.add('IS_NOT_RIGHT_JUSTIFIED')

        if not stripped_text:
            tags.add('IS_EMPTY')

        # Check for header regex matches
        for pattern in self.header_regexes:
            if re.search(pattern, stripped_text):
                tags.add('IS_HEADER_REGEX')
                break

        if stripped_text.startswith(HEADING_MARKERS):
            tags.add('IS_HEADING')

        if stripped_text.endswith(SENTENCE_TERMINATORS):
            tags.add('HAS_SENTENCE_TERMINATOR')

        if re.search(r'।।\d+।।$', stripped_text):
            tags.add('IS_ABSOLUTE_TERMINATOR')

        return Line(text, int(x_start), int(x_end), page_num, line_num, tags,
                    speaker)


# --- State Machine Logic (Unchanged) ---

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
        # Use newlines for verses to preserve line structure, spaces for prose
        separator = '\n' if self.state == State.VERSE_BLOCK else ' '
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
            log_handle.verbose(
                f"FINALIZED paragraph (lines {self.paragraph_start_line}-{end_line}, "
                f"type={self.state.name}): '{full_text[:60]}'"
            )

    def process_line(self, line: Line):
        if 'IS_EMPTY' in line.tags:
            log_handle.verbose(f"Line {line.line_num}: SKIPPED (empty)")
            return
        # Handle header regex matches: end paragraph and skip the line
        if 'IS_HEADER_REGEX' in line.tags:
            log_handle.verbose(f"Line {line.line_num}: {line} SKIPPED (header regex match)")
            self._finalize_paragraph()
            self._reset_current_paragraph()
            return
        initial_state = self.state
        log_handle.verbose(
            f"Line {line.line_num}: Processing in {initial_state.name} state, "
            f"tags={line.tags}, text='{line.text.strip()}'"
        )
        handler = getattr(self, f'_handle_{initial_state.name.lower()}_state')
        reprocess = handler(line)
        if reprocess:
            log_handle.verbose(f"Line {line.line_num}: REPROCESSING after state change to {self.state.name}")
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
        if 'IS_CENTERED' in line.tags:
            self._finalize_paragraph()
            self._reset_current_paragraph(line)
            self.state = State.VERSE_BLOCK
            return True
        if 'IS_QA' in line.tags:
            self._finalize_paragraph()
            self._reset_current_paragraph(line)
            self.state = State.QA_BLOCK
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

        # Indented non-QA lines should end QA block and switch to prose
        is_new_prose = ('IS_INDENTED' in line.tags and
                        'IS_QA' not in line.tags)
        if is_new_prose:
            self._finalize_paragraph()
            self._reset_current_paragraph(line)
            self.state = State.STANDARD_PROSE
            return True
        if 'IS_QA' in line.tags:
            if self.current_paragraph_speaker is None:
                self.current_paragraph_speaker = line.speaker
            elif self.current_paragraph_speaker != line.speaker:
                self._finalize_paragraph()
                self._reset_current_paragraph(line)
                self.current_paragraph_speaker = line.speaker
        if not self.current_paragraph_lines:
            self._reset_current_paragraph(line)
        self.current_paragraph_lines.append(line)
        return False


# --- Reusable Image Processing Function ---

def process_image_to_paragraphs(
    image: 'Image',
    lang: str,
    page_num: int = 1,
    start_line_num: int = 0,
    scan_config: dict = None
) -> Tuple[List[Paragraph], int]:
    """
    Runs OCR on a single image, classifies lines, and generates paragraphs.

    This is the core reusable function for processing a single image.

    Args:
        image: A PIL.Image object to process.
        lang: Tesseract language string (e.g., 'hin+guj').
        page_num: The page number for context.
        start_line_num: The global line number to start counting from.
        scan_config: Optional scan configuration dictionary with header_regex and other settings.

    Returns:
        A tuple containing a list of generated Paragraph objects and the updated
        global line counter.
    """
    scan_config = scan_config or {}
    log_handle.info(f"scan_config: {json_dumps(scan_config, truncate_fields=['typo_list'])}")

    # Create appropriate text normalizer based on language
    config = Config("configs/config.yaml")
    language_code = 'gu' if 'guj' in lang.lower() else 'hi'
    language_meta = get_language_meta(language_code, scan_config)
    text_normalizer = BaseParagraphGenerator(config, language_meta)
    log_handle.info(f"Using {language_code} language for text normalization")

    try:
        # Use PSM 6 as it's best for uniform blocks of text, which our
        # line-by-line analysis prefers.
        ocr_data = pytesseract.image_to_data(
            image, lang=lang, output_type=pytesseract.Output.DATAFRAME,
            config='--psm 6'
        )
    except pytesseract.TesseractNotFoundError:
        log_handle.error("Tesseract Error: The Tesseract executable was not found.")
        log_handle.error("Please make sure Tesseract is installed and its location is "
                         "in your system's PATH.")
        raise

    ocr_data = ocr_data.dropna(subset=['text'])
    ocr_data = ocr_data[ocr_data.conf > 10]

    if ocr_data.empty:
        return [], start_line_num

    # Get typo_list from scan_config
    typo_list = scan_config.get("typo_list", [])

    # Reconstruct lines from word data
    lines_on_page = []
    for _, line_df in ocr_data.groupby(['block_num', 'par_num', 'line_num']):
        text = ' '.join(line_df['text'].astype(str))
        # Normalize text using the appropriate paragraph generator
        text = text_normalizer._normalize_text(text, typo_list)
        x_start = line_df['left'].min()
        x_end = (line_df['left'] + line_df['width']).max()
        lines_on_page.append({'text': text, 'x_start': x_start, 'x_end': x_end})

    if not lines_on_page:
        return [], start_line_num

    # --- Robust Margin Calculation by Averaging the Two Extremes ---
    # This is robust against a single outlier, which is common with OCR noise.
    if len(lines_on_page) < 4:
        # With too few lines, a simple median is the safest option.
        sorted_left = sorted([l['x_start'] for l in lines_on_page])
        sorted_right = sorted([l['x_end'] for l in lines_on_page])
        prose_left_margin = sorted_left[len(sorted_left) // 2]
        prose_right_margin = sorted_right[len(sorted_right) // 2]
    else:
        # Sort all margins once
        sorted_left_margins = sorted([line['x_start'] for line in lines_on_page])
        sorted_right_margins = sorted([line['x_end'] for line in lines_on_page])

        # Average the 2 smallest left margins
        prose_left_margin = (sorted_left_margins[0] + sorted_left_margins[1]) / 2
        # Average the 2 largest right margins
        prose_right_margin = (sorted_right_margins[-1] + sorted_right_margins[-2]) / 2

    # Extract configuration from scan_config if available
    header_regexes = scan_config.get("header_regex", None)
    question_prefix = scan_config.get("question_prefix", None)
    answer_prefix = scan_config.get("answer_prefix", None)
    classifier = LineClassifier(
        prose_left_margin, prose_right_margin,
        header_regexes=header_regexes,
        question_prefix=question_prefix,
        answer_prefix=answer_prefix
    )

    generator = ParagraphGenerator()
    line_counter = start_line_num
    for line_info in lines_on_page:
        classified_line = classifier.classify(text=line_info['text'], x_start=line_info['x_start'],
                                              x_end=line_info['x_end'], page_num=page_num, line_num=line_counter)
        generator.process_line(classified_line)
        line_counter += 1

    return generator.flush(), line_counter

# --- Main PDF Processing Function (MODIFIED FOR PYTESSERACT) ---

def process_pdf_with_tesseract(
        pdf_path: str, lang: str = 'hin+guj',
        top_crop: int = 0, bottom_crop: int = 0) -> List[Tuple[int, str]]:
    """
    Converts PDF pages to images, runs Tesseract OCR, and generates paragraphs.

    Args:
        pdf_path: Path to the PDF file
        lang: Tesseract language code (default: 'hin+guj')
        top_crop: Percentage to crop from top (0-50)
        bottom_crop: Percentage to crop from bottom (0-50)
    """
    try:
        log_handle.info(f"Converting PDF to images: {pdf_path}")
        images = convert_from_path(pdf_path)
    except Exception as e:
        log_handle.error("Error converting PDF to images. "
              "Is Poppler installed and in your PATH?")
        log_handle.error(f"Original error: {e}")
        return []

    generator = ParagraphGenerator()
    global_line_counter = 0

    # Validate crop percentages
    if not (0 <= top_crop <= 50):
        log_handle.warning(f"top_crop must be between 0 and 50. Using 0.")
        top_crop = 0
    if not (0 <= bottom_crop <= 50):
        log_handle.warning(f"bottom_crop must be between 0 and 50. Using 0.")
        bottom_crop = 0

    if top_crop > 0 or bottom_crop > 0:
        log_handle.info(f"Cropping enabled: {top_crop}% from top, "
              f"{bottom_crop}% from bottom")

    for page_num, image in enumerate(images, 1):
        log_handle.verbose(f"Processing page {page_num}/{len(images)} from {pdf_path}")
        # Apply cropping if specified
        if top_crop > 0 or bottom_crop > 0:
            width, height = image.size
            top_pixels = int(height * top_crop / 100)
            bottom_pixels = int(height * bottom_crop / 100)
            # Crop: (left, top, right, bottom)
            cropped_image = image.crop((0, top_pixels, width, height - bottom_pixels))
        else:
            cropped_image = image

        try:
            # Use the new reusable function
            page_paragraphs, global_line_counter = process_image_to_paragraphs(
                cropped_image, lang, page_num, global_line_counter
            )
            generator.paragraphs.extend(page_paragraphs)
        except pytesseract.TesseractNotFoundError:
            return []

    final_paragraphs = generator.flush()
    log_handle.info(f"Successfully generated {len(final_paragraphs)} paragraphs from {pdf_path}")

    output = [(p.page_num, p.text) for p in final_paragraphs]
    return output


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(
        description='Extract paragraphs from PDF using OCR')
    parser.add_argument('pdf_file', help='Path to the PDF file')
    parser.add_argument('--top-crop', type=int, default=0,
                        help='Percentage to crop from top (0-50, default: 0)')
    parser.add_argument('--bottom-crop', type=int, default=0,
                        help='Percentage to crop from bottom (0-50, default: 0)')
    parser.add_argument('--lang', type=str, default='hin+guj',
                        help='Tesseract language code (default: hin+guj)')

    args = parser.parse_args()

    try:
        # Call the new tesseract-based function with crop parameters
        paragraphs_output = process_pdf_with_tesseract(
            args.pdf_file,
            lang=args.lang,
            top_crop=args.top_crop,
            bottom_crop=args.bottom_crop
        )

        if paragraphs_output:
            print(f"Successfully processed {len(paragraphs_output)} "
                  f"paragraphs using Tesseract.\n")
            for i, (page, content) in enumerate(paragraphs_output):
                print(f"--- Paragraph {i + 1} (from Page {page}) ---")
                print(content)
                print("-" * (20 + len(str(i + 1)) + len(str(page))))

    except FileNotFoundError:
        log_handle.error(f"Error: The file '{args.pdf_file}' was not found.")
    except Exception as e:
        log_handle.error(f"An unexpected error occurred: {e}")