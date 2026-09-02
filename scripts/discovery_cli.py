#!/usr/bin/env python3
"""
CLI/Daemon for CatalogueSearch Discovery Module
"""

import argparse
import logging
import os
import shutil
import signal
import sys
import time
import traceback
import uuid

import psutil
from datetime import datetime
from threading import Event

from backend.common.opensearch import get_opensearch_client, get_metadata, delete_documents_by_filename
from backend.common.opensearch import create_indices_if_not_exists, refresh_pravachan_series_metadata
from backend.common import opensearch
from backend.common.catalogue import rebuild_catalogue_index
from backend.config import Config
from backend.crawler.discovery import Discovery
from backend.crawler.index_state import IndexState
from backend.crawler.index_generator import IndexGenerator
from backend.crawler.pdf_factory import create_pdf_processor
from utils.logger import setup_logging, VERBOSE_LEVEL_NUM

PIDFILE = '/tmp/discovery-daemon.pid'

log_handle = logging.getLogger(__name__)

class DaemonManager:
    """Manages daemon process lifecycle"""

    @staticmethod
    def write_pidfile(pid):
        """Write PID to file"""
        with open(PIDFILE, 'w') as f:
            f.write(f"{pid}\n{datetime.now().isoformat()}\n")

    @staticmethod
    def read_pidfile():
        """Read PID and start time from file"""
        try:
            with open(PIDFILE, 'r') as f:
                lines = f.read().strip().split('\n')
                pid = int(lines[0])
                start_time = datetime.fromisoformat(lines[1])
                return pid, start_time
        except (FileNotFoundError, ValueError, IndexError):
            return None, None

    @staticmethod
    def remove_pidfile():
        """Remove PID file"""
        try:
            os.remove(PIDFILE)
        except FileNotFoundError:
            pass

    @staticmethod
    def is_process_running(pid):
        """Check if process is running"""
        try:
            return psutil.pid_exists(pid)
        except:
            return False

    @staticmethod
    def kill_process(pid):
        """Kill process"""
        try:
            os.kill(pid, signal.SIGTERM)
            time.sleep(2)
            if DaemonManager.is_process_running(pid):
                os.kill(pid, signal.SIGKILL)
            return True
        except:
            return False

    @staticmethod
    def check_existing_daemon():
        """Check for existing daemon and handle according to requirements"""
        pid, start_time = DaemonManager.read_pidfile()

        if pid is None:
            return True  # No existing daemon

        if not DaemonManager.is_process_running(pid):
            # Process not running, clean up stale pidfile
            DaemonManager.remove_pidfile()
            return True

        # Process is running, check how long
        running_hours = (datetime.now() - start_time).total_seconds() / 3600

        if running_hours > 2:
            logging.info(f"Existing daemon (PID {pid}) running for {running_hours:.1f} hours. Killing...")
            if DaemonManager.kill_process(pid):
                DaemonManager.remove_pidfile()
                logging.info("Killed existing daemon")
                return True
            else:
                logging.error("Failed to kill existing daemon")
                return False
        else:
            logging.info(f"Existing daemon (PID {pid}) running for {running_hours:.1f} hours. Exiting.")
            return False


class DiscoveryDaemon:
    """Daemon that runs discovery at regular intervals"""

    def __init__(self, config: Config):
        self.config = config
        self.stop_event = Event()

        # Set up signal handlers
        signal.signal(signal.SIGINT, self._signal_handler)
        signal.signal(signal.SIGTERM, self._signal_handler)

        if not os.path.exists(os.path.dirname(config.SQLITE_DB_PATH)):
            os.makedirs(os.path.basename(config.SQLITE_DB_PATH))

        # Initialize discovery components
        self.index_state = IndexState(config.SQLITE_DB_PATH)
        opensearch_client = get_opensearch_client(config)
        self.indexing_module = IndexGenerator(config, opensearch_client)
        self.discovery = Discovery(
            config, self.indexing_module, self.index_state)

        logging.info("Discovery daemon initialized")

    def _signal_handler(self, signum, frame):
        """Handle shutdown signals"""
        logging.info(f"Received signal {signum}. Shutting down...")
        self.stop_event.set()

    def _run_discovery(self):
        """Run discovery and log results"""
        try:
            logging.info("Starting discovery crawl...")

            # Run discovery
            self.discovery.crawl()

            # Rebuild the content catalogue index (config.json-driven, cheap)
            logging.info("Rebuilding content catalogue index...")
            rebuild_catalogue_index(self.config, get_opensearch_client(self.config))

            # Update metadata cache after discovery
            logging.info("Updating metadata cache...")
            metadata = get_metadata(self.config)

        except Exception as e:
            logging.error(f"Discovery failed: {e}")
            raise

    def start(self):
        """Start the daemon"""
        # Write PID file
        DaemonManager.write_pidfile(os.getpid())

        try:
            logging.info("Starting discovery daemon...")

            # Run initial discovery
            self._run_discovery()

            # Daemon loop - run every 6 hours
            while not self.stop_event.is_set():
                logging.info("Waiting 6 hours until next discovery run...")

                if self.stop_event.wait(timeout=6 * 3600):  # 6 hours
                    break

                self._run_discovery()

        finally:
            DaemonManager.remove_pidfile()
            logging.info("Discovery daemon stopped")


def run_discovery_once(config: Config, crawl=False, index=False, dry_run=False,
                       reindex_metadata_only=False, force=False, folder=None):
    """Run discovery once.

    Args:
        folder: Optional root folder to restrict crawling to. If None, the full
                BASE_PDF_PATH tree is walked recursively. If provided, only that
                subtree is crawled (recursive, respecting _ignore files).
    """
    try:
        start = datetime.now()
        logging.info("Starting one-time discovery...")

        # Validate explicitly provided folder up-front
        if folder:
            if not os.path.exists(folder):
                log_handle.error(f"Folder does not exist: {folder}")
                sys.exit(1)
            if not os.path.isdir(folder):
                log_handle.error(f"Path is not a directory: {folder}")
                sys.exit(1)

        # Initialize components
        index_state = IndexState(config.SQLITE_DB_PATH)
        indexing_module = IndexGenerator(config, get_opensearch_client(config))
        discovery = Discovery(config, indexing_module, index_state)

        if force and (crawl or index):
            if folder:
                # Recursively invalidate all PDFs under the specified folder
                for root, _, files in os.walk(folder):
                    for fname in files:
                        if fname.lower().endswith('.pdf'):
                            pdf_path = os.path.join(root, fname)
                            try:
                                relative_path = os.path.relpath(pdf_path, config.BASE_PDF_PATH)
                                index_state.invalidate_state(relative_path, crawl=crawl, index=index)
                            except ValueError:
                                log_handle.warning(f"Skipping force-invalidate for {pdf_path}: not under BASE_PDF_PATH")
            else:
                index_state.invalidate_all_states(crawl=crawl, index=index)

        client = get_opensearch_client(config)
        create_indices_if_not_exists(config, client)

        # Run discovery
        discovery.crawl(crawl, index, dry_run, reindex_metadata_only, root_folder=folder)

        # Rebuild the content catalogue index (config.json-driven, cheap)
        logging.info("Rebuilding content catalogue index...")
        rebuild_catalogue_index(config, client)

        # Update metadata cache after discovery
        logging.info("Updating metadata cache...")
        metadata = get_metadata(config)
        end = datetime.now()
        total_secs = int((end - start).total_seconds())
        hh, rem = divmod(total_secs, 3600)
        mm, ss = divmod(rem, 60)
        log_handle.info(f"Discovery completed in {hh:02}:{mm:02}:{ss:02}")

        if dry_run:
            log_handle.warning("DRY RUN was enabled. No documents were actually indexed. Set --dry-run=false to actually index documents.")
    except Exception as e:
        traceback.print_exc()
        logging.error(f"Discovery failed: {e}")
        sys.exit(1)

def delete_index(config: Config):
    client = get_opensearch_client(config)
    opensearch.delete_index(config)
    # delete index_state as well
    index_state = IndexState(config.SQLITE_DB_PATH)
    index_state.delete_index_state()

def cleanup_files(config: Config, path: str):
    """
    Cleans up all data associated with a specific PDF file or directory of files.

    This involves:
    1. Deleting corresponding documents from the OpenSearch index.
    2. Deleting the file's tracking record from the IndexState database.
    3. Deleting the local processed text output directory.
    """
    log_handle.info(f"--- Starting Cleanup for path: {path} ---")

    if not path or not os.path.exists(path):
        log_handle.error(f"Path does not exist or was not provided: {path}")
        return

    # Get a list of all PDF files to process
    pdf_files_to_clean = []
    if os.path.isdir(path):
        for root, _, files in os.walk(path):
            for file in files:
                if file.lower().endswith('.pdf'):
                    pdf_files_to_clean.append(os.path.join(root, file))
    elif os.path.isfile(path) and path.lower().endswith('.pdf'):
        pdf_files_to_clean.append(path)

    if not pdf_files_to_clean:
        log_handle.warning(f"No PDF files found to clean up in: {path}")
        return

    index_state = IndexState(config.SQLITE_DB_PATH)

    for pdf_file_path in pdf_files_to_clean:
        # The 'original_filename' stored in OpenSearch and used for the document_id
        # is the path relative to the base PDF directory.
        try:
            relative_pdf_path = os.path.relpath(pdf_file_path, config.BASE_PDF_PATH)
        except ValueError:
            log_handle.error(f"File '{pdf_file_path}' is not within the configured BASE_PDF_PATH '{config.BASE_PDF_PATH}'. Skipping cleanup.")
            continue

        log_handle.info(f"Cleaning up resources for: {relative_pdf_path}")

        # --- 1. Delete from OpenSearch ---
        try:
            # Use the relative path, which is what's stored in the 'original_filename' field.
            delete_documents_by_filename(config, relative_pdf_path)
        except Exception as e:
            log_handle.error(f"Failed to delete OpenSearch documents for {relative_pdf_path}. Skipping OpenSearch cleanup.", exc_info=True)

        # --- 2. Delete from IndexState DB ---
        try:
            # Calculate document_id the same way Discovery does
            document_id = str(uuid.uuid5(uuid.NAMESPACE_URL, relative_pdf_path))
            index_state.delete_state(document_id)
            log_handle.info(f"Successfully deleted IndexState record for document_id: {document_id}")
        except Exception as e:
            log_handle.error(f"Failed to delete IndexState record for {relative_pdf_path}.", exc_info=True)

        # --- 3. Delete local processed text directory ---
        try:
            # Calculate output directory path the same way Discovery does
            output_dir_name = os.path.splitext(relative_pdf_path)[0]
            output_dir_path = os.path.join(config.BASE_TEXT_PATH, output_dir_name)

            if os.path.isdir(output_dir_path):
                log_handle.info(f"Deleting local processed text directory: {output_dir_path}")
                shutil.rmtree(output_dir_path)
                log_handle.info(f"Successfully deleted {output_dir_path}")
            else:
                log_handle.warning(f"Local processed text directory not found, skipping deletion: {output_dir_path}")
        except Exception as e:
            log_handle.error(f"Failed to delete directory {output_dir_path}.", exc_info=True)

    log_handle.info("--- Cleanup process completed. ---")


def main():
    # Load .env.local if present (e.g. GEMINI_API_KEY, GROQ_API_KEY, etc.)
    try:
        from dotenv import load_dotenv
        load_dotenv('.env.local')
    except ImportError:
        pass

    parser = argparse.ArgumentParser(description="CatalogueSearch Discovery CLI/Daemon")

    parser.add_argument('command', choices=['discover'], help='Command to run')
    parser.add_argument('--daemon', action='store_true', help='Run as daemon (every 6 hours)')
    parser.add_argument('--delete-index', action='store_true',
                        help='Delete OpenSearch index before starting discovery')
    parser.add_argument("--crawl", action='store_true',
                        help="Crawl the PDF dir for new files")
    parser.add_argument("--index", action='store_true',
                        help="Create the index for files not yet indexed.")
    parser.add_argument("--dry-run", action='store_true', default=True,
                        help="Show what would be indexed without actually indexing or updating state.")
    parser.add_argument("--no-dry-run", dest='dry_run', action='store_false',
                        help="Actually index documents (disable dry run mode).")
    parser.add_argument('--cleanup', type=str, metavar='PATH',
                        help='Clean up all data for a specific PDF file or directory.')
    parser.add_argument('--process-folder', type=str, metavar='PATH',
                        help='Process only the specified folder (recursive) instead of the full BASE_PDF_PATH tree.')
    parser.add_argument('--reindex-metadata-only', action='store_true', default=False,
                        help='Only update metadata and pravachan fields without re-generating embeddings.')
    parser.add_argument('--force', '-f', action='store_true', default=False,
                        help='Force re-processing: clears ocr_checksum if --crawl is set, '
                             'config_hash if --index is set, before running.')
    parser.add_argument('--refresh-metadata', action='store_true', default=False,
                        help='Refresh the Pravachan series cascade in the metadata index and '
                             'rebuild the content catalogue index, then exit.')

    args = parser.parse_args()

    # setup logging
    logs_dir = os.getenv("HOME", "") + "/cataloguesearch/logs/discovery"
    setup_logging(logs_dir, console_level=logging.INFO,
                  file_level=VERBOSE_LEVEL_NUM, console_only=False)

    try:
        config = Config("configs/config.yaml")
    except Exception as e:
        logging.error(f"Failed to load config: {e}")
        sys.exit(1)

    if args.refresh_metadata:
        client = get_opensearch_client(config)
        refresh_pravachan_series_metadata(config, client)
        rebuild_catalogue_index(config, client)
        sys.exit(0)

    if args.cleanup:
        cleanup_files(config, args.cleanup)
        client = get_opensearch_client(config)
        refresh_pravachan_series_metadata(config, client)
        sys.exit(0) # Exit after cleanup is done

    if args.command == 'discover':
        if args.delete_index:
            delete_index(config)
        if args.daemon:
            # Check existing daemon
            if not DaemonManager.check_existing_daemon():
                sys.exit(1)

            # Start daemon
            daemon = DiscoveryDaemon(config)
            daemon.start()
        else:
            run_discovery_once(
                config, args.crawl, args.index, args.dry_run,
                args.reindex_metadata_only, args.force,
                folder=args.process_folder)


if __name__ == '__main__':
    main()