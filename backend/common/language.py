"""
Single source of truth for normalizing the "language" value that flows in
from cataloguesearch-configs' config.json trees ("hi", "gu", "gu+hi",
"hi+gu", "hindi", "gujarati", ...) down to exactly one of the two languages
this app actually supports internally: "hi" or "gu".

Import normalize_language()/text_field_for_language() instead of writing a
local hi/gu lookup table or an `if language == "gu"` branch -- every one of
those used to be maintained independently (opensearch.py, catalogue.py,
index_generator.py, index_searcher.py, agent/router.py), and a raw value
like "gu+hi" reaching one of the branches that only checked for "gu" or "hi"
directly (instead of normalizing first) is what caused Gujarati content to
be written to the Hindi text field and processed with Hindi paragraph-
generation rules.
"""

# Public so callers that need every raw variant mapping to a given lang_key
# (e.g. building an OpenSearch `terms` filter) can invert it, rather than
# re-declaring their own copy of this table.
RAW_TO_LANG_KEY = {
    "hi": "hi",
    "gu": "gu",
    "gu+hi": "gu",
    "hi+gu": "hi",
    "gujarati": "gu",
    "hindi": "hi",
}

_TEXT_FIELD_BY_LANG_KEY = {
    "hi": "text_content_hindi",
    "gu": "text_content_gujarati",
}


def normalize_language(raw_language: str = None) -> str:
    """
    Canonicalizes any raw language value -- a config.json "language" field,
    a document's stored `language`/`metadata.language`, a UI-detected
    language name, etc. -- to exactly "hi" or "gu". Defaults to "hi" for
    None/empty/unrecognized values, matching every prior call site's
    fallback convention.
    """
    return RAW_TO_LANG_KEY.get(raw_language or "hi", "hi")


def text_field_for_language(raw_language: str = None) -> str:
    """The OpenSearch text field ("text_content_hindi"/"text_content_gujarati")
    for any raw language value, normalizing first."""
    return _TEXT_FIELD_BY_LANG_KEY[normalize_language(raw_language)]
