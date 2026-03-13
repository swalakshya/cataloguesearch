"""
Tests for LLMIndexGenerator — paragraph generation and verse file writing.

No OpenSearch required (dry_run=True throughout).
All assertions use structural / indicator checks, not full-string matching:
  - phrase presence/absence in a paragraph
  - two phrases in the same vs different paragraphs
  - verse file existence, absence, and type composition
"""

import json
import os
from unittest.mock import MagicMock

import pytest

from backend.config import Config
from backend.crawler.llm_index_generator import LLMIndexGenerator
from tests.backend.base import *  # brings in module-scoped autouse `initialise` fixture

# ── paths ─────────────────────────────────────────────────────────────────────
_DATA_DIR  = os.path.join(os.path.dirname(__file__), "../data/granth")
_ALPHA_DIR = os.path.join(_DATA_DIR, "alpha")
_BETA_DIR  = os.path.join(_DATA_DIR, "beta")

# ── scan config ───────────────────────────────────────────────────────────────
_SCAN_CONFIG = {
    "chunk_strategy": "llm",
    "ocr_engine":     "llm",       # ensures LLMParagraphGenerator is selected
    "stop_words":      ["विशेष"],
    "question_prefix": ["प्रश्न"],
    "answer_prefix":   ["उत्तर"],
    "verses":          ["hindi_verse", "prakrit_verse", "sanskrit_verse"],
    "typo_list":       [],
}
_ALL_VERSE_TYPES = ["hindi_verse", "prakrit_verse", "sanskrit_verse"]

# ── helpers ───────────────────────────────────────────────────────────────────

def _pages_list(ocr_dir):
    return sorted(
        int(f[5:-5])
        for f in os.listdir(ocr_dir)
        if f.startswith("page_") and f.endswith(".json")
    )


class _DirectProcessor:
    """Minimal read-only processor — reads page_*.json directly, no Config needed."""
    def read_paragraphs(self, ocr_dir, pages_list):
        result = []
        for page_num in pages_list:
            path = os.path.join(ocr_dir, f"page_{page_num:04d}.json")
            with open(path, encoding="utf-8") as fh:
                result.append((page_num, json.load(fh)))
        return result


def _make_gen():
    return LLMIndexGenerator(Config(), MagicMock())


def _run_index(ocr_dir, text_dir, pages=None, clean=True):
    gen = _make_gen()
    gen.index_document(
        "test_doc", "test.pdf",
        ocr_dir, text_dir, pages or _pages_list(ocr_dir),
        {"language": "hi"}, _SCAN_CONFIG, {},
        dry_run=True,
        pdf_processor=_DirectProcessor(),
        clean_output_dir=clean,
    )
    return gen


def _all_paragraphs(text_dir):
    """Flat list of all output paragraph strings across all page_*.txt files."""
    paras = []
    for fname in sorted(os.listdir(text_dir)):
        if fname.startswith("page_") and fname.endswith(".txt"):
            with open(os.path.join(text_dir, fname), encoding="utf-8") as fh:
                content = fh.read().strip()
            if content:
                paras.extend(content.split("\n----\n"))
    return paras


def _verse_page_nums(text_dir):
    """Set of page numbers that have a verses_NNNN.json file."""
    return {
        int(f[7:-5])
        for f in os.listdir(text_dir)
        if f.startswith("verses_") and f.endswith(".json")
    }


def _read_verse_file(text_dir, page_num):
    path = os.path.join(text_dir, f"verses_{page_num:04d}.json")
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


# ── module-scoped fixtures ────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def alpha_output(tmp_path_factory):
    text_dir = str(tmp_path_factory.mktemp("alpha"))
    _run_index(_ALPHA_DIR, text_dir)
    return text_dir


@pytest.fixture(scope="module")
def beta_output(tmp_path_factory):
    text_dir = str(tmp_path_factory.mktemp("beta"))
    _run_index(_BETA_DIR, text_dir)
    return text_dir


@pytest.fixture(scope="module")
def subsection_output(tmp_path_factory):
    """Alpha indexed in two passes (pages 1-7, then 8-13) into the same output dir."""
    text_dir = str(tmp_path_factory.mktemp("subsec"))
    _run_index(_ALPHA_DIR, text_dir, pages=list(range(1, 8)),  clean=True)
    _run_index(_ALPHA_DIR, text_dir, pages=list(range(8, 14)), clean=False)
    return text_dir


# ═════════════════════════════════════════════════════════════════════════════
# Alpha — paragraph generation
# ═════════════════════════════════════════════════════════════════════════════

class TestAlphaParagraphGeneration:

    def test_overflow_blocks_merge_across_pages(self, alpha_output):
        """Incomplete blocks on page 1 continue onto page 2 → one multi-line paragraph."""
        paras = _all_paragraphs(alpha_output)
        overflow = [p for p in paras if "पानी हवा और धूप" in p]
        assert len(overflow) == 1
        assert "जीवित नहीं रह सकता" in overflow[0]   # page-2 completion present
        assert "\n" in overflow[0]                      # multi-line = merge happened

    def test_chapter_heading_separates_sections(self, alpha_output):
        """Chapter 1 prose and chapter 2 prose land in different paragraphs."""
        paras = _all_paragraphs(alpha_output)
        ch1 = next((p for p in paras if "वर्षा के कारण नदियां" in p), None)
        ch2 = next((p for p in paras if "भारत एक विविधताओं" in p), None)
        assert ch1 is not None and ch2 is not None
        assert ch1 is not ch2

    def test_qa_pairs_joined_with_newline(self, alpha_output):
        """Q and A (page 3) appear together in one paragraph, separated by \\n."""
        paras = _all_paragraphs(alpha_output)
        qa = [p for p in paras if "प्रश्न:" in p and "उत्तर:" in p]
        assert len(qa) >= 1
        assert "\n" in qa[0]

    def test_all_page3_qa_blocks_in_one_paragraph(self, alpha_output):
        """Both Q-A pairs from page 3 are consecutive QA → all four joined together."""
        paras = _all_paragraphs(alpha_output)
        merged = [p for p in paras if "ऑक्सीजन पाई जाती है" in p and "आठ मिनट" in p]
        assert len(merged) == 1

    def test_stop_word_not_merged_with_preceding_prose(self, alpha_output):
        """विशेष: starts its own paragraph — not merged with the preceding prose."""
        paras = _all_paragraphs(alpha_output)
        visesh = next((p for p in paras if p.strip().startswith("विशेष:")), None)
        assert visesh is not None
        assert "भारत एक विविधताओं" not in visesh

    def test_short_blocks_merged_by_phase2(self, alpha_output):
        """6 short sentences on page 4 are merged into fewer output paragraphs."""
        page4_path = os.path.join(alpha_output, "page_0004.txt")
        with open(page4_path, encoding="utf-8") as fh:
            page4_paras = fh.read().strip().split("\n----\n")
        assert len(page4_paras) < 6   # 6 input blocks → greedily merged

    def test_verse_end_marker_flushes_paragraph(self, alpha_output):
        """Paragraph ending with ।।११।। is closed; the next sentence starts fresh."""
        paras = _all_paragraphs(alpha_output)
        verse_end = next((p for p in paras if "।।११।।" in p), None)
        assert verse_end is not None
        assert "तापमान का सीधा संबंध" not in verse_end

    def test_numbered_qa_tagged_and_joined_with_answer(self, alpha_output):
        """(१) प्रश्न: on page 10 is recognised as QA and joined with its उत्तर:."""
        paras = _all_paragraphs(alpha_output)
        numbered = [p for p in paras if "(१) प्रश्न:" in p]
        assert len(numbered) == 1
        assert "उत्तर:" in numbered[0]
        assert "\n" in numbered[0]
        # Second pair on the same page should also be in the same merged QA paragraph
        assert "(२) प्रश्न:" in numbered[0]

    def test_sanskrit_text_blocks_excluded_from_paragraphs(self, alpha_output):
        """sanskrit_text on page 9 is not a hindi_text block → skipped entirely."""
        paras = _all_paragraphs(alpha_output)
        assert not any("हिमालयः पर्वतराजः" in p for p in paras)

    def test_footnote_excluded_from_paragraphs(self, alpha_output):
        """footnote blocks are not hindi_text → never appear in paragraph output."""
        paras = _all_paragraphs(alpha_output)
        assert not any("पर्यावरण संरक्षण पर आधारित" in p for p in paras)

    def test_trailing_overflow_flushed_at_eof(self, alpha_output):
        """Page 13 ends without punctuation — remaining buffer flushed at end of input."""
        paras = _all_paragraphs(alpha_output)
        assert any("कंप्यूटर और इंटरनेट" in p for p in paras)


# ═════════════════════════════════════════════════════════════════════════════
# Alpha — verse files
# ═════════════════════════════════════════════════════════════════════════════

class TestAlphaVerseFiles:

    def test_verse_files_created_for_verse_pages(self, alpha_output):
        assert {5, 6, 7, 12}.issubset(_verse_page_nums(alpha_output))

    def test_no_verse_files_for_prose_only_pages(self, alpha_output):
        assert not {1, 2, 3, 4, 8, 9, 10, 11, 13} & _verse_page_nums(alpha_output)

    def test_page9_has_no_verse_file(self, alpha_output):
        """sanskrit_text is not a verse block type — no verses_0009.json produced."""
        assert 9 not in _verse_page_nums(alpha_output)

    def test_page5_contains_only_prakrit_verse(self, alpha_output):
        verses = _read_verse_file(alpha_output, 5)
        assert len(verses) == 1
        assert verses[0]["type"] == "prakrit_verse"

    def test_page6_contains_only_sanskrit_verse(self, alpha_output):
        verses = _read_verse_file(alpha_output, 6)
        assert len(verses) == 1
        assert verses[0]["type"] == "sanskrit_verse"

    def test_page7_contains_hindi_verse_not_footnote(self, alpha_output):
        verses = _read_verse_file(alpha_output, 7)
        assert len(verses) == 1
        assert verses[0]["type"] == "hindi_verse"

    def test_page12_contains_all_three_verse_types(self, alpha_output):
        verses = _read_verse_file(alpha_output, 12)
        types = {v["type"] for v in verses}
        assert types == {"hindi_verse", "prakrit_verse", "sanskrit_verse"}


# ═════════════════════════════════════════════════════════════════════════════
# _prepare_embedding_text
# ═════════════════════════════════════════════════════════════════════════════

class TestPrepareEmbeddingText:
    """LLMIndexGenerator strips [bracket] glosses before embedding."""

    @pytest.fixture(scope="class")
    def gen(self):
        return _make_gen()

    def test_bracket_content_removed(self, gen):
        result = gen._prepare_embedding_text("इस गाथा में [प्राकृत भाषा] समता की बात है।")
        assert "[" not in result and "]" not in result
        assert "प्राकृत भाषा" not in result
        assert "समता की बात" in result           # surrounding text preserved

    def test_multiple_bracket_groups_all_removed(self, gen):
        result = gen._prepare_embedding_text("[A] foo [B] bar")
        assert "[" not in result
        assert "foo" in result and "bar" in result

    def test_plain_text_unchanged(self, gen):
        text = "कोई भी ब्रैकेट नहीं है यहाँ।"
        assert gen._prepare_embedding_text(text) == text


# ═════════════════════════════════════════════════════════════════════════════
# Beta — paragraph generation
# ═════════════════════════════════════════════════════════════════════════════

class TestBetaParagraphGeneration:

    def test_overflow_blocks_merge_across_pages(self, beta_output):
        """Pages 1-2 overflow: incomplete blocks join across the page boundary."""
        paras = _all_paragraphs(beta_output)
        overflow = [p for p in paras if "बादलों का अध्ययन" in p]
        assert len(overflow) == 1
        assert "किसानों को समय पर" in overflow[0]
        assert "\n" in overflow[0]

    def test_qa_immediately_after_overflow(self, beta_output):
        """Page 2: Q-A pair after the overflow sentence is joined into one paragraph."""
        paras = _all_paragraphs(beta_output)
        qa = [p for p in paras if "बादल कैसे बनते हैं" in p and "वाष्पीकरण" in p]
        assert len(qa) == 1
        assert "\n" in qa[0]

    def test_numbered_qa_joined(self, beta_output):
        """Page 3: (१)/(२) numbered QA — both pairs land in one merged paragraph."""
        paras = _all_paragraphs(beta_output)
        numbered = [p for p in paras if "(१) प्रश्न:" in p]
        assert len(numbered) == 1
        assert "इक्कीस प्रतिशत" in numbered[0]
        assert "(२) प्रश्न:" in numbered[0]

    def test_stop_word_not_merged_with_preceding_prose(self, beta_output):
        """विशेष: (page 4) is a hard phase-2 boundary — prose before it is flushed first."""
        paras = _all_paragraphs(beta_output)
        visesh = next((p for p in paras if "विशेष:" in p), None)
        assert visesh is not None
        assert "ताप और प्रकाश" not in visesh

    def test_chapter_break_at_page5(self, beta_output):
        """Chapter 2 heading (page 5) separates pre- and post-chapter content."""
        paras = _all_paragraphs(beta_output)
        pre  = next((p for p in paras if "सौर पैनल" in p), None)
        post = next((p for p in paras if "भूकंप एक प्राकृतिक" in p), None)
        assert pre is not None and post is not None
        assert pre is not post

    def test_verse_end_in_hindi_text_flushes_paragraph(self, beta_output):
        """।।१०।। embedded in a hindi_text block forces a flush after that paragraph."""
        paras = _all_paragraphs(beta_output)
        verse_end = next((p for p in paras if "।।१०।।" in p), None)
        assert verse_end is not None
        assert "इससे नई भूमि" not in verse_end

    def test_sanskrit_text_skipped(self, beta_output):
        paras = _all_paragraphs(beta_output)
        assert not any("वसन्ते पुष्पिता" in p for p in paras)

    def test_trailing_overflow_flushed_at_eof(self, beta_output):
        paras = _all_paragraphs(beta_output)
        assert any("वृक्षारोपण से वायु" in p for p in paras)


# ═════════════════════════════════════════════════════════════════════════════
# Beta — verse files
# ═════════════════════════════════════════════════════════════════════════════

class TestBetaVerseFiles:

    def test_verse_files_created_for_verse_pages(self, beta_output):
        assert {5, 6, 7, 12}.issubset(_verse_page_nums(beta_output))

    def test_no_verse_files_for_prose_only_pages(self, beta_output):
        assert not {1, 2, 3, 4, 8, 9, 10, 11, 13} & _verse_page_nums(beta_output)

    def test_page5_contains_only_prakrit_verse(self, beta_output):
        verses = _read_verse_file(beta_output, 5)
        assert len(verses) == 1
        assert verses[0]["type"] == "prakrit_verse"

    def test_page7_contains_hindi_verse_not_footnote(self, beta_output):
        verses = _read_verse_file(beta_output, 7)
        assert len(verses) == 1
        assert verses[0]["type"] == "hindi_verse"

    def test_page12_contains_all_three_verse_types(self, beta_output):
        verses = _read_verse_file(beta_output, 12)
        assert {v["type"] for v in verses} == {"hindi_verse", "prakrit_verse", "sanskrit_verse"}


# ═════════════════════════════════════════════════════════════════════════════
# Sub-section isolation
# ═════════════════════════════════════════════════════════════════════════════

class TestSubsectionIsolation:
    """
    Alpha indexed in two passes (pages 1-7 and 8-13) into the same output dir.
    _read_verse_files must respect pages_list to prevent cross-contamination.
    """

    def test_section_a_does_not_see_section_b_verse_pages(self, subsection_output):
        verse_data = _make_gen()._read_verse_files(
            subsection_output, _ALL_VERSE_TYPES, list(range(1, 8))
        )
        returned = {page_num for page_num, _ in verse_data}
        assert returned.issubset(range(1, 8))
        assert 12 not in returned            # page 12 belongs to section B

    def test_section_b_does_not_see_section_a_verse_pages(self, subsection_output):
        verse_data = _make_gen()._read_verse_files(
            subsection_output, _ALL_VERSE_TYPES, list(range(8, 14))
        )
        returned = {page_num for page_num, _ in verse_data}
        assert returned.issubset(range(8, 14))
        assert not {5, 6, 7} & returned      # pages 5,6,7 belong to section A

    def test_section_a_returns_correct_verse_pages(self, subsection_output):
        verse_data = _make_gen()._read_verse_files(
            subsection_output, _ALL_VERSE_TYPES, list(range(1, 8))
        )
        assert {page_num for page_num, _ in verse_data} == {5, 6, 7}

    def test_section_b_returns_correct_verse_pages(self, subsection_output):
        verse_data = _make_gen()._read_verse_files(
            subsection_output, _ALL_VERSE_TYPES, list(range(8, 14))
        )
        assert {page_num for page_num, _ in verse_data} == {12}

    def test_verse_type_filter_applied(self, subsection_output):
        """Requesting only prakrit_verse excludes the other two types on page 12."""
        verse_data = _make_gen()._read_verse_files(
            subsection_output, ["prakrit_verse"], list(range(8, 14))
        )
        for _, blocks in verse_data:
            assert all(b["type"] == "prakrit_verse" for b in blocks)