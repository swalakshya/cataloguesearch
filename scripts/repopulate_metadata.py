#!/usr/bin/env python3
"""
Parallel metadata repopulation script.

Phase 1: Scroll all docs in parallel (sliced scroll), accumulate metadata values
         in memory per slice (map), then merge all slices (reduce).
Phase 2: Delete + recreate the metadata index, then bulk-write all accumulated
         docs in a single call (no painless scripts).

Timing is reported for the scroll/accumulate phase (the bottleneck) separately
from the write phase.
"""

import argparse
import logging
import sys
import os
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from utils.logger import setup_logging
from backend.config import Config
from backend.common.opensearch import get_opensearch_client, create_indices_if_not_exists, refresh_pravachan_series_metadata
from backend.common.catalogue import rebuild_catalogue_index
from opensearchpy import helpers

log_handle = logging.getLogger(__name__)

_LANG_KEYS_MAP = {
    "hi": "hi",
    "gu": "gu",
    "gujarati": "gu",
    "hindi": "hi"
}

_METADATA_VALUE_KEYS = ["Anuyog", "Author", "Name"]


def scroll_slice(config, slice_id, num_slices, batch_size):
    """
    Scroll one slice of the main index and accumulate metadata values locally.

    Returns:
        values_map: dict[(content_type, key, lang_key)] -> set of str
        date_ranges_map: dict[(content_type, lang_key)] -> dict[granth] -> set of (start, end)
        doc_count: int
    """
    client = get_opensearch_client(config)
    main_index = config.OPENSEARCH_INDEX_NAME

    values_map = defaultdict(set)
    date_ranges_map = defaultdict(lambda: defaultdict(set))
    doc_count = 0

    query_body = {
        "size": batch_size,
        "query": {"match_all": {}},
        "_source": ["metadata", "language"],
        "slice": {
            "id": slice_id,
            "max": num_slices
        }
    }

    response = client.search(index=main_index, body=query_body, scroll='5m')
    scroll_id = response.get('_scroll_id')
    hits = response['hits']['hits']

    while hits:
        for hit in hits:
            source = hit.get('_source', {})
            metadata = source.get('metadata', {})
            language = source.get('language', 'hi')
            lang_key = _LANG_KEYS_MAP.get(language, 'hi')
            content_type = metadata.get('category', 'Pravachan')

            # Accumulate Anuyog, Author, Name
            for key in _METADATA_VALUE_KEYS:
                value = metadata.get(key)
                if not value:
                    continue
                new_values = [str(v) for v in value] if isinstance(value, list) else [str(value)]
                values_map[(content_type, key, lang_key)].update(new_values)

            # Accumulate Granth_date_ranges
            granth_values = metadata.get("Name")
            series_start = metadata.get("series_start_date")
            series_end = metadata.get("series_end_date")
            if granth_values and series_start and series_end:
                granth_list = granth_values if isinstance(granth_values, list) else [granth_values]
                granth_list = [str(g) for g in granth_list]
                for granth in granth_list:
                    date_ranges_map[(content_type, lang_key)][granth].add(
                        (str(series_start), str(series_end))
                    )

            doc_count += 1

        try:
            response = client.scroll(scroll_id=scroll_id, scroll='5m')
            hits = response['hits']['hits']
        except Exception as e:
            log_handle.warning(f"Slice {slice_id}: scroll error: {e}")
            break

    try:
        client.clear_scroll(scroll_id=scroll_id)
    except Exception:
        pass

    log_handle.info(f"Slice {slice_id}: processed {doc_count} docs")
    return values_map, date_ranges_map, doc_count


def merge_results(slice_results):
    """Merge per-slice results (reduce phase)."""
    merged_values = defaultdict(set)
    merged_date_ranges = defaultdict(lambda: defaultdict(set))
    total_docs = 0

    for values_map, date_ranges_map, doc_count in slice_results:
        total_docs += doc_count
        for k, v in values_map.items():
            merged_values[k].update(v)
        for k, granth_dict in date_ranges_map.items():
            for granth, date_set in granth_dict.items():
                merged_date_ranges[k][granth].update(date_set)

    return merged_values, merged_date_ranges, total_docs


def write_metadata_index(config, client, merged_values, merged_date_ranges):
    """
    Delete + recreate the metadata index, then bulk-write all accumulated docs.
    Uses direct index operations (no painless scripts) since we have the full
    final state in memory.
    """
    metadata_index = config.OPENSEARCH_METADATA_INDEX_NAME

    if client.indices.exists(metadata_index):
        log_handle.info(f"Deleting existing metadata index: {metadata_index}")
        client.indices.delete(index=metadata_index)

    create_indices_if_not_exists(config, client)

    actions = []

    for (content_type, key, lang_key), values in merged_values.items():
        actions.append({
            "_op_type": "index",
            "_index": metadata_index,
            "_id": f"{content_type}_{key}_{lang_key}",
            "_source": {
                "key": key,
                "values": sorted(values),
                "language": lang_key,
                "content_type": content_type
            }
        })

    for (content_type, lang_key), granth_dict in merged_date_ranges.items():
        date_ranges = {
            granth: [{"start_date": s, "end_date": e} for s, e in sorted(dates)]
            for granth, dates in granth_dict.items()
        }
        actions.append({
            "_op_type": "index",
            "_index": metadata_index,
            "_id": f"{content_type}_Granth_date_ranges_{lang_key}",
            "_source": {
                "key": "Granth_date_ranges",
                "date_ranges": date_ranges,
                "language": lang_key,
                "content_type": content_type
            }
        })

    helpers.bulk(client, actions, stats_only=True, raise_on_error=True)
    log_handle.info(f"Bulk-wrote {len(actions)} docs to metadata index.")


def main():
    parser = argparse.ArgumentParser(
        description="Repopulate the metadata index using parallel sliced scroll"
    )
    parser.add_argument(
        '--slices', type=int, default=4,
        help='Number of parallel scroll slices / worker threads (default: 4)'
    )
    parser.add_argument(
        '--batch-size', type=int, default=5000,
        help='Scroll batch size per slice (default: 5000)'
    )
    args = parser.parse_args()

    setup_logging(console_only=True)
    config = Config("configs/config.yaml")
    client = get_opensearch_client(config)

    log_handle.info(
        f"Starting parallel scroll: {args.slices} slices, batch size {args.batch_size}"
    )

    # -------------------------------------------------------------------------
    # Phase 1: Parallel scroll + accumulate (map), then merge (reduce)
    # -------------------------------------------------------------------------
    t_start = time.time()

    slice_results = []
    with ThreadPoolExecutor(max_workers=args.slices) as executor:
        futures = {
            executor.submit(scroll_slice, config, i, args.slices, args.batch_size): i
            for i in range(args.slices)
        }
        failed_slices = []
        for future in as_completed(futures):
            slice_id = futures[future]
            try:
                slice_results.append(future.result())
            except Exception as e:
                log_handle.error(f"Slice {slice_id} failed: {e}")
                failed_slices.append(slice_id)

    scroll_time = time.time() - t_start
    log_handle.info(f"Scroll + accumulate phase: {scroll_time:.2f}s")

    if failed_slices:
        log_handle.error(f"Aborting: slices {failed_slices} failed. Metadata index NOT modified.")
        sys.exit(1)

    merged_values, merged_date_ranges, total_docs = merge_results(slice_results)
    log_handle.info(f"Total docs processed: {total_docs}")
    log_handle.info(f"Unique value-type metadata docs to write: {len(merged_values)}")
    log_handle.info(f"Unique Granth_date_ranges docs to write: {len(merged_date_ranges)}")

    # -------------------------------------------------------------------------
    # Phase 2: Bulk write to metadata index
    # -------------------------------------------------------------------------
    t_write = time.time()
    write_metadata_index(config, client, merged_values, merged_date_ranges)
    refresh_pravachan_series_metadata(config, client)
    rebuild_catalogue_index(config, client)
    write_time = time.time() - t_write
    log_handle.info(f"Write phase: {write_time:.2f}s")

    # -------------------------------------------------------------------------
    # Summary
    # -------------------------------------------------------------------------
    total_time = time.time() - t_start
    log_handle.info(f"Total wall time: {total_time:.2f}s")
    log_handle.info("Metadata index repopulation completed successfully!")


if __name__ == "__main__":
    main()
