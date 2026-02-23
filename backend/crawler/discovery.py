import os
import json
import hashlib
import sys
import traceback
import uuid
import logging
import requests
from datetime import datetime

import fitz

from backend.crawler.pdf_processor import PDFProcessor
from backend.crawler.pdf_factory import create_pdf_processor
from backend.utils import json_dumps
from backend.common.scan_config import get_scan_config
from backend.config import Config
from backend.crawler.index_generator import IndexGenerator
from backend.crawler.granth_index_generator import GranthIndexGenerator
from backend.crawler.index_state import IndexState
from backend.common.utils import get_merged_config

# Setup logging for this module
log_handle = logging.getLogger(__name__)

class SingleFileProcessor:
    def __init__(self, config: Config,
                 file_path: str,
                 indexing_mod: IndexGenerator,
                 index_state: IndexState,
                 scan_time: str,
                 pdf_processor_factory=None):
        self._config = config
        self._file_path = os.path.abspath(file_path)
        self._base_pdf_folder = config.BASE_PDF_PATH
        self._indexing_module = indexing_mod
        self._index_state = index_state
        self._output_text_base_dir = config.BASE_TEXT_PATH
        self._output_ocr_base_dir = config.BASE_OCR_PATH
        self._scan_time = scan_time
        self._pdf_processor_factory = pdf_processor_factory  # Optional: for testing

        # Load scan_config once and cache it
        self._scan_config = get_scan_config(self._file_path, self._base_pdf_folder)

    def _get_chunk_strategy(self) -> str:
        """
        Returns the chunk strategy from scan_config, falling back to config.CHUNK_STRATEGY.

        Returns:
            'advanced' or other strategy string
        """
        return self._scan_config.get("chunk_strategy", self._config.CHUNK_STRATEGY)

    def _get_pdf_processor(self) -> PDFProcessor:
        """
        Creates and returns the appropriate PDF processor.
        ocr_engine from scan_config determines LLM vs Tesseract.
        chunk_strategy determines paragraph chunking for Tesseract processors.
        Uses the injected pdf_processor_factory if provided (for testing).

        Returns:
            PDFProcessor, AdvancedPDFProcessor, or LLMPDFProcessor instance
        """
        if self._pdf_processor_factory:
            # Support both a factory callable (class or function) and a pre-built instance.
            # Tests may pass either: MockPDFProcessor (class) or create_pdf_processor(...) (instance).
            if callable(self._pdf_processor_factory):
                return self._pdf_processor_factory(self._config)
            return self._pdf_processor_factory  # already an instance
        else:
            # Use default factory — pass scan_config so ocr_engine can be read
            return create_pdf_processor(
                self._config,
                self._get_chunk_strategy(),
                self._scan_config
            )

    def _get_index_generator(self) -> IndexGenerator:
        """
        Returns the appropriate IndexGenerator for this document.

        Uses GranthIndexGenerator for LLM-extracted documents (ocr_engine == "llm"),
        which additionally writes verses_NNNN.json files alongside paragraphs.
        Falls back to the shared indexing module for all other documents.
        """
        ocr_engine = self._scan_config.get("ocr_engine", self._config.OCR_ENGINE)
        if ocr_engine == "llm":
            return GranthIndexGenerator(
                self._config, self._indexing_module._opensearch_client)
        return self._indexing_module

    def _get_ocr_file_extension(self) -> str:
        """
        Returns the file extension for OCR files based on the OCR engine.

        Returns:
            '.json' for LLM-based or advanced strategies, '.txt' otherwise
        """
        ocr_engine = self._scan_config.get("ocr_engine", self._config.OCR_ENGINE)
        if ocr_engine == "llm" or self._get_chunk_strategy() == "advanced":
            return ".json"
        return ".txt"

    def _get_metadata(self) -> dict:
        """
        Loads all the metadata for the file. This metadata will be indexed in OpenSearch.
        Includes file_url from scan_config if present.
        """
        # Use common utility to get merged config
        config = get_merged_config(self._file_path, self._base_pdf_folder)

        # Add file_url from scan_config if provided
        config["file_url"] = self._scan_config.get("file_url", "")

        return config

    def _get_config_hash(self, config_data: dict) -> str:
        """Generates a SHA256 hash for a config dictionary."""
        # Ensure consistent order for hashing by sorting keys
        sorted_config_str = json_dumps(
            config_data, sort_keys=True)
        return hashlib.sha256(sorted_config_str.encode('utf-8')).hexdigest()

    def _save_state(self, document_id: str, state: dict):
        """Saves the current indexed state to a JSON file."""
        self._index_state.update_state(document_id, state)

    def _get_page_list(self, scan_config):
        all_pages = set()

        # Add pages from the list of ranges
        pages_list = scan_config.get("page_list", [])
        for page in pages_list:
            start = page.get("start")
            end = page.get("end")

            # Add pages if both start and end exist
            if start is not None and end is not None:
                all_pages.update(range(start, end + 1))

        # Add pages from the top-level range
        start_page = scan_config.get("start_page")
        end_page = scan_config.get("end_page")

        if start_page is not None and end_page is not None:
            all_pages.update(range(start_page, end_page + 1))

        # 3. Return the final sorted list of unique pages
        return sorted(list(all_pages))

    # All meaningful fields that the bookmark extractor can return
    _BOOKMARK_FIELDS = ("pravachan_no", "date", "gatha", "kalash", "shlok")

    def _apply_forward_fill(self, parsed_bookmarks, total_pages):
        """
        Maps every page to bookmark data using forward-fill logic.
        Pages without bookmarks inherit data from the previous bookmark.

        Handles both Pravachan bookmarks (pravachan_no, date) and Granth bookmarks
        (gatha, kalash, shlok) generically — any bookmark with at least one non-null
        meaningful field advances the forward-fill state.

        Args:
            parsed_bookmarks: List of dicts from parse_bookmarks()
            total_pages: Total number of pages in PDF

        Returns:
            dict[int, dict]: Mapping of page_num -> {pravachan_no, date, gatha, kalash, shlok}
        """
        page_to_data = {}
        current_data = {f: None for f in self._BOOKMARK_FIELDS}
        bookmark_index = 0
        sorted_bookmarks = sorted(parsed_bookmarks, key=lambda x: x['page'])

        for page_num in range(1, total_pages + 1):
            while (bookmark_index < len(sorted_bookmarks) and
                   sorted_bookmarks[bookmark_index]['page'] <= page_num):
                bookmark = sorted_bookmarks[bookmark_index]
                # Advance only if the bookmark carries at least one meaningful field
                # (skips pure section headers with all-null fields)
                if any(bookmark.get(f) is not None for f in self._BOOKMARK_FIELDS):
                    current_data = {f: bookmark.get(f) for f in self._BOOKMARK_FIELDS}
                bookmark_index += 1
            page_to_data[page_num] = current_data.copy()

        return page_to_data

    def process(self):
        relative_pdf_path = os.path.relpath(self._file_path, self._base_pdf_folder)
        document_id = str(uuid.uuid5(uuid.NAMESPACE_URL, relative_pdf_path))

        pages_list = self._get_page_list(self._scan_config)
        current_ocr_checksum = self._index_state.calculate_ocr_checksum(
            relative_pdf_path, pages_list)

        last_state = self._index_state.get_state(document_id)

        # Check if OCR text files already exist for this OCR configuration
        if last_state and last_state.get("ocr_checksum") == current_ocr_checksum:
            log_handle.info(f"OCR text files already exist for {self._file_path}. Skipping.")
            return

        try:
            file_metadata = self._get_metadata()
            self._scan_config["language"] = file_metadata.get("language", "hi")

            # Get PDF processor based on chunk_strategy
            pdf_processor = self._get_pdf_processor()

            ret = pdf_processor.process_pdf(
                self._file_path, self._scan_config, pages_list)

            if ret:
                # Get current state to preserve parsed_bookmarks if it exists
                current_state = self._index_state.get_state(document_id) or {}

                # Update the state with new OCR info, preserving parsed_bookmarks
                current_state.update({
                    "file_path": relative_pdf_path,
                    "last_indexed_timestamp": self._scan_time,
                    "file_checksum": "",
                    "config_hash": "",
                    "ocr_checksum": current_ocr_checksum
                })

                self._save_state(document_id, current_state)

            log_handle.info(f"Generated OCR text files for {self._file_path}")

        except Exception as e:
            traceback.print_exc()
            log_handle.error(f"Failed to generate OCR text for {self._file_path}: {e}")
            return


    def index(self, dry_run=False, reindex_metadata_only=False):
        relative_path = os.path.relpath(self._file_path, self._base_pdf_folder)
        document_id = str(uuid.uuid5(uuid.NAMESPACE_URL, relative_path))
        log_handle.info(f"Indexing PDF: {self._file_path} ID: {document_id}, reindex_metadata_only: {reindex_metadata_only}")

        output_ocr_dir = f"{self._output_ocr_base_dir}/{os.path.splitext(relative_path)[0]}"
        output_text_dir = f"{self._output_text_base_dir}/{os.path.splitext(relative_path)[0]}"

        # Check if OCR directory exists
        if not os.path.exists(output_ocr_dir):
            log_handle.error(
                f"OCR directory does not exist for {self._file_path}. Run process() first.")
            return

        pages_list = self._get_page_list(self._scan_config)
        ocr_extension = self._get_ocr_file_extension()

        # Check if all required OCR pages exist
        missing_pages = []
        for page_num in pages_list:
            ocr_file = f"{output_ocr_dir}/page_{page_num:04d}{ocr_extension}"
            if not os.path.exists(ocr_file):
                missing_pages.append(page_num)

        if missing_pages:
            log_handle.error(
                f"Missing OCR files for pages {missing_pages} in {self._file_path}. "
                f"Run process() first.")
            return

        # Calculate current checksums for comparison
        file_metadata = self._get_metadata()
        current_config_hash = self._get_config_hash(file_metadata)
        current_ocr_checksum = self._index_state.calculate_ocr_checksum(relative_path, pages_list)

        index_state = self._index_state.get_state(document_id)

        # Check if indexing is needed based on config changes or OCR changes
        # Skip this check when reindex_metadata_only=True to force re-indexing
        if not reindex_metadata_only:
            if (index_state and
                index_state.get("config_hash") == current_config_hash and
                index_state.get("ocr_checksum") == current_ocr_checksum):
                log_handle.info(f"No changes detected for {self._file_path}. Not indexing.")
                return

        # Extract or load cached parsed bookmarks (pravachan_no and date)
        # Skip bookmark extraction if ignore_bookmarks is set in scan_config
        if self._scan_config.get("ignore_bookmarks", False):
            log_handle.info(f"Skipping bookmark extraction for {self._file_path} due to ignore_bookmarks flag")
            parsed_bookmarks = []
        else:
            parsed_bookmarks_json = index_state.get("parsed_bookmarks")
            if parsed_bookmarks_json:
                # Use cached parsed bookmarks
                parsed_bookmarks = json.loads(parsed_bookmarks_json)
                log_handle.info(f"Using cached parsed bookmarks for {self._file_path}: "
                              f"Received {len(parsed_bookmarks)} bookmarks")
                # Log first 2 bookmarks for sanity check
                if parsed_bookmarks:
                    sample_bookmarks = parsed_bookmarks[:2]
                    log_handle.info(f"Sample bookmarks: {sample_bookmarks}")
            else:
                # Call bookmark extractor to parse bookmarks
                log_handle.info(f"Extracting parsed bookmarks for {self._file_path}")
                try:
                    from backend.crawler.bookmark_extractor.factory import create_bookmark_extractor

                    extractor = create_bookmark_extractor(self._config)
                    parsed_bookmarks = extractor.parse_bookmarks(self._file_path)
                    log_handle.info(f"Successfully extracted {len(parsed_bookmarks)} bookmarks")
                except Exception as e:
                    log_handle.error(f"Failed to extract bookmarks: {e}")
                    parsed_bookmarks = []

        # Get total pages for forward-fill
        doc = fitz.open(self._file_path)
        total_pages = doc.page_count
        doc.close()

        # Apply forward-fill logic to map all pages
        page_to_pravachan_data = self._apply_forward_fill(parsed_bookmarks, total_pages)

        pdf_processor = self._get_pdf_processor()
        index_generator = self._get_index_generator()
        index_generator.index_document(
            document_id, relative_path, output_ocr_dir, output_text_dir,
            pages_list, file_metadata, self._scan_config,
            page_to_pravachan_data,
            reindex_metadata_only, dry_run,
            pdf_processor=pdf_processor
        )

        if dry_run:
            # During dry run, only cache the parsed bookmarks
            current_state = self._index_state.get_state(document_id) or {}
            current_state["parsed_bookmarks"] = json.dumps(parsed_bookmarks)
            self._save_state(document_id, current_state)
            log_handle.info(f"[DRY RUN] Cached parsed bookmarks for {self._file_path}")
        else:
            # During normal run, save complete state including parsed bookmarks
            self._save_state(document_id, {
                "file_path": relative_path,
                "last_indexed_timestamp": self._scan_time,
                "file_checksum": "",
                "config_hash": current_config_hash,
                "index_checksum": "",
                "ocr_checksum": current_ocr_checksum,
                "parsed_bookmarks": json.dumps(parsed_bookmarks)
            })
            log_handle.info(f"Completed indexing of {self._file_path}")


class Discovery:
    """
    The Discovery Module is responsible for scanning, preprocessing, and preparing PDF data
    and its associated metadata for ingestion into OpenSearch. It manages the lifecycle
    of documents from raw PDF to processed text and metadata, ensuring only new or
    changed content is re-indexed.
    """
    def __init__(self, config: Config,
                 indexing_mod: IndexGenerator,
                 index_state: IndexState,
                 pdf_processor_factory=None):
        """
        Initializes the Discovery module with configuration and indexing module.

        Args:
            config (Config): Configuration instance containing settings for discovery.
            indexing_mod (IndexGenerator): Instance responsible for indexing documents.
            index_state (IndexState): Instance for managing indexing state.
            pdf_processor_factory: Optional factory for creating PDF processors (for testing).
        """
        self._config = config
        self._indexing_module = indexing_mod
        self._index_state = index_state
        self._pdf_processor_factory = pdf_processor_factory  # For testing

        # Ensure required components are initialized
        if not self._indexing_module:
            log_handle.critical("IndexingEmbeddingModule not provided. Exiting.")
            sys.exit(1)

        self.base_pdf_folder = self._config.BASE_PDF_PATH
        self.base_text_folder = self._config.BASE_TEXT_PATH
        self.base_ocr_folder = self._config.BASE_OCR_PATH

        # Ensure output directories exist
        os.makedirs(self.base_pdf_folder, exist_ok=True)
        os.makedirs(self.base_text_folder, exist_ok=True)
        os.makedirs(self.base_ocr_folder, exist_ok=True)

        log_handle.info(f"DiscoveryModule initialized for base folder: {self.base_pdf_folder}")


    def _get_directories_to_crawl(self):
        """
        Recursively builds a list of directories to crawl.
        Skips directories containing a '_ignore' file and their subdirectories.

        Returns:
            list: List of directory paths to crawl
        """
        directories_to_crawl = []

        def _recurse_directory(directory_path):
            """Recursively traverse directory and collect paths to crawl"""
            # Check if this directory should be ignored
            ignore_file_path = os.path.join(directory_path, "_ignore")
            if os.path.exists(ignore_file_path):
                log_handle.info(f"Ignoring directory {directory_path} due to _ignore file")
                return  # Skip this directory and all its subdirectories

            # Add current directory to crawl list
            directories_to_crawl.append(directory_path)

            # Recursively process subdirectories
            try:
                for item in os.listdir(directory_path):
                    # Skip directories that start with a dot (like .git, .vscode, etc.)
                    if item.startswith('.'):
                        continue
                    item_path = os.path.join(directory_path, item)
                    if os.path.isdir(item_path):
                        _recurse_directory(item_path)
            except (OSError, PermissionError) as e:
                log_handle.warning(f"Cannot access directory {directory_path}: {e}")

        # Start recursion from base folder
        _recurse_directory(self.base_pdf_folder)

        return directories_to_crawl

    def _download_missing_pdfs(self, directory: str):
        """
        Checks the directory's scan_config.json for file entries with a file_url
        and downloads any PDFs that don't already exist locally.

        The PDF is saved as <key>.pdf (e.g. Samaysaar.pdf) in the same directory.
        """
        scan_config_path = os.path.join(directory, "scan_config.json")
        if not os.path.exists(scan_config_path):
            return

        try:
            with open(scan_config_path, "r", encoding="utf-8") as f:
                scan_config_data = json.load(f)
        except (json.JSONDecodeError, IOError) as e:
            log_handle.warning(f"Could not read scan_config.json in {directory}: {e}")
            return

        for key, file_config in scan_config_data.items():
            if key == "default" or not isinstance(file_config, dict):
                continue

            file_url = file_config.get("file_url", "")
            if not file_url:
                continue

            pdf_path = os.path.join(directory, f"{key}.pdf")
            if os.path.exists(pdf_path):
                log_handle.info(f"PDF already exists, skipping download: {pdf_path}")
                continue

            log_handle.info(f"Downloading {key}.pdf from {file_url}")
            try:
                response = requests.get(file_url, timeout=120, stream=True)
                response.raise_for_status()
                with open(pdf_path, "wb") as f:
                    for chunk in response.iter_content(chunk_size=8192):
                        f.write(chunk)
                log_handle.info(f"Downloaded {pdf_path} ({os.path.getsize(pdf_path)} bytes)")
            except Exception as e:
                log_handle.error(f"Failed to download {key}.pdf from {file_url}: {e}")

    def process_directory(
            self, directory, process=False, index=False,
            dry_run=False, reindex_metadata_only=False, scan_time=None):
        """
        Process all PDF files in a single directory (non-recursive).

        Args:
            directory: Path to directory to process
            process: Whether to process (OCR) files
            index: Whether to index files
            dry_run: Whether to perform dry run (no actual indexing)
            reindex_metadata_only: Whether to only update metadata fields
            scan_time: Timestamp for this scan (uses current time if not provided)
        """
        if scan_time is None:
            scan_time = datetime.now().isoformat()

        # Download any missing PDFs referenced by file_url in scan_config.json
        self._download_missing_pdfs(directory)

        try:
            files = os.listdir(directory)
        except (OSError, PermissionError) as e:
            log_handle.warning(f"Cannot access directory {directory}: {e}")
            return

        for file_name in files:
            if not file_name.lower().endswith(".pdf"):
                continue
            pdf_file_path = os.path.abspath(os.path.join(directory, file_name))

            single_file_processor = SingleFileProcessor(
                config=self._config,
                file_path=pdf_file_path,
                indexing_mod=self._indexing_module,
                index_state=self._index_state,
                scan_time=scan_time,
                pdf_processor_factory=self._pdf_processor_factory
            )
            if process:
                log_handle.info(f"Processing PDF file {file_name}")
                single_file_processor.process()

            if index:
                if dry_run:
                    log_handle.info(f"[DRY RUN] Would index file {file_name}")
                else:
                    log_handle.info(f"Indexing file {file_name}")
                single_file_processor.index(dry_run, reindex_metadata_only)

    def crawl(self, process=False, index=False, dry_run=False, reindex_metadata_only=False):
        """
        Scans the base PDF folder, identifies new or changed files/configs,
        and triggers indexing or re-indexing.

        Uses recursive directory traversal with _ignore file support.
        """
        current_scan_time = datetime.now().isoformat()
        log_handle.info(f"Starting scan process... at {current_scan_time}")
        log_handle.info(f"Base PDF path: {self.base_pdf_folder}")
        log_handle.info(f"process: {process}, index: {index}, reindex_metadata_only: {reindex_metadata_only}")

        if not process and not index:
            return

        # First, recursively create list of directories to crawl
        directories_to_crawl = self._get_directories_to_crawl()
        log_handle.info(f"Found {len(directories_to_crawl)} directories to crawl")

        # Second, crawl each directory for PDF files
        for directory in directories_to_crawl:
            self.process_directory(directory, process, index, dry_run, reindex_metadata_only, current_scan_time)

        self._index_state.garbage_collect(self.base_pdf_folder)

        # TODO(rajatjain): Delete files from OpenSearch index if they no longer exist in the
        # filesystem.

        log_handle.info(
            f"Scan and index process completed. Start: {current_scan_time}, "
            f"End: {datetime.now().isoformat()}")
