"""
Tests for AdvancedParagraphGenerator — all three phases.

No OpenSearch required. Calls generate_paragraphs() directly on hand-crafted
OCR JSON data in tests/data/ocr/advanced/qa_doc_hindi/.

Pages are designed to trigger every targetable uncovered branch:
  page 1 — baseline prose (IS_INDENTED start, IS_NOT_RIGHT_JUSTIFIED+punct end)
  page 2 — IS_EMPTY skip, VERSE_BLOCK embedded in prose
  page 3 — IS_ABSOLUTE_TERMINATOR in STANDARD_PROSE, IS_HEADER_REGEX (short centered),
            trailing verse that combines with page 4's opening verse
  page 4 — cross-page VERSE combine (Phase 2), IS_QA triggers QA_BLOCK, default
            append in QA_BLOCK, IS_QA in QA_BLOCK (new Q/A), consecutive QA combine
  page 5 — IS_ABSOLUTE_TERMINATOR in QA_BLOCK, IS_CENTERED in QA_BLOCK (→ verse),
            IS_INDENTED in QA_BLOCK (→ prose), Phase 3 QA pulls trailing prose

Assertion style: phrase presence / structural checks; never full-string matching.
"""

import json
import os

import pytest

from backend.config import Config
from backend.crawler.paragraph_generator.advanced import AdvancedParagraphGenerator
from backend.crawler.paragraph_generator.language_meta import get_language_meta
from tests.backend.base import *  # noqa: F401,F403 — brings in autouse `initialise` fixture

# ── paths ─────────────────────────────────────────────────────────────────────

_OCR_DIR = os.path.join(
    os.path.dirname(__file__), "../data/ocr/advanced/qa_doc_hindi"
)

# ── scan config ───────────────────────────────────────────────────────────────

_SCAN_CONFIG = {
    "question_prefix": ["प्रश्न:"],
    "answer_prefix":   ["उत्तर:"],
    "typo_list":       [],
    "header_regex":    [],
}

# ── helpers ───────────────────────────────────────────────────────────────────


def _load_pages(ocr_dir):
    pages = []
    for fname in sorted(os.listdir(ocr_dir)):
        if fname.startswith("page_") and fname.endswith(".json"):
            with open(os.path.join(ocr_dir, fname), encoding="utf-8") as fh:
                pages.append(json.load(fh))
    return pages


def _make_gen():
    language_meta = get_language_meta("hi", _SCAN_CONFIG)
    return AdvancedParagraphGenerator(Config(), language_meta)


# ── module-scoped fixture ─────────────────────────────────────────────────────


@pytest.fixture(scope="module")
def paragraphs():
    """Run generate_paragraphs() once; share results across all tests."""
    gen = _make_gen()
    pages_data = _load_pages(_OCR_DIR)
    result = gen.generate_paragraphs(pages_data, _SCAN_CONFIG)
    # result is a list of (page_num, text) tuples
    return [text for _, text in result]


# ═════════════════════════════════════════════════════════════════════════════
# Structural integrity
# ═════════════════════════════════════════════════════════════════════════════


class TestStructuralIntegrity:
    """Overall count and ordering sanity checks."""

    def test_total_paragraph_count(self, paragraphs):
        """5 pages of hand-crafted data produce exactly 10 final paragraphs."""
        assert len(paragraphs) == 10

    def test_no_empty_paragraphs(self, paragraphs):
        assert all(p.strip() for p in paragraphs)

    def test_air_pollution_before_knowledge(self, paragraphs):
        """Page 1 prose (air pollution) appears before page 3 prose (knowledge)."""
        air = next(i for i, p in enumerate(paragraphs) if "वायु प्रदूषण" in p)
        know = next(i for i, p in enumerate(paragraphs) if "ज्ञान ही वह शक्ति" in p)
        assert air < know


# ═════════════════════════════════════════════════════════════════════════════
# Baseline prose (page 1)
# ═════════════════════════════════════════════════════════════════════════════


class TestBaselineProse:
    """
    Page 1: two prose paragraphs formed by IS_INDENTED start + terminating line.
    Both are below the 50-word minimum so Phase 3 merges them together.
    """

    def test_first_prose_paragraph_content(self, paragraphs):
        """Page 1 para 1: air pollution topic is a single joined paragraph."""
        p = next((p for p in paragraphs if "वायु प्रदूषण" in p), None)
        assert p is not None
        assert "प्रत्यक्ष रूप से प्रभावित करती है" in p

    def test_second_prose_paragraph_content(self, paragraphs):
        """Page 1 para 2: factory smoke topic present in output."""
        p = next((p for p in paragraphs if "कारखानों" in p), None)
        assert p is not None
        assert "हानि पहुंचाते हैं" in p

    def test_short_page1_prose_paragraphs_merged_by_phase3(self, paragraphs):
        """Both page 1 prose blocks are below min-word threshold → merged into one."""
        p1 = next((p for p in paragraphs if "वायु प्रदूषण" in p), None)
        p2 = next((p for p in paragraphs if "कारखानों" in p), None)
        assert p1 is p2  # same merged paragraph
        assert "कारखानों" in p1
        assert "वायु प्रदूषण" in p1


# ═════════════════════════════════════════════════════════════════════════════
# IS_EMPTY skip (page 2, line 2)
# ═════════════════════════════════════════════════════════════════════════════


class TestIsEmptyLineSkipped:
    """
    Page 2 L2 is an empty line (IS_EMPTY tag). It must be silently skipped;
    the prose paragraph before it and the verse block after must still exist.
    Covers advanced.py lines 107-109.
    """

    def test_prose_before_empty_line_is_present(self, paragraphs):
        p = next((p for p in paragraphs if "जल मानव जीवन का आधार" in p), None)
        assert p is not None

    def test_verse_after_empty_line_is_present(self, paragraphs):
        p = next((p for p in paragraphs if "जल बचाओ" in p), None)
        assert p is not None
        assert "बूंद-बूंद से जीवन पाओ" in p

    def test_empty_line_not_in_any_paragraph(self, paragraphs):
        """The empty text must never appear in output."""
        assert not any(p.strip() == "" for p in paragraphs)


# ═════════════════════════════════════════════════════════════════════════════
# IS_HEADER_REGEX — short centered line discarded (page 3, line 3)
# ═════════════════════════════════════════════════════════════════════════════


class TestIsHeaderRegexDiscarded:
    """
    Page 3 L3 "~ ~" is IS_CENTERED and len ≤ 10 → IS_HEADER_REGEX → discarded.
    Covers advanced.py line 114-115.
    """

    def test_header_text_not_in_any_paragraph(self, paragraphs):
        assert not any("~ ~" in p for p in paragraphs)

    def test_prose_on_either_side_of_header_still_present(self, paragraphs):
        """Paragraphs from both before and after "~ ~" on page 3 survive."""
        before = any("।।३।।" in p for p in paragraphs)   # absolute terminator para before
        after  = any("आधुनिक तकनीक" in p for p in paragraphs)  # prose para after
        assert before and after


# ═════════════════════════════════════════════════════════════════════════════
# IS_ABSOLUTE_TERMINATOR in STANDARD_PROSE (page 3, line 2)
# ═════════════════════════════════════════════════════════════════════════════


class TestAbsoluteTerminatorInProse:
    """
    '।।३।।' triggers IS_ABSOLUTE_TERMINATOR → flushes the STANDARD_PROSE
    paragraph immediately, even mid-page. Covers advanced.py lines 212-218.
    """

    def test_absolute_terminator_paragraph_exists(self, paragraphs):
        p = next((p for p in paragraphs if "।।३।।" in p), None)
        assert p is not None
        assert "ज्ञान ही वह शक्ति" in p

    def test_absolute_terminator_splits_from_next_prose(self, paragraphs):
        """Prose after the terminator is a fresh paragraph, not merged in."""
        p_with_terminator = next((p for p in paragraphs if "।।३।।" in p), None)
        assert "आधुनिक तकनीक" not in p_with_terminator


# ═════════════════════════════════════════════════════════════════════════════
# VERSE_BLOCK (pages 2, 3, 4)
# ═════════════════════════════════════════════════════════════════════════════


class TestVerseBlocks:

    def test_page2_verse_is_multiline(self, paragraphs):
        """Centered verse lines joined with \\n, not space."""
        p = next((p for p in paragraphs if "जल बचाओ" in p), None)
        assert p is not None
        assert "\n" in p
        assert "बूंद-बूंद से जीवन पाओ" in p

    def test_verse_on_page2_separate_from_surrounding_prose(self, paragraphs):
        """Verse block is its own paragraph; surrounding prose is elsewhere."""
        verse = next((p for p in paragraphs if "जल बचाओ" in p), None)
        assert "जल मानव जीवन" not in verse
        assert "उपरोक्त पंक्तियों" not in verse

    def test_phase2_combines_cross_page_verse_blocks(self, paragraphs):
        """
        Page 3 trailing verse + page 4 opening verse are consecutive VERSE_BLOCKs
        → Phase 2 merges them into one paragraph.
        Covers advanced.py lines 445-447.
        """
        merged = [p for p in paragraphs if "ज्ञान दीप" in p and "सत्य का पथ" in p]
        assert len(merged) == 1
        assert "\n" in merged[0]

    def test_cross_page_verse_not_split(self, paragraphs):
        """Each verse phrase appears in exactly one paragraph (the combined one)."""
        gyan_paras  = [p for p in paragraphs if "ज्ञान दीप" in p]
        satya_paras = [p for p in paragraphs if "सत्य का पथ" in p]
        assert len(gyan_paras) == 1
        assert len(satya_paras) == 1
        assert gyan_paras[0] is satya_paras[0]


# ═════════════════════════════════════════════════════════════════════════════
# QA_BLOCK — classification, default append, IS_QA in QA, Phase 2 combine
# ═════════════════════════════════════════════════════════════════════════════


class TestQABlock:

    def test_qa_paragraphs_exist(self, paragraphs):
        """At least one paragraph contains both प्रश्न: and उत्तर:."""
        qa = [p for p in paragraphs if "प्रश्न:" in p and "उत्तर:" in p]
        assert len(qa) >= 1

    def test_qa_lines_joined_with_newline(self, paragraphs):
        """Q and A lines are stored with \\n separator (not space)."""
        qa = next((p for p in paragraphs if "प्रश्न:" in p and "उत्तर:" in p), None)
        assert "\n" in qa

    def test_phase2_combines_consecutive_qa_blocks(self, paragraphs):
        """
        4 Q/A pairs from page 4 + 4 Q/A pairs from page 5 form one merged QA block.
        Covers advanced.py lines 452-459.
        """
        big_qa = [
            p for p in paragraphs
            if "संसार में सबसे कीमती" in p and "जीवन का सबसे बड़ा गुण" in p
        ]
        assert len(big_qa) == 1

    def test_big_qa_block_contains_all_four_questions(self, paragraphs):
        """All four प्रश्न: from pages 4-5 land in the same merged paragraph."""
        big_qa = next(
            (p for p in paragraphs if "संसार में सबसे कीमती" in p), None
        )
        assert big_qa is not None
        assert "पर्यावरण बचाने के मुख्य उपाय" in big_qa
        assert "जीवन का सबसे बड़ा गुण" in big_qa
        assert "शिक्षा का मुख्य उद्देश्य" in big_qa

    def test_default_append_in_qa_block(self, paragraphs):
        """
        Page 4 L6 has no special tag (not IS_QA/IS_CENTERED/IS_INDENTED) →
        default append path in _handle_qa_block_state.
        Covers advanced.py lines 308-312.
        """
        big_qa = next(
            (p for p in paragraphs if "संसार में सबसे कीमती" in p), None
        )
        assert "खोया हुआ समय कभी वापस नहीं आता" in big_qa

    def test_is_qa_in_qa_block_starts_new_qa_chunk(self, paragraphs):
        """
        IS_QA encountered inside QA_BLOCK finalises the current chunk and starts
        a fresh one — both Q/A pairs end up in the same combined output paragraph.
        Covers advanced.py lines 287-292.
        """
        big_qa = next(
            (p for p in paragraphs if "संसार में सबसे कीमती" in p), None
        )
        # Second question (from a different QA chunk) must also be present
        assert "जीवन का सबसे बड़ा गुण" in big_qa

    def test_absolute_terminator_in_qa_block(self, paragraphs):
        """
        '।।५।।' inside a QA answer triggers IS_ABSOLUTE_TERMINATOR in QA_BLOCK
        → paragraph is flushed, state switches to STANDARD_PROSE.
        Covers advanced.py lines 277-284.
        """
        big_qa = next(
            (p for p in paragraphs if "पर्यावरण बचाने के मुख्य उपाय" in p), None
        )
        assert big_qa is not None
        assert "।।५।।" in big_qa

    def test_is_centered_in_qa_block_exits_to_verse(self, paragraphs):
        """
        Page 5 L5 is IS_CENTERED inside QA_BLOCK → flushes QA, switches to
        VERSE_BLOCK. The verse 'विद्या विनयेन शोभते' becomes a standalone
        verse paragraph.
        Covers advanced.py lines 295-299.
        """
        verse = next((p for p in paragraphs if "विद्या विनयेन शोभते" in p), None)
        assert verse is not None
        assert "\n" in verse
        assert "नमता फलेन वृक्षाः" in verse
        # Must NOT be mixed into the preceding QA content
        assert "उत्तर: शिक्षा" not in verse

    def test_is_indented_in_qa_block_exits_to_prose(self, paragraphs):
        """
        Page 5 L11 is IS_INDENTED (x_start=130) inside QA_BLOCK → flushes QA,
        switches to STANDARD_PROSE. Phase 3 type-change boundary keeps the prose
        fragment separate from the preceding QA block.
        Covers advanced.py lines 302-306.
        """
        qa_para = next((p for p in paragraphs if "अज्ञान ही मनुष्य का सबसे" in p), None)
        assert qa_para is not None
        # The IS_INDENTED prose fragment is NOT merged into the QA block.
        # It is 3 words ("बड़ा शत्रु है।") so is_indexable filters it from output.
        assert "बड़ा शत्रु है" not in qa_para


# ═════════════════════════════════════════════════════════════════════════════
# Phase 3 prose-combining rules
# ═════════════════════════════════════════════════════════════════════════════


# ═════════════════════════════════════════════════════════════════════════════
# IS_HEADER_REGEX via header_regex pattern (lines 119-121)
# ═════════════════════════════════════════════════════════════════════════════


class TestHeaderRegexPattern:
    """
    Lines 119-121: the header_regexes loop in LineClassifier.classify().
    IS_HEADER_REGEX can be triggered two ways:
      (a) short centered line ≤10 chars  — covered by page 3 "~ ~"
      (b) explicit regex pattern match   — covered here
    """

    def test_header_regex_pattern_discards_matching_line(self):
        """A line matching a header_regex pattern is tagged IS_HEADER_REGEX and discarded."""
        scan_config = {
            **_SCAN_CONFIG,
            "header_regex": [r"अध्याय\s+\d+"],
        }
        page_data = {
            "page_num": 1,
            "metadata": {
                "prose_left_margin": 100,
                "prose_right_margin": 1000,
                "avg_left_margin": 100,
                "avg_right_margin": 1000,
            },
            "lines": [
                {"line_num": 0, "text": "पहली पंक्ति में यह महत्वपूर्ण विषय है।", "x_start": 100, "x_end": 400},
                {"line_num": 1, "text": "अध्याय 2", "x_start": 100, "x_end": 400},
                {"line_num": 2, "text": "दूसरी पंक्ति में भी महत्वपूर्ण विषय है।", "x_start": 100, "x_end": 400},
            ],
        }
        language_meta = get_language_meta("hi", scan_config)
        gen = AdvancedParagraphGenerator(Config(), language_meta)
        result = [text for _, text in gen.generate_paragraphs([page_data], scan_config)]

        assert not any("अध्याय 2" in p for p in result)
        assert any("पहली पंक्ति में यह महत्वपूर्ण" in p for p in result)
        assert any("दूसरी पंक्ति में भी महत्वपूर्ण" in p for p in result)


# ═════════════════════════════════════════════════════════════════════════════
# Empty page (lines_data == []) — line 381
# ═════════════════════════════════════════════════════════════════════════════


class TestEmptyPage:
    """
    page_0006.json has lines: [] — exercises the `if not lines_data: continue`
    guard in _phase1_lines_to_typed_paragraphs (line 381).
    The module-scoped fixture loads all 6 pages; the empty page must not
    contribute any paragraphs.
    """

    def test_empty_page_does_not_add_paragraphs(self, paragraphs):
        """Total count is unchanged (10) even though 6 pages are loaded."""
        assert len(paragraphs) == 10


class TestPhase3ProseCombining:

    def test_standard_prose_does_not_merge_into_following_qa_block(self, paragraphs):
        """
        Phase 3 line 511: if starting_type==STANDARD_PROSE and next is QA_BLOCK → break.
        'इन पंक्तियों से हमें...' (no terminal punct) stays standalone.
        Covers advanced.py line 511.
        """
        prose_frag = next(
            (p for p in paragraphs if "इन पंक्तियों से हमें सत्य और ज्ञान के" in p),
            None,
        )
        assert prose_frag is not None
        # Must NOT contain the QA content that follows
        assert "प्रश्न: संसार" not in prose_frag

    def test_qa_block_does_not_pull_trailing_prose_fragment(self, paragraphs):
        """
        Phase 3: QA ↔ STANDARD_PROSE type change is a hard boundary.
        'उत्तर: अज्ञान ही मनुष्य का सबसे' (QA) and 'बड़ा शत्रु है।' (prose)
        stay in separate paragraphs.
        """
        qa_para = next(
            (p for p in paragraphs if "मनुष्य का सबसे बड़ा शत्रु कौन है" in p),
            None,
        )
        assert qa_para is not None
        assert "अज्ञान ही मनुष्य का सबसे" in qa_para
        assert "बड़ा शत्रु है" not in qa_para  # prose fragment is separate

    def test_prose_after_verse_breaks_before_next_qa_block(self, paragraphs):
        """
        'यह संस्कृत सूक्ति...' (STANDARD_PROSE) after a VERSE_BLOCK is its own
        paragraph and is not merged with the following QA block.
        """
        prose = next(
            (p for p in paragraphs if "यह संस्कृत सूक्ति" in p), None
        )
        assert prose is not None
        assert "मनुष्य का सबसे बड़ा शत्रु" not in prose


# ═════════════════════════════════════════════════════════════════════════════
# IS_HARD_END — hard_end_regex config key
# ═════════════════════════════════════════════════════════════════════════════

def _make_page(lines):
    """Build a minimal single-page pages_data entry with fixed margins."""
    return {
        "page_num": 1,
        "metadata": {
            "prose_left_margin": 100,
            "prose_right_margin": 1000,
        },
        "lines": [
            {"line_num": i, "text": t, "x_start": 100, "x_end": 800}
            for i, t in enumerate(lines)
        ],
    }


class TestHardEndRegex:

    def _run(self, lines, extra_config=None):
        cfg = {**_SCAN_CONFIG, "hard_end_regex": ["[0-9०-९]+\\.\\s*$"], **(extra_config or {})}
        language_meta = get_language_meta("hi", cfg)
        gen = AdvancedParagraphGenerator(Config(), language_meta)
        return [text for _, text in gen.generate_paragraphs([_make_page(lines)], cfg)]

    def test_flush_on_devanagari_number_dot(self):
        """Line ending with Devanagari number + '.' is kept as its own paragraph."""
        texts = self._run([
            "'कुछ करे नहीं, तो गमे नहीं' ऐसी आदत हो गई है, लेकिन 'कुछ करे, तो गमे नहीं' ऐसा होना चाहिए। ८४.",
            "रुचि की आवश्यकता चाहिए, दरकार होनी चाहिए, थकावट होनी चाहिए।",
        ])
        assert any("आदत हो गई है" in t and "रुचि की आवश्यकता" not in t for t in texts), \
            "Line ending ८४. was not kept as its own paragraph"
        assert any("रुचि की आवश्यकता" in t for t in texts)

    def test_flush_on_ascii_number_dot(self):
        """Line ending with ASCII digits + '.' also triggers IS_HARD_END and stays separate."""
        texts = self._run([
            "जहाँ तक अंदर में डुबकी नहीं मारता, वहाँ तक प्रयत्न चालू रखना चाहिए। 86.",
            "अगली पंक्ति में नया विषय प्रारम्भ होता है।",
        ])
        assert any("प्रयत्न चालू" in t and "अगली पंक्ति" not in t for t in texts), \
            "Line ending 86. was not kept separate from following prose"

    def test_no_flush_without_config_key(self):
        """Without hard_end_regex, lines with number-dot endings merge with following prose."""
        cfg = {**_SCAN_CONFIG}  # no hard_end_regex
        language_meta = get_language_meta("hi", cfg)
        gen = AdvancedParagraphGenerator(Config(), language_meta)
        lines = [
            "'कुछ करे नहीं, तो गमे नहीं' ऐसी आदत हो गई है, लेकिन 'कुछ करे, तो गमे नहीं' ऐसा होना चाहिए। ८४.",
            "रुचि की आवश्यकता चाहिए, दरकार होनी चाहिए, थकावट होनी चाहिए।",
        ]
        texts = [text for _, text in gen.generate_paragraphs([_make_page(lines)], cfg)]
        assert any("आदत हो गई है" in t and "रुचि की आवश्यकता" in t for t in texts), \
            "Without hard_end_regex, the two lines should merge"

    def test_no_false_positive_number_mid_text(self):
        """Number at the START of a line does not trigger IS_HARD_END."""
        texts = self._run([
            "83. रुचि की आवश्यकता चाहिए, दरकार होनी चाहिए, थकावट होनी चाहिए।",
            "जहाँ तक अंदर में डुबकी नहीं मारता, प्रयत्न चालू रखना चाहिए।",
        ])
        # Both lines should land in the same paragraph
        assert any("रुचि की आवश्यकता" in t and "डुबकी नहीं मारता" in t for t in texts), \
            "Number at start of line incorrectly triggered IS_HARD_END"