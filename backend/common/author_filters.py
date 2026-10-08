"""Catalogue-based author groups and category-scoped search filters."""
from backend.common.language import normalize_language

AUTHOR_FILTER_KEYS = {"Granth": "_granth_authors", "Books": "_books_authors"}
CATEGORY_FILTER_FIELDS = {
    "Pravachan": {"Anuyog", "Series", "volume", "pravachan_number", "_pravachan_groups"},
    "Granth": {"Name", "Anuyog", "Author"},
    "Books": {"Name", "Author"},
}


def group_authors(rows):
    """An author belongs to each category/language in which their works appear."""
    groups = {category: {"hi": set(), "gu": set()} for category in AUTHOR_FILTER_KEYS}
    for row in rows:
        category = row.get("category")
        if category not in groups:
            continue
        authors = row.get("author")
        if isinstance(authors, str):
            authors = [authors]
        if not isinstance(authors, list):
            continue
        language = normalize_language(row.get("language"))
        for author in authors:
            if isinstance(author, str) and author.strip():
                groups[category][language].add(author)
    return {
        category: {language: sorted(authors, key=str.casefold) for language, authors in languages.items()}
        for category, languages in groups.items()
    }


def filter_categories_for(category, categories):
    allowed = CATEGORY_FILTER_FIELDS.get(category, set(categories) - set(AUTHOR_FILTER_KEYS.values()))
    result = {key: values for key, values in categories.items() if key in allowed}
    scoped_authors = categories.get(AUTHOR_FILTER_KEYS.get(category))
    if scoped_authors:
        # Existing Author callers keep their behavior; the scoped picker takes
        # precedence when present. Only the matching category receives it.
        result["Author"] = scoped_authors
    return result
