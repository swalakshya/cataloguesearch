#!/usr/bin/env python3
"""
Full metadata repopulation script -- thin CLI wrapper around
backend.common.opensearch.rebuild_full_metadata_index(), followed by the
Pravachan series cascade and catalogue index rebuilds. Same 3-part rebuild as
`discovery_cli.py discover --refresh-metadata`; this script just exposes the
scroll's parallelism knobs (--slices / --batch-size) for large corpora.
"""

import argparse
import logging
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from utils.logger import setup_logging
from backend.config import Config
from backend.common.opensearch import (
    get_opensearch_client, refresh_pravachan_series_metadata, rebuild_full_metadata_index,
)
from backend.common.catalogue import rebuild_catalogue_index

log_handle = logging.getLogger(__name__)


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

    rebuild_full_metadata_index(config, client, num_slices=args.slices, batch_size=args.batch_size)
    refresh_pravachan_series_metadata(config, client)
    rebuild_catalogue_index(config, client)
    log_handle.info("Metadata repopulation completed successfully!")


if __name__ == "__main__":
    main()
