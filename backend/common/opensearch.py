"""OpenSearch client and configuration management.

This module provides functions to manage OpenSearch connections, configurations,
and operations including index management, metadata retrieval, and document operations.
"""
import logging
import os
import traceback

import yaml
from opensearchpy import OpenSearch, helpers
from backend.config import Config
from backend.common.embedding_models import get_embedding_model_factory
from backend.utils import json_dumps

# Module-level variables for singleton pattern
# These variables hold cached client instance and settings
_CLIENT = None
_OPENSEARCH_SETTINGS = None

# Language key mapping for metadata indexing
_LANG_KEYS_MAP = {
    "hi": "hi",
    "gu": "gu",
    "gu+hi": "gu",
    "hi+gu": "hi",
    "gujarati": "gu",
    "hindi": "hi"
}

log_handle = logging.getLogger(__name__)

def get_opensearch_config(config: Config) -> dict:
    """
    Loads the OpenSearch configuration from the specified YAML file.
    If the file does not exist, raises a FileNotFoundError.

    Args:
        config: Config object containing OpenSearch settings

    Returns:
        A dictionary containing the OpenSearch configuration settings.
    """
    global _OPENSEARCH_SETTINGS  # pylint: disable=global-statement
    opensearch_config_path = config.OPENSEARCH_CONFIG_PATH
    if not opensearch_config_path or not os.path.exists(opensearch_config_path):
        log_handle.critical(
            f"OpenSearch config file not found at {opensearch_config_path}. Exiting.")
        raise FileNotFoundError(
            f"OpenSearch config file not found: {opensearch_config_path}")

    if not _OPENSEARCH_SETTINGS:
        log_handle.info(f"Loading OpenSearch config from {opensearch_config_path}")
        with open(opensearch_config_path, 'r', encoding='utf-8') as f:
            full_config = yaml.safe_load(f)

        # Extract the search_index configuration
        _OPENSEARCH_SETTINGS = full_config.get('search_index', {})
        if not _OPENSEARCH_SETTINGS:
            log_handle.critical(
                f"search_index configuration not found in {opensearch_config_path}")
            raise ValueError(
                f"search_index configuration not found in {opensearch_config_path}")

        log_handle.info(f"Loaded OpenSearch config from {opensearch_config_path}")
        log_handle.info(f"OpenSearch settings: {_OPENSEARCH_SETTINGS}")

    # Get embedding dimension from factory pattern
    embedding_model = get_embedding_model_factory(config)

    # Ensure mappings structure exists before setting dimension
    if ('mappings' in _OPENSEARCH_SETTINGS and
            'properties' in _OPENSEARCH_SETTINGS['mappings'] and
            'vector_embedding' in _OPENSEARCH_SETTINGS['mappings']['properties']):
        _OPENSEARCH_SETTINGS['mappings']['properties']['vector_embedding']['dimension'] = \
            embedding_model.get_embedding_dimension()
    else:
        log_handle.warning(
            "vector_embedding mapping not found in OpenSearch config, "
            "skipping dimension update")

    return _OPENSEARCH_SETTINGS

def get_metadata_index_config(config: Config) -> dict:
    """Loads the OpenSearch configuration for the metadata index."""
    opensearch_config_path = config.OPENSEARCH_CONFIG_PATH
    with open(opensearch_config_path, 'r', encoding='utf-8') as f:
        full_config = yaml.safe_load(f)

    metadata_config = full_config.get('metadata_index', {})

    if not metadata_config:
        log_handle.warning(f"metadata_index configuration not found in {opensearch_config_path}")
        return {}

    return metadata_config

def _create_index_if_not_exists(opensearch_client: OpenSearch, index_name: str, index_body: dict):
    """Helper to create a single index if it doesn't exist."""
    if not index_body:
        log_handle.error(f"Index configuration for '{index_name}' is empty. Skipping creation.")
        return
    try:
        if not opensearch_client.indices.exists(index_name):
            log_handle.info(f"Index '{index_name}' does not exist. Creating...")
            response = opensearch_client.indices.create(
                index=index_name, body=index_body
            )
            log_handle.info(f"Index '{index_name}' created: {response}")
    except Exception as e:
        log_handle.critical(f"Error creating index '{index_name}': {e}")
        raise

def create_indices_if_not_exists(config: Config, opensearch_client: OpenSearch):
    """
    Creates all required OpenSearch indices (main and metadata) if they don't exist.
    """
    # 1. Create main document index
    main_index_config = get_opensearch_config(config)
    main_index_name = config.OPENSEARCH_INDEX_NAME
    _create_index_if_not_exists(opensearch_client, main_index_name, main_index_config)

    # 2. Create metadata index
    metadata_index_config = get_metadata_index_config(config)
    metadata_index_name = config.OPENSEARCH_METADATA_INDEX_NAME
    _create_index_if_not_exists(opensearch_client, metadata_index_name, metadata_index_config)

def delete_index(config: Config):
    """
    Deletes the specified OpenSearch indices if they exist.

    Args:
        config: Config object containing OpenSearch settings
    """
    if not config:
        log_handle.error("Invalid config provided")
        raise ValueError("Config is required")

    client = _CLIENT
    if not client:
        log_handle.warning("No OpenSearch client available for index deletion")
        return
    indices_to_delete = [
        config.OPENSEARCH_INDEX_NAME,
        config.OPENSEARCH_METADATA_INDEX_NAME,
    ]

    for index_name in indices_to_delete:
        if not index_name:
            continue
        try:
            if client.indices.exists(index=index_name):
                response = client.indices.delete(index=index_name)
                log_handle.info(f"Index '{index_name}' deleted successfully: {response}")
            else:
                log_handle.warning(f"Index '{index_name}' does not exist, nothing to delete")
        except (ConnectionError, ValueError, OSError) as e:
            log_handle.error(f"Error deleting index '{index_name}': {e}", exc_info=True)
            # Continue to try deleting other indices even if one fails
            continue

def get_opensearch_client(config: Config, force_clean=False) -> OpenSearch:
    """
    Returns a singleton OpenSearch client instance.
    Args:
        config: A Config object with the OpenSearch connection details.
                This is only used on the very first call.
        force_clean: If True, deletes the existing index before creating a new one.
                     IMPORTANT: ONLY USE THIS PARAM WHILE RUNNING TESTS. OR IF YOU
                     KNOW WHAT YOU ARE DOING. THIS WILL DELETE ALL DATA IN THE INDEX.

    Returns:
        An initialized and connected OpenSearch client.

    Raises:
        ConnectionError: If a connection to OpenSearch cannot be established on the first call.
    """
    global _CLIENT  # pylint: disable=global-statement
    if _CLIENT:
        if force_clean:
            delete_index(config)
        return _CLIENT

    log_handle.info("OpenSearch client not initialized. Creating a new instance...")
    try:
        # Create the OpenSearch client using the provided configuration
        client = OpenSearch(
            hosts=[{
                'scheme': 'http',
                'host': config.OPENSEARCH_HOST,
                'port': config.OPENSEARCH_PORT
            }],
            use_ssl=False,
            timeout=60
        )

        # Ping the server to confirm the connection and credentials are valid
        if not client.ping():
            raise ConnectionError(
                "Failed to ping OpenSearch. Please check your host, port, and credentials."
            )

        # Cache the successfully created client in our module-level variable
        _CLIENT = client
        log_handle.info("OpenSearch client initialized and cached successfully.")
    except Exception as e:
        traceback.print_exc()
        log_handle.critical(f"Failed to initialize OpenSearch client: {e}")
        # Re-raise the exception to let the calling code handle the connection failure.
        raise

    return _CLIENT


def get_metadata(config: Config) -> dict[str, dict[str, list[str]]]:
    """
    Retrieves all metadata from the dedicated metadata index grouped by content_type.
    This is much more efficient than scanning the main document index.

    Args:
        config: Config object containing OpenSearch settings

    Returns:
        dict[str, dict[str, list[str]]]: Dictionary with content_type as top-level keys,
        each containing composite keys (key_language) and their unique, sorted values.
        Format: {"Pravachan": {"Name_hi": [...], "Name_gu": [...]}, "Granth": {"Name_hi": [...]}}
    """
    client = get_opensearch_client(config)
    metadata_index = config.OPENSEARCH_METADATA_INDEX_NAME

    if not client.indices.exists(metadata_index):
        log_handle.warning(
            f"Metadata index '{metadata_index}' does not exist. Returning empty metadata.")
        return {"Pravachan": {}, "Granth": {}}

    # Query to get all documents from the metadata index.
    query_body = {
        "size": 1000,  # Assume there won't be more than 1000 unique metadata keys
        "query": {"match_all": {}}
    }

    try:
        response = client.search(
            index=metadata_index,
            body=query_body
        )

        # Build result dynamically keyed by content_type so new types are
        # picked up automatically without code changes.
        # Seed with known types so callers always find these keys even for empty indices.
        result = {"Pravachan": {}, "Granth": {}}

        for hit in response.get('hits', {}).get('hits', []):
            source = hit.get('_source', {})

            content_type = source.get('content_type')
            key = source.get('key')
            language = source.get('language', 'hi')

            # Handle regular metadata ('values'), date_ranges, and cascade ('series')
            values = source.get('values')
            date_ranges = source.get('date_ranges')
            series = source.get('series')
            data = values if values is not None else (date_ranges if date_ranges is not None else series)

            if key and data and content_type:
                if content_type not in result:
                    result[content_type] = {}
                composite_key = f"{key}_{language}"
                result[content_type][composite_key] = data

        log_handle.info(
            f"Metadata retrieved from '{metadata_index}': "
            + ", ".join(f"{ct}: {len(v)} keys" for ct, v in result.items()))
        return result
    except (ConnectionError, ValueError, OSError) as e:
        log_handle.error(
            f"Error retrieving metadata from index '{metadata_index}': {e}", exc_info=True)
        return {"Pravachan": {}, "Granth": {}}

def delete_documents_by_filename(config: Config, original_filename: str):
    """
    Deletes all documents from the OpenSearch index that match the given original_filename.

    Args:
        config: Config object containing OpenSearch settings.
        original_filename: The name of the file to delete documents for.
    """
    client = get_opensearch_client(config)
    index_name = config.OPENSEARCH_INDEX_NAME

    query_body = {
        "query": {
            "term": {
                # Use .keyword for an exact, non-analyzed match on the filename
                "original_filename": original_filename
            }
        }
    }

    try:
        log_handle.info(
            f"Attempting to delete documents with original_filename: {original_filename}")
        response = client.delete_by_query(
            index=index_name,
            body=query_body
        )
        # Refresh the index to make changes visible immediately
        client.indices.refresh(index=index_name)
        deleted_count = response.get('deleted', 0)
        log_handle.info(
            f"Successfully deleted {deleted_count} documents for '{original_filename}'.")
    except Exception as e:
        log_handle.error(
            f"Error deleting documents for '{original_filename}': {e}", exc_info=True)
        raise

def delete_documents_by_document_id(config: Config, document_id: str):
    """
    Deletes all chunks from the OpenSearch index that match the given document_id.
    Used when re-indexing a single sub-section to avoid deleting sibling sub-sections
    that share the same original_filename.

    Args:
        config: Config object containing OpenSearch settings.
        document_id: The document_id whose chunks should be deleted.
    """
    client = get_opensearch_client(config)
    index_name = config.OPENSEARCH_INDEX_NAME

    query_body = {
        "query": {
            "term": {
                "document_id": document_id
            }
        }
    }

    try:
        log_handle.info(f"Attempting to delete chunks with document_id: {document_id}")
        response = client.delete_by_query(index=index_name, body=query_body)
        client.indices.refresh(index=index_name)
        deleted_count = response.get('deleted', 0)
        log_handle.info(
            f"Successfully deleted {deleted_count} chunks for document_id '{document_id}'.")
    except Exception as e:
        log_handle.error(
            f"Error deleting chunks for document_id '{document_id}': {e}", exc_info=True)


def refresh_pravachan_series_metadata(config: Config, opensearch_client: OpenSearch):
    """
    Rebuilds the Pravachan series cascade doc in the metadata index via a single
    3-level aggregation (Series → Volume → PravachanNumber) against the main index.

    Idempotent — overwrites the previous cascade doc. Call after any Pravachan
    index_document(), after cleanup, or standalone via --refresh-metadata.
    """
    main_index = config.OPENSEARCH_INDEX_NAME
    metadata_index = config.OPENSEARCH_METADATA_INDEX_NAME

    agg_body = {
        "size": 0,
        "query": {"term": {"metadata.category.keyword": "Pravachan"}},
        "aggs": {
            "by_series": {
                "terms": {"field": "metadata.Series.keyword", "size": 200},
                "aggs": {
                    "series_start": {"min": {"field": "metadata.series_start_date"}},
                    "series_end":   {"max": {"field": "metadata.series_end_date"}},
                    "by_volume": {
                        "terms": {"field": "metadata.volume", "size": 100, "missing": -1},
                        "aggs": {
                            "by_pravachan_number": {
                                "terms": {
                                    "field": "chunk_labels.pravachan_number",
                                    "size": 2000,
                                    "missing": "__none__"
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    try:
        response = opensearch_client.search(index=main_index, body=agg_body)
        series_buckets = response.get("aggregations", {}).get("by_series", {}).get("buckets", [])

        series_list = []
        for s_bucket in series_buckets:
            series_name = s_bucket["key"]
            start_date = s_bucket.get("series_start", {}).get("value_as_string")
            end_date   = s_bucket.get("series_end",   {}).get("value_as_string")

            volumes = []
            for v_bucket in s_bucket.get("by_volume", {}).get("buckets", []):
                vol = v_bucket["key"]
                if vol == -1:
                    continue
                pn_buckets = v_bucket.get("by_pravachan_number", {}).get("buckets", [])
                pravachan_numbers = sorted(
                    [b["key"] for b in pn_buckets if b["key"] != "__none__"],
                    key=lambda x: (0, int(x)) if str(x).isdigit() else (1, str(x))
                )
                volumes.append({"volume": int(vol), "pravachan_numbers": pravachan_numbers})

            volumes.sort(key=lambda v: v["volume"])
            series_list.append({
                "name": series_name,
                "start_date": start_date,
                "end_date": end_date,
                "volumes": volumes,
            })

        doc = {
            "key": "pravachan_series_cascade",
            "content_type": "Pravachan",
            "series": series_list,
            "language": "hi",
        }
        opensearch_client.index(
            index=metadata_index,
            id="Pravachan_series_cascade",
            body=doc,
        )
        log_handle.info(
            f"Refreshed Pravachan series cascade metadata: {len(series_list)} series written."
        )
    except Exception as e:
        log_handle.error(f"Error refreshing Pravachan series metadata: {e}", exc_info=True)


def update_metadata_index(config: Config, opensearch_client: OpenSearch, metadata: dict):
    """
    Updates the dedicated metadata index with new values from a document.
    Uses a scripted upsert for efficiency and atomicity.
    Includes language and content_type information for each metadata entry.

    Args:
        config: Config object containing OpenSearch settings
        opensearch_client: OpenSearch client instance
        metadata: Dictionary containing metadata to index (must include 'category' field)
    """
    if not metadata:
        return

    metadata_index_name = config.OPENSEARCH_METADATA_INDEX_NAME

    # Extract language, default to "hi" for backward compatibility
    language = metadata.get("language", "hi")
    lang_key = _LANG_KEYS_MAP[language]

    # Extract content_type from category field
    content_type = metadata.get("category", "Pravachan")

    log_handle.info(f"Updating metadata index for keys: {list(metadata.keys())} with language: {lang_key}, content_type: {content_type}")
    log_handle.info(f"Metadata: {json_dumps(metadata)}")

    actions = []

    # Handle Granth_date_ranges correlation (Option 1)
    granth_values = metadata.get("Name")
    series_start = metadata.get("series_start_date")
    series_end = metadata.get("series_end_date")

    if granth_values and series_start and series_end:
        # Build the Granth→dates mapping
        granth_list = granth_values if isinstance(granth_values, list) else [granth_values]
        granth_list = [str(g) for g in granth_list]

        # Create the date range object for this document
        date_range = {
            "start_date": str(series_start),
            "end_date": str(series_end)
        }

        doc_id = f"{content_type}_Granth_date_ranges_{lang_key}"

        # Build initial values map for upsert
        initial_values = {granth: [date_range] for granth in granth_list}

        action = {
            "_op_type": "update",
            "_index": metadata_index_name,
            "_id": doc_id,
            "script": {
                "source": """
                    // Initialize date_ranges as Map if it doesn't exist
                    if (ctx._source.date_ranges == null) {
                        ctx._source.date_ranges = new HashMap();
                    }

                    // Process each Granth
                    for (granth in params.granths) {
                        // Get or create the array for this Granth
                        if (!ctx._source.date_ranges.containsKey(granth)) {
                            ctx._source.date_ranges[granth] = new ArrayList();
                        }

                        // Check if this date range already exists
                        boolean exists = false;
                        for (range in ctx._source.date_ranges[granth]) {
                            if (range.start_date == params.dateRange.start_date &&
                                range.end_date == params.dateRange.end_date) {
                                exists = true;
                                break;
                            }
                        }

                        // Add the date range if it doesn't exist
                        if (!exists) {
                            ctx._source.date_ranges[granth].add(params.dateRange);
                        }
                    }

                    // Update metadata fields
                    ctx._source.language = params.language;
                    ctx._source.key = params.key;
                    ctx._source.content_type = params.content_type;
                """,
                "lang": "painless",
                "params": {
                    "granths": granth_list,
                    "dateRange": date_range,
                    "language": lang_key,
                    "key": "Granth_date_ranges",
                    "content_type": content_type
                }
            },
            "upsert": {
                "key": "Granth_date_ranges",
                "date_ranges": initial_values,
                "language": lang_key,
                "content_type": content_type
            }
        }
        actions.append(action)

    # Process other metadata fields
    for key, value in metadata.items():
        if not value:
            continue

        # Skip file_url, category, and date fields (dates are now in Granth_date_ranges)
        if key not in ["Anuyog", "Author", "Name"]:
            continue

        # Ensure new_values is a list of strings
        new_values = [str(v) for v in value] if isinstance(value, list) else [str(value)]

        # Create unique document ID per content_type and language: content_type_key_language
        doc_id = f"{content_type}_{key}_{lang_key}"

        action = {
            "_op_type": "update",
            "_index": metadata_index_name,
            "_id": doc_id,
            "script": {
                "source": """
                    boolean changed = false;
                    for (item in params.newValues) {
                        if (!ctx._source.values.contains(item)) {
                            ctx._source.values.add(item);
                            changed = true;
                        }
                    }
                    if (changed) {
                        Collections.sort(ctx._source.values);
                    }
                    ctx._source.language = params.language;
                    ctx._source.key = params.key;
                    ctx._source.content_type = params.content_type;
                """,
                "lang": "painless",
                "params": {"newValues": new_values, "language": lang_key, "key": key, "content_type": content_type}
            },
            "upsert": {
                "key": key,
                "values": sorted(new_values),
                "language": language,
                "content_type": content_type
            }
        }
        actions.append(action)

    if actions:
        helpers.bulk(opensearch_client, actions, stats_only=True, raise_on_error=True)
        log_handle.info(f"Successfully sent {len(actions)} updates to the metadata index for content_type: {content_type}, language: {language}.")