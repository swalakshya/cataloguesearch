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
_GAMMA_DIR = os.path.join(_DATA_DIR, "gamma")

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

_SCAN_CONFIG_GAMMA = {
    **_SCAN_CONFIG,
    "qa_merge":     False,
    "header_regex": ["^\\(\\d+\\)$"],
    "strip_regex":  [["।\\s*\\d+", "।"]],
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
# Gamma — header_regex, strip_regex, qa_merge=False
# ═════════════════════════════════════════════════════════════════════════════

@pytest.fixture(scope="module")
def gamma_output(tmp_path_factory):
    text_dir = str(tmp_path_factory.mktemp("gamma"))
    gen = _make_gen()
    gen.index_document(
        "test_doc", "test.pdf",
        _GAMMA_DIR, text_dir, _pages_list(_GAMMA_DIR),
        {"language": "hi"}, _SCAN_CONFIG_GAMMA, {},
        dry_run=True,
        pdf_processor=_DirectProcessor(),
        clean_output_dir=True,
    )
    return text_dir


class TestGammaCleanupConfig:

    def test_header_regex_block_not_in_output(self, gamma_output):
        """( ९ ) is a standalone hindi_text block matching header_regex — skipped entirely."""
        paras = _all_paragraphs(gamma_output)
        assert not any("( ९ )" in p for p in paras)

    def test_strip_regex_removes_trailing_number(self, gamma_output):
        """Trailing '। 42' is reduced to '।' — the digit is stripped, purn viram kept."""
        paras = _all_paragraphs(gamma_output)
        para = next((p for p in paras if "ज्ञान का प्रकाश" in p), None)
        assert para is not None
        assert "42" not in para
        assert "।" in para

    def test_qa_merge_false_each_pair_is_separate_paragraph(self, gamma_output):
        """With qa_merge=False, Q1+A1 and Q2+A2 are in two separate paragraphs."""
        paras = _all_paragraphs(gamma_output)
        first_pair  = next((p for p in paras if "आत्मा का स्वभाव" in p), None)
        second_pair = next((p for p in paras if "मोक्ष कैसे" in p), None)
        assert first_pair is not None
        assert second_pair is not None
        assert first_pair is not second_pair


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


# ── qa_merge behaviour ────────────────────────────────────────────────────────

def _qa_blocks(*pairs):
    """Build a single-page pages_data with Q+A block pairs.

    Each pair is (question_text, answer_text).
    """
    blocks = []
    for q, a in pairs:
        blocks.append({"type": "hindi_text", "text": q})
        blocks.append({"type": "hindi_text", "text": a})
    return [(1, blocks)]


_QA_SCAN_CONFIG_BASE = {
    "ocr_engine": "llm",
    "question_prefix": ["प्रश्न"],
    "answer_prefix": ["उत्तर"],
    "typo_list": [],
}

_QA_PAIRS = [
    ("प्रश्न १ – पहला प्रश्न क्या है?", "उत्तर – पहला उत्तर यह है।"),
    ("प्रश्न २ – दूसरा प्रश्न क्या है?", "उत्तर – दूसरा उत्तर यह है।"),
    ("प्रश्न ३ – तीसरा प्रश्न क्या है?", "उत्तर – तीसरा उत्तर यह है।"),
]


class TestQaMergeBehaviour:
    def _gen_paragraphs(self, qa_merge=None):
        from backend.crawler.paragraph_generator.granth import GranthParagraphGenerator
        from backend.crawler.paragraph_generator.language_meta import HindiMeta
        cfg = dict(_QA_SCAN_CONFIG_BASE)
        if qa_merge is not None:
            cfg["qa_merge"] = qa_merge
        gen = GranthParagraphGenerator(Config(), HindiMeta(cfg))
        return gen.generate_paragraphs(_qa_blocks(*_QA_PAIRS), cfg)

    def test_qa_merge_false_gives_one_para_per_pair(self):
        """qa_merge=False: each Q+A pair becomes its own paragraph."""
        paras = self._gen_paragraphs(qa_merge=False)
        assert len(paras) == 3, f"Expected 3 paragraphs, got {len(paras)}"
        for i, (_, text) in enumerate(paras):
            q_text, a_text = _QA_PAIRS[i]
            assert q_text in text
            assert a_text in text

    def test_qa_merge_true_merges_all_pairs(self):
        """qa_merge=True (default): all Q+A pairs merge into one paragraph."""
        paras = self._gen_paragraphs(qa_merge=True)
        assert len(paras) == 1, f"Expected 1 paragraph, got {len(paras)}"
        for q_text, a_text in _QA_PAIRS:
            assert q_text in paras[0][1]
            assert a_text in paras[0][1]

    def test_qa_merge_default_is_true(self):
        """Omitting qa_merge preserves existing behaviour (merge all)."""
        paras = self._gen_paragraphs(qa_merge=None)
        assert len(paras) == 1

    def test_qa_merge_false_numbered_questions(self):
        """qa_merge=False: numbered questions like '५. प्रश्न:' are still treated as
        question boundaries, so each Q+A pair is its own paragraph."""
        from backend.crawler.paragraph_generator.granth import GranthParagraphGenerator
        from backend.crawler.paragraph_generator.language_meta import HindiMeta
        cfg = {**_QA_SCAN_CONFIG_BASE, "qa_merge": False}
        numbered_pairs = [
            ("४. प्रश्न: सज्जन तो हास्य नहीं करेंगे?", "उत्तर: दुष्ट तो ऐसे ही होते हैं।"),
            ("५. प्रश्न: पूर्व ग्रन्थ तो हैं ही?", "उत्तर: ग्रन्थ का अभ्यास करने से लाभ होता है।"),
            ("६. प्रश्न: यह सत्य है कि हित होता है?", "उत्तर: यथार्थ सर्व पदार्थों के ज्ञाता केवली हैं।"),
        ]
        gen = GranthParagraphGenerator(Config(), HindiMeta(cfg))
        paras = gen.generate_paragraphs(_qa_blocks(*numbered_pairs), cfg)
        assert len(paras) == 3, f"Expected 3 paragraphs (one per Q+A pair), got {len(paras)}"
        for i, (_, text) in enumerate(paras):
            q_text, a_text = numbered_pairs[i]
            assert q_text in text, f"Q{i+1} missing from paragraph {i+1}"
            assert a_text in text, f"A{i+1} missing from paragraph {i+1}"

    def test_phase1_flushes_before_numbered_question(self):
        """Phase 1 must flush the buffer before a numbered question even when the
        preceding non-QA block does not end with terminal punctuation.
        Without the fix, '७. प्रश्न:' would be absorbed into the preceding buffer."""
        from backend.crawler.paragraph_generator.granth import GranthParagraphGenerator
        from backend.crawler.paragraph_generator.language_meta import HindiMeta
        cfg = {**_QA_SCAN_CONFIG_BASE, "qa_merge": False}
        pages_data = [(4, [
            {"type": "hindi_text", "text": "मान, माया, लोभ से व हास्य – कोई सूक्ष्म अर्थ का उपदेश दे तो पाप नहीं होता"},
            {"type": "hindi_text", "text": "७. प्रश्न: आपने विशेष ज्ञानी से टीका क्यों नहीं की?"},
            {"type": "hindi_text", "text": "उत्तर: कालदोष से केवली का अभाव है।"},
        ])]
        gen = GranthParagraphGenerator(Config(), HindiMeta(cfg))
        paras = gen.generate_paragraphs(pages_data, cfg)
        texts = [t for _, t in paras]
        # The non-QA prose must be its own paragraph, not merged with Q7
        assert any("मान, माया" in t and "प्रश्न" not in t for t in texts), \
            "Non-QA prose was merged with the numbered question"
        # Q7 and A7 must be together (qa_merge=False → one Q+A pair)
        assert any("७. प्रश्न" in t and "उत्तर" in t for t in texts), \
            "Q7 and A7 were not merged into one paragraph"


# ── hard_end_regex ─────────────────────────────────────────────────────────────

_HARD_END_SCAN_CONFIG = {
    "ocr_engine": "llm",
    "question_prefix": ["प्रश्न"],
    "answer_prefix": ["उत्तर"],
    "typo_list": [],
    "hard_end_regex": ["[0-9०-९]+\\.\\s*$"],
}


def _make_hard_end_gen():
    from backend.crawler.paragraph_generator.granth import GranthParagraphGenerator
    from backend.crawler.paragraph_generator.language_meta import HindiMeta
    return GranthParagraphGenerator(Config(), HindiMeta(_HARD_END_SCAN_CONFIG))


class TestHardEndRegex:

    def test_flush_on_devanagari_number_dot(self):
        """Block ending with Devanagari number + '.' is flushed and kept separate."""
        pages_data = [(1, [
            {"type": "hindi_text", "text": "'कुछ करे नहीं, तो गमे नहीं' ऐसी आदत हो गई है। लेकिन 'कुछ करे, तो गमे नहीं' ऐसा होना चाहिए। ८४."},
            {"type": "hindi_text", "text": "रुचि की आवश्यकता चाहिए, दरकार होनी चाहिए, थकावट होनी चाहिए।"},
        ])]
        gen = _make_hard_end_gen()
        paras = gen.generate_paragraphs(pages_data, _HARD_END_SCAN_CONFIG)
        texts = [t for _, t in paras]
        assert any("आदत हो गई है" in t and "रुचि की आवश्यकता" not in t for t in texts), \
            "Block ending ८४. was not kept as its own paragraph"
        assert any("रुचि की आवश्यकता" in t for t in texts), \
            "Following block missing from output"

    def test_flush_on_ascii_number_dot(self):
        """Block ending with ASCII digits + '.' also triggers a hard flush."""
        pages_data = [(1, [
            {"type": "hindi_text", "text": "जहाँ तक अंदर में डुबकी नहीं मारता, वहाँ तक प्रयत्न चालू रखना चाहिए। 86."},
            {"type": "hindi_text", "text": "प्रश्न: रुचि बढ़ते-बढ़ते महत्ता बढ़ती है?"},
            {"type": "hindi_text", "text": "उत्तर: रुचि बढ़ती है ऐसे लक्ष्य में पर्याय की महत्ता होती है।"},
        ])]
        gen = _make_hard_end_gen()
        paras = gen.generate_paragraphs(pages_data, _HARD_END_SCAN_CONFIG)
        texts = [t for _, t in paras]
        assert any("प्रयत्न चालू" in t and "प्रश्न:" not in t for t in texts), \
            "Block ending 86. was not separated from the following Q&A"

    def test_no_flush_without_config_key(self):
        """Omitting hard_end_regex → blocks with number-dot endings are not hard-bounded."""
        cfg_no_hard_end = {k: v for k, v in _HARD_END_SCAN_CONFIG.items() if k != "hard_end_regex"}
        pages_data = [(1, [
            {"type": "hindi_text", "text": "'कुछ करे नहीं, तो गमे नहीं' ऐसी आदत हो गई है। लेकिन 'कुछ करे, तो गमे नहीं' ऐसा होना चाहिए। ८४."},
            {"type": "hindi_text", "text": "रुचि की आवश्यकता चाहिए, दरकार होनी चाहिए, थकावट होनी चाहिए।"},
        ])]
        from backend.crawler.paragraph_generator.granth import GranthParagraphGenerator
        from backend.crawler.paragraph_generator.language_meta import HindiMeta
        gen = GranthParagraphGenerator(Config(), HindiMeta(cfg_no_hard_end))
        paras = gen.generate_paragraphs(pages_data, cfg_no_hard_end)
        texts = [t for _, t in paras]
        # Without hard_end_regex, ८४. doesn't trigger is_verse_end=True,
        # so phase 2 is free to merge the two short paragraphs.
        assert any("आदत हो गई है" in t and "रुचि की आवश्यकता" in t for t in texts), \
            "Without hard_end_regex, the two paragraphs should be merged by phase 2"

    def test_no_false_positive_number_mid_text(self):
        """'83. कुछ पाठ' at the START of a block does not trigger a hard flush."""
        pages_data = [(1, [
            {"type": "hindi_text", "text": "83. रुचि की आवश्यकता चाहिए, दरकार होनी चाहिए, थकावट होनी चाहिए।"},
            {"type": "hindi_text", "text": "जहाँ तक अंदर में डुबकी नहीं मारता, वहाँ तक प्रयत्न चालू रखना चाहिए।"},
        ])]
        gen = _make_hard_end_gen()
        paras = gen.generate_paragraphs(pages_data, _HARD_END_SCAN_CONFIG)
        texts = [t for _, t in paras]
        # Both blocks should land in the same paragraph (number is at start, not end)
        assert any("रुचि की आवश्यकता" in t and "डुबकी नहीं मारता" in t for t in texts), \
            "Number at start of text incorrectly triggered a hard flush"

    def test_hard_end_paragraphs_stay_separate_despite_short_length(self):
        """Each sutra ending with number-dot is kept separate even when short,
        because hard_end_regex sets is_verse_end=True which prevents phase 2 merging."""
        pages_data = [(1, [
            {"type": "hindi_text", "text": "कोई एकांत से वेदांत में खिंच नहीं जाता इसलिए दोनों बातें बताई हैं। ८७."},
            {"type": "hindi_text", "text": "जहाँ तक अंदर में आत्मा में डुबकी नहीं मारता वहाँ तक प्रयत्न चालू रखना चाहिए। ८८."},
        ])]
        gen = _make_hard_end_gen()
        paras = gen.generate_paragraphs(pages_data, _HARD_END_SCAN_CONFIG)
        texts = [t for _, t in paras]
        assert any("कोई एकांत से" in t and "जहाँ तक अंदर" not in t for t in texts), \
            "Sutra ८७. should be its own paragraph (not merged with ८८.)"
        assert any("जहाँ तक अंदर" in t for t in texts), \
            "Sutra ८८. should be in the output"