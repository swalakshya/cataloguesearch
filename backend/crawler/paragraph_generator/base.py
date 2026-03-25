import logging
import re
from dataclasses import dataclass
from typing import List

from backend.config import Config
from backend.crawler.paragraph_generator.language_meta import LanguageMeta

log_handle = logging.getLogger(__name__)


@dataclass
class ParaInfo:
    """
    Carries a paragraph and its structural labels through the generation pipeline.

    Flags (all default False):
        is_chapter_start  — first paragraph after a chapter heading; hard merge boundary.
        is_verse_end      — paragraph ends with a verse marker (e.g. ।।67।।); flush after.
        is_question       — paragraph is a question (tagged by Phase 1.5).
        is_answer         — paragraph is an answer (tagged by Phase 1.5).
    """
    page_num: int
    text: str
    is_chapter_start: bool = False
    is_verse_end: bool = False
    is_question: bool = False
    is_answer: bool = False

    @property
    def is_qa(self) -> bool:
        return self.is_question or self.is_answer


# Characters that can legally precede a prefix word
_LEADING_STRIP = '([{\'"'

# Characters that can legally follow a prefix word (separators)
_STOP_WORD_SEPARATORS = set(':ः- –—\t[({\'"')  # includes en-dash (–) and em-dash (—)


class BaseParagraphGenerator:
    def __init__(self, config: Config, language_meta: LanguageMeta):
        self._config = config
        self._language_meta = language_meta

    @property
    def punctuation_suffixes(self):
        return self._language_meta.punctuation_suffixes

    @property
    def dialogue_prefixes(self):
        return self._language_meta.dialogue_prefixes

    @staticmethod
    def _starts_with_prefix(text: str, prefixes: tuple) -> bool:
        """
        Return True if *text* begins with one of *prefixes* (as a complete
        word) after stripping any leading bracket / quote characters.

        A complete word match requires that the character immediately after the
        prefix is a known separator (:, ः, -, —, space, bracket, quote) or
        end-of-text. This prevents partial matches like 'अर्थात्' matching 'अर्थ'.
        """
        if not prefixes:
            return False
        stripped = text.lstrip(_LEADING_STRIP)
        for prefix in prefixes:
            if stripped.startswith(prefix):
                rest = stripped[len(prefix):]
                if not rest or rest[0] in _STOP_WORD_SEPARATORS:
                    return True
        return False

    def _normalize_text(self, text: str, typo_list: List) -> str:
        if not isinstance(text, str):
            return ""

        cleaned_text = text

        cleaned_text = cleaned_text.replace('\u00A0', ' ')  # Non-breaking space (NBSP)
        cleaned_text = cleaned_text.replace('\u200B', '')   # Zero-width space
        cleaned_text = cleaned_text.replace('\u2009', ' ')  # Thin space
        cleaned_text = cleaned_text.replace('\u202F', ' ')  # Narrow no-break space
        cleaned_text = cleaned_text.replace('\uFEFF', '')   # Zero-width no-break space (BOM)

        # Common punctuation normalization
        cleaned_text = self._normalize_punctuation(cleaned_text)

        # Apply typo corrections
        cleaned_text = self._apply_typo_corrections(cleaned_text, typo_list)

        # Language-specific dialogue pattern normalization
        cleaned_text = self._normalize_dialogue_patterns(cleaned_text)

        # Final cleanup
        cleaned_text = re.sub(r'\s+', ' ', cleaned_text).strip()

        return cleaned_text

    def _normalize_punctuation(self, text: str) -> str:
        # Normalize common OCR misclassifications for the purn viram (।)
        # The purn viram is often misread as |, I, l, or 1.
        purn_viram_errors = ['|', 'I', 'l', '1']
        for error_char in purn_viram_errors:
            text = text.replace(error_char, '।')

        # Normalize "double danda" (end of verses) to two purn virams
        text = text.replace("॥", "।।")

        # Remove whitespace after opening punctuation marks.
        # This finds an opening punctuation mark followed by a space and removes the space.
        opening_punctuation = r'[(\[{\'"]'
        text = re.sub(r'(' + opening_punctuation + r')\s+', r'\1', text)

        # Remove whitespace before closing punctuation marks.
        # This finds a space before a closing punctuation mark and removes the space.
        closing_punctuation = r'[।.,?!:;)\]}\'"]'
        text = re.sub(r'\s+(' + closing_punctuation + r')', r'\1', text)

        # Normalize spacing around ellipses (two or more dots).
        # This removes any space before an ellipsis.
        text = re.sub(r'\s+(\.{2,})', r'\1', text)

        return text

    def _apply_typo_corrections(self, text: str, typo_list: List) -> str:
        for typo in typo_list:
            text = text.replace(typo[0], typo[1])
        return text

    def _normalize_dialogue_patterns(self, text: str) -> str:
        """Delegate to language_meta for language-specific normalization."""
        return self._language_meta.normalize_dialogue_patterns(text)