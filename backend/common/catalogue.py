"""Builds the content catalogue index.

One row per (category, language, Granth, Series) that a curator has assigned a
`count` to in cataloguesearch-configs. Unlike the main/metadata indices, this is
driven entirely by the config.json tree under BASE_PDF_PATH, independent of
whether any PDFs have actually been indexed yet -- a series marked "compiled" or
given a target count shows up here even before a single page of it has been
OCR'd.
"""
import logging
import os
from datetime import datetime

from opensearchpy import OpenSearch, helpers

from backend.config import Config
from backend.common.utils import get_merged_config_for_dir, list_directories
from backend.common.opensearch import create_indices_if_not_exists

log_handle = logging.getLogger(__name__)

# Same language normalization used for the main/metadata indices.
_LANG_KEYS_MAP = {
    "hi": "hi",
    "gu": "gu",
    "gu+hi": "gu",
    "hi+gu": "hi",
    "gujarati": "gu",
    "hindi": "hi",
}


def _normalize_date(value):
    """Config dates are DD-MM-YYYY; normalize to YYYY-MM-DD, same as index_document()."""
    if not value:
        return None
    try:
        return datetime.strptime(value, "%d-%m-%Y").strftime("%Y-%m-%d")
    except ValueError:
        log_handle.warning(f"Invalid date format in catalogue config: {value}")
        return None


def _row_for_directory(directory: str, base_folder: str) -> dict:
    """Returns a catalogue row for `directory`, or None if it has no `count` set."""
    merged = get_merged_config_for_dir(directory, base_folder)
    count = merged.get("count")
    if not count:
        return None

    language = merged.get("language", "hi")
    lang_key = _LANG_KEYS_MAP.get(language, "hi")

    return {
        "category": merged.get("category"),
        "language": lang_key,
        "anuyog": merged.get("Anuyog"),
        # A couple of leaf config.json files use lowercase "name" -- tolerate both.
        "granth": merged.get("Name") or merged.get("name"),
        "author": merged.get("Author"),
        "series": merged.get("Series"),
        "series_start_date": _normalize_date(merged.get("series_start_date")),
        "series_end_date": _normalize_date(merged.get("series_end_date")),
        "count": str(count),
        "relative_path": os.path.relpath(directory, base_folder),
    }


def get_catalogue(config: Config, opensearch_client: OpenSearch = None) -> list:
    """
    Retrieves every row from the content catalogue index.

    Args:
        config: Config object containing OpenSearch settings
        opensearch_client: Optional pre-built client (avoids re-resolving the
            singleton when a caller already has one)

    Returns:
        list[dict]: One row per (category, language, Granth, Series) that has a
        `count` in cataloguesearch-configs. Empty list if the index doesn't exist
        yet (rebuild_catalogue_index() hasn't run) or on error.
    """
    if opensearch_client is None:
        from backend.common.opensearch import get_opensearch_client
        opensearch_client = get_opensearch_client(config)

    catalogue_index = config.OPENSEARCH_CATALOGUE_INDEX_NAME

    if not opensearch_client.indices.exists(catalogue_index):
        log_handle.warning(
            f"Catalogue index '{catalogue_index}' does not exist. Returning empty catalogue.")
        return []

    try:
        response = opensearch_client.search(
            index=catalogue_index,
            body={"size": 1000, "query": {"match_all": {}}},
        )
        return [hit["_source"] for hit in response.get("hits", {}).get("hits", [])]
    except Exception as e:
        log_handle.error(f"Error retrieving content catalogue: {e}", exc_info=True)
        return []


def rebuild_catalogue_index(config: Config, opensearch_client: OpenSearch):
    """
    Rebuilds the content catalogue index from scratch by walking every folder
    under BASE_PDF_PATH and picking up any whose merged config.json carries a
    `count`. Delete + recreate, then bulk-write -- idempotent, and stale rows
    (renamed/removed series folders) never linger.

    Call after a regular discover crawl and after a full metadata refresh (same
    triggers as refresh_pravachan_series_metadata) -- this is cheap since it's a
    filesystem walk, not an OpenSearch aggregation.
    """
    base_folder = config.BASE_PDF_PATH
    catalogue_index = config.OPENSEARCH_CATALOGUE_INDEX_NAME

    try:
        directories = list_directories(base_folder)
        rows = {}
        for directory in directories:
            row = _row_for_directory(directory, base_folder)
            if row:
                rows[row["relative_path"]] = row

        if opensearch_client.indices.exists(catalogue_index):
            opensearch_client.indices.delete(index=catalogue_index)
        create_indices_if_not_exists(config, opensearch_client)

        if not rows:
            log_handle.info(
                "Rebuilt catalogue index: no rows found (no config.json has a 'count' set).")
            return

        actions = [
            {"_op_type": "index", "_index": catalogue_index, "_id": rel_path, "_source": row}
            for rel_path, row in rows.items()
        ]
        helpers.bulk(opensearch_client, actions, stats_only=True, raise_on_error=True)
        log_handle.info(f"Rebuilt catalogue index: {len(actions)} rows written.")
    except Exception as e:
        log_handle.error(f"Error rebuilding catalogue index: {e}", exc_info=True)
