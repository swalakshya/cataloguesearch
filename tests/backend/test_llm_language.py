"""
Tests for language-aware LLM extraction: prompt selection by language and
Gujarati block handling in the Granth paragraph generator / verse writer.

No OpenSearch, no Gemini calls.
"""
import json
import os
import tempfile
from unittest.mock import MagicMock

import pytest

from backend.common.language import languages_in, normalize_language
from backend.config import Config
from backend.crawler.llm_index_generator import LLMIndexGenerator
from backend.crawler.llm_pdf_processor import BLOCK_TYPES, select_prompt
from backend.crawler.paragraph_generator.granth import GranthParagraphGenerator
from backend.crawler.paragraph_generator.language_meta import GujaratiMeta
from tests.backend.base import *  # module-scoped autouse `initialise` fixture


class TestLanguageNormalization:
    @pytest.mark.parametrize("raw,expected", [
        ("hi", ["hi"]), ("hin", ["hi"]), ("gu", ["gu"]), ("guj", ["gu"]),
        ("hi+guj", ["hi", "gu"]), ("guj+hin", ["gu", "hi"]), ("gu+hi", ["gu", "hi"]),
        ("gujarati", ["gu"]), (None, ["hi"]), ("", ["hi"]), ("eng", ["hi"]),
    ])
    def test_languages_in(self, raw, expected):
        assert languages_in(raw) == expected

    @pytest.mark.parametrize("raw,expected", [
        ("guj", "gu"), ("gu+hi", "gu"), ("hi+gu", "hi"), ("hin", "hi"), (None, "hi"),
    ])
    def test_normalize_language(self, raw, expected):
        assert normalize_language(raw) == expected


class TestSelectPrompt:
    def test_hindi_offers_only_hindi_types(self):
        p = select_prompt("hi")
        assert '"hindi_text"' in p and '"hindi_verse"' in p
        assert "gujarati" not in p.lower()

    def test_gujarati_offers_only_gujarati_types(self):
        for lang in ("gu", "guj"):
            p = select_prompt(lang)
            assert '"gujarati_text"' in p and '"gujarati_verse"' in p
            assert "hindi_text" not in p and "hindi_verse" not in p

    def test_mixed_offers_both(self):
        p = select_prompt("hi+guj")
        for t in ("hindi_text", "hindi_verse", "gujarati_text", "gujarati_verse"):
            assert f'"{t}"' in p

    def test_gujarati_prompt_has_script_rules(self):
        for lang in ("gu", "hi+gu"):
            p = select_prompt(lang)
            assert "Script rules" in p
            assert '"gujarati_text" and "gujarati_verse" must be in Gujarati script' in p
            assert '"sanskrit_text", "prakrit_text"' in p and "Devanagari script" in p
            assert "brackets or quotes stay in Devanagari" in p
            assert "never transliterate" in p

    def test_gujarati_only_prompt_lists_no_hindi_in_script_rules(self):
        rules = select_prompt("gu").split("Script rules")[1].split("Valid values")[0]
        assert "hindi_" not in rules

    def test_mixed_prompt_script_rules_include_hindi_types(self):
        rules = select_prompt("hi+gu").split("Script rules")[1].split("Valid values")[0]
        assert '"hindi_text"' in rules and '"hindi_verse"' in rules

    def test_gujarati_example_precedes_sanskrit_example(self):
        p = select_prompt("gu")
        assert p.index('"type": "gujarati_text"') < p.index('"type": "sanskrit_verse"')

    def test_hindi_prompt_has_no_script_rules(self):
        # Hindi-only books deliberately keep the shorter prompt (token cost).
        assert "Script rules" not in select_prompt("hi")
        assert "Script rules" not in select_prompt("dhundhari")

    def test_shared_types_in_every_prompt(self):
        for lang in ("hi", "gu", "hi+gu"):
            p = select_prompt(lang)
            for t in ("sanskrit_text", "prakrit_text", "sanskrit_verse",
                      "prakrit_verse", "footnote", "chapter_heading"):
                assert f'"{t}"' in p

    def test_dhundhari_is_hindi_only(self):
        p = select_prompt("dhundhari")
        assert "original_text" in p and "gujarati" not in p.lower()

    def test_unknown_falls_back_to_hindi(self):
        assert select_prompt("eng") == select_prompt("hi")

    def test_block_types_include_gujarati(self):
        assert {"gujarati_text", "gujarati_verse"} <= set(BLOCK_TYPES)


_GU_CFG = {"ocr_engine": "llm", "question_prefix": ["પ્રશ્ન:"], "answer_prefix": ["ઉત્તર:"], "typo_list": []}


def _gu_paragraphs(blocks, cfg=None):
    cfg = cfg or _GU_CFG
    gen = GranthParagraphGenerator(Config(), GujaratiMeta(cfg))
    return gen.generate_paragraphs([(1, blocks)], {**cfg, "min_words_per_para": 1})


class TestGujaratiGranth:
    def test_gujarati_text_is_indexed(self):
        paras = _gu_paragraphs([{"type": "gujarati_text", "text": "આત્મા જ્ઞાનસ્વરૂપ છે અને સદા શુદ્ધ છે."}])
        assert any("આત્મા જ્ઞાનસ્વરૂપ" in t for _, t in paras)

    def test_hindi_and_gujarati_text_both_indexed(self):
        paras = _gu_paragraphs([
            {"type": "hindi_text", "text": "आत्मा ज्ञानस्वरूप है और सदा शुद्ध है।"},
            {"type": "gujarati_text", "text": "આત્મા જ્ઞાનસ્વરૂપ છે અને સદા શુદ્ધ છે."},
        ])
        joined = " ".join(t for _, t in paras)
        assert "आत्मा" in joined and "આત્મા" in joined

    def test_gujarati_verse_not_in_paragraphs(self):
        paras = _gu_paragraphs([{"type": "gujarati_verse", "text": "જય જિનેન્દ્ર ॥૧॥"}])
        assert paras == []

    def test_gujarati_digit_verse_end_flushes(self):
        paras = _gu_paragraphs([
            {"type": "gujarati_text", "text": "પ્રથમ ગાથાનો અર્થ આ પ્રમાણે સમજવો ।।૬૭।।"},
            {"type": "gujarati_text", "text": "બીજી ગાથાનો અર્થ પણ આ પ્રમાણે સમજવો"},
        ], {**_GU_CFG})
        assert len(paras) == 2

    def test_gujarati_digit_qa_marker_stripped(self):
        paras = _gu_paragraphs([
            {"type": "gujarati_text", "text": "(૨) પ્રશ્ન: આત્મા શું છે?"},
            {"type": "gujarati_text", "text": "ઉત્તર: જ્ઞાનસ્વરૂપ છે."},
        ])
        assert len(paras) == 1 and "પ્રશ્ન:" in paras[0][1] and "ઉત્તર:" in paras[0][1]


def test_gujarati_verses_written_and_filtered():
    gen = LLMIndexGenerator(Config(), MagicMock())
    with tempfile.TemporaryDirectory() as d:
        gen._write_verses(d, [(3, [
            {"type": "gujarati_verse", "text": "જય જિનેન્દ્ર"},
            {"type": "gujarati_text", "text": "ગદ્ય"},
        ])])
        with open(os.path.join(d, "verses_0003.json"), encoding="utf-8") as fh:
            verses = json.load(fh)
    assert [v["type"] for v in verses] == ["gujarati_verse"]
