"""Builds the content catalogue index.

One row per leaf work in cataloguesearch-configs, driven entirely by the
config.json tree under BASE_PDF_PATH -- independent of whether any PDFs have
actually been indexed yet.

A Pravachan folder gets a row if it has a curator-assigned `count` (a series
marked "compiled" or given a target count shows up here even before a single
page of it has been OCR'd), or if it's an actual leaf directory (no
subdirectories -- it holds PDFs directly) with a `Name`. The leaf-directory
fallback exists because some Pravachan works aren't organized into dated
series at all (e.g. Tattva Charcha), so there's nothing to curate a `count`
for; the `count` column just renders "-" for these in the UI. Folders like
"Bahinshree Na Vachanamrut" that group dated series subfolders (which do carry
`count`) are excluded by this fallback since they aren't leaves themselves --
only their series subfolders are.

Granth and Books rows need no curation at all -- a `Name` in the folder's own
config.json is enough, since every leaf Granth/Book folder sets one directly;
their "count" is just how many such rows exist, not a per-row field.
"""
import logging
import os
from datetime import datetime

from opensearchpy import OpenSearch, helpers

from backend.config import Config
from backend.common.utils import get_merged_config_for_dir, list_directories
from backend.common.opensearch import create_indices_if_not_exists
from backend.common.language import normalize_language

log_handle = logging.getLogger(__name__)


def _normalize_date(value):
    """Config dates are DD-MM-YYYY; normalize to YYYY-MM-DD, same as index_document()."""
    if not value:
        return None
    try:
        return datetime.strptime(value, "%d-%m-%Y").strftime("%Y-%m-%d")
    except ValueError:
        log_handle.warning(f"Invalid date format in catalogue config: {value}")
        return None


def _is_leaf_directory(directory: str) -> bool:
    """True if `directory` holds no subdirectories -- i.e. it's an actual leaf
    work (PDFs sit directly inside it), not an intermediate folder grouping
    series/Anuyog/Author subfolders."""
    try:
        return not any(
            entry.is_dir() for entry in os.scandir(directory) if not entry.name.startswith('.')
        )
    except OSError:
        return False


def _row_for_directory(directory: str, base_folder: str) -> dict:
    """Returns a catalogue row for `directory`, or None if it isn't a leaf work.

    Pravachan folders are identified by a curated `count`, or by being a leaf
    directory with a `Name` (for works that aren't organized into dated series
    at all, so there's no `count` to curate). Granth/Books leaf folders have no
    such curation -- they're identified by having a `Name` set directly (every
    leaf Granth/Book folder's own config.json sets one; intermediate folders
    like an Anuyog or Author folder never do), so a row is emitted for every
    one of them, unconditionally.
    """
    merged = get_merged_config_for_dir(directory, base_folder)
    category = merged.get("category")
    # A couple of leaf config.json files use lowercase "name" -- tolerate both.
    name = merged.get("Name") or merged.get("name")
    count = merged.get("count")

    if category == "Pravachan":
        if not count and not (name and _is_leaf_directory(directory)):
            return None
    elif not name:
        return None

    lang_key = normalize_language(merged.get("language"))

    return {
        "category": category,
        "language": lang_key,
        "anuyog": merged.get("Anuyog"),
        "granth": name,
        "author": merged.get("Author"),
        "tikakaar": merged.get("Tikakaar") or merged.get("Teekakar") or merged.get("Bhasha Vachanika"),
        "series": merged.get("Series"),
        "series_start_date": _normalize_date(merged.get("series_start_date")),
        "series_end_date": _normalize_date(merged.get("series_end_date")),
        "count": str(count) if count else None,
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
        list[dict]: One row per leaf work in cataloguesearch-configs -- Pravachan
        rows keyed by (Granth, Series) with a curated `count`, Granth/Books rows
        one per work with no `count`. Empty list if the index doesn't exist yet
        (rebuild_catalogue_index() hasn't run) or on error.
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
    under BASE_PDF_PATH and picking up every leaf work -- see _row_for_directory
    for what counts as one per category. Delete + recreate, then bulk-write --
    idempotent, and stale rows (renamed/removed folders) never linger.

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


def update_catalogue_row(config: Config, opensearch_client: OpenSearch, directory: str):
    """
    Upserts (or removes) the single catalogue row for `directory`, without
    touching any other row -- the cheap, no-delete-of-everything-else
    counterpart to rebuild_catalogue_index(), meant to be called right after
    indexing a single document so the catalogue reflects it immediately
    instead of waiting for the next full crawl/--refresh-metadata.

    Args:
        directory: Absolute path to the folder the just-indexed PDF lives in.
    """
    base_folder = config.BASE_PDF_PATH
    catalogue_index = config.OPENSEARCH_CATALOGUE_INDEX_NAME
    relative_path = os.path.relpath(directory, base_folder)

    try:
        create_indices_if_not_exists(config, opensearch_client)
        row = _row_for_directory(directory, base_folder)
        if row:
            opensearch_client.index(index=catalogue_index, id=relative_path, body=row)
        else:
            opensearch_client.delete(index=catalogue_index, id=relative_path, ignore=[404])
    except Exception as e:
        log_handle.error(f"Error updating catalogue row for '{directory}': {e}", exc_info=True)
