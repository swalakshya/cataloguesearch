import re

# Matches a block whose entire text is a single bracketed expression —
# any of [], (), {} — e.g. "[258]", "(हिरिगीत)", "{रोला}".
_BRACKET_ONLY_RE = re.compile(r'^\s*[\[({][^\])}]*[\])}]\s*$')

# Paragraphs with ≤5 words are too short to be useful search results
# (e.g. lone labels, page references, or sentence fragments).
MIN_INDEXABLE_WORDS = 5


def is_valid_block(text: str) -> bool:
    """
    Block-level check: reject structural/label-only blocks consisting solely
    of a bracketed expression before they enter the paragraph buffer.
    """
    return not _BRACKET_ONLY_RE.match(text)


def is_indexable(text: str) -> bool:
    """
    Paragraph-level check: reject bracket-only text AND paragraphs with
    5 words or fewer (too short to be meaningful search results).
    """
    return is_valid_block(text) and len(text.split()) > MIN_INDEXABLE_WORDS
