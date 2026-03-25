"""
Language-specific metadata and configuration for paragraph generation.

This module provides language-specific behavior through composition rather than inheritance.
"""
import re
from abc import ABC, abstractmethod


class LanguageMeta(ABC):
    """
    Abstract base class for language-specific metadata and behavior.

    Encapsulates language-specific constants and methods for text normalization
    and paragraph generation.
    """

    def __init__(self, scan_config: dict):
        """
        Initialize language metadata with document-specific configuration.

        Args:
            scan_config: Dictionary containing document-specific configuration
                        including question_prefix, answer_prefix, etc.
        """
        self.scan_config = scan_config

    @property
    @abstractmethod
    def sentence_terminators(self) -> tuple:
        """Returns language-specific sentence terminator characters."""
        pass

    @property
    @abstractmethod
    def punctuation_suffixes(self) -> tuple:
        """Returns language-specific punctuation suffixes for paragraph combination."""
        pass

    @property
    def dialogue_prefixes(self) -> tuple:
        """Returns combined question and answer prefixes."""
        return tuple(self.question_prefix) + tuple(self.answer_prefix)

    @property
    def question_prefix(self) -> list:
        """Returns document-specific question prefixes from scan_config."""
        return self.scan_config.get("question_prefix", [])

    @property
    def answer_prefix(self) -> list:
        """Returns document-specific answer prefixes from scan_config."""
        return self.scan_config.get("answer_prefix", [])

    @abstractmethod
    def normalize_dialogue_patterns(self, text: str) -> str:
        """
        Apply language-specific dialogue pattern normalization.

        Args:
            text: The text to normalize

        Returns:
            Normalized text
        """
        pass


class HindiMeta(LanguageMeta):
    """Language metadata for Hindi text processing."""

    @property
    def sentence_terminators(self) -> tuple:
        return ('।', '?', '!', '।।', ')', ']', '}', "'", '"')

    @property
    def punctuation_suffixes(self) -> tuple:
        return ('।', '?', '!', ':', ')', ']', '}', "'", '"')

    def normalize_dialogue_patterns(self, text: str) -> str:
        """
        Normalize Hindi dialogue patterns.

        Handles:
        - Question/answer prefix typos
        - Line joining (preserving dialogue prefixes)
        """
        # Correct common Hindi typos in dialogue markers
        text = re.sub(r"प्रश[्न]*:", "प्रश्न:", text)
        text = re.sub(r"उत्त[र]*:", "उत्तर:", text)

        # Join multiple lines into a single line with spaces
        # BUT do not join lines that start with dialogue prefixes
        text = re.sub(r'\n(?!प्रश्न:|उत्तर:)', ' ', text)

        return text


class GujaratiMeta(LanguageMeta):
    """Language metadata for Gujarati text processing."""

    @property
    def sentence_terminators(self) -> tuple:
        # Gujarati includes '.' as sentence terminator
        return ('।', '.', '?', '!', '।।', ')', ']', '}', "'", '"')

    @property
    def punctuation_suffixes(self) -> tuple:
        return ('।', '.', '?', '!', ':', ')', ']', '}', "'", '"')

    def normalize_dialogue_patterns(self, text: str) -> str:
        """
        Normalize Gujarati dialogue patterns.

        Handles:
        - Dialogue prefix typos
        - Line joining (preserving dialogue prefixes)
        """
        # Correct typing mistakes for Gujarati
        text = re.sub(r"મુમુ[^:]*ષુ[^:]*:", "મુમુક્ષુ:", text)

        # Join multiple lines into a single line with spaces
        # BUT do not join lines that start with Gujarati dialogue prefixes
        text = re.sub(
            r'\n(?!શ્રોતા:|પૂજ્ય ગુરુદેવશ્રી:|મુમુક્ષુ:|શંકા:|પ્રશ્ન:|સમાધાન:|ઉત્તર:)', ' ', text)

        return text


def get_language_meta(language: str, scan_config: dict) -> LanguageMeta:
    """
    Factory function to create appropriate LanguageMeta instance.

    Args:
        language: Language code ('hi' for Hindi, 'gu' for Gujarati)
        scan_config: Document-specific configuration

    Returns:
        Appropriate LanguageMeta subclass instance
    """
    if language == "gu":
        return GujaratiMeta(scan_config)
    else:
        return HindiMeta(scan_config)