import datetime
import hashlib
import os
import shutil
import tempfile
import fitz
import pytest
import requests
from opensearchpy import OpenSearch

from backend.crawler.discovery import SingleFileProcessor, Discovery
from backend.crawler.index_state import IndexState
from backend.crawler.index_generator import IndexGenerator
from backend.crawler.pdf_processor import PDFProcessor, log_handle
from backend.common.opensearch import get_opensearch_client, create_indices_if_not_exists, refresh_pravachan_series_metadata, rebuild_full_metadata_index
from backend.common.catalogue import rebuild_catalogue_index
from tests.backend.base import *
from tests.backend.common import setup, write_config_file, APIServerManager, consume_sse

"""
Test Setup:
  - Create a temporary directory for test data.
  - Copy the various PDF files from the test data directory to the temporary directory.
  - Build JSON config files for some directories.
  - Build JSON config files for some PDF files.

Test Suite 1: Test get_metadata function for various files
  - get metadata for all the files created
  - change the config file in one of those directories
    - get metadata for the changed files again and confirm
  - delete a config file and confirm that the metadata is updated accordingly

Test Suite 2: Check the state
  - Setup: index_document() and pdf_process() are no-ops.
  - Define mocks for them.
  - repeat the same exercise of scanning all documents
  - change one config file. ensure configs of all affected files are updated.
  - delete one config file. ensure configs of all affected files are updated.
  - delete a file. ensure its config is removed.
"""

class MockIndexGenerator(IndexGenerator):
    def __init__(self, config: Config, opensearch_client: OpenSearch):
        super().__init__(config, opensearch_client)

    def index_document(
        self, document_id: str, original_filename: str,
        ocr_dir: str, output_text_dir: str, pages_list: list[int], metadata: dict,
        scan_config: dict, page_to_pravachan_data: dict[int, dict],
        reindex_metadata_only: bool = False, dry_run: bool = True,
        pdf_processor=None, clean_output_dir: bool = True):
        pass

    def create_index_if_not_exists(self):
        pass

class MockPDFProcessor(PDFProcessor):
    def __init__(self, config: Config):
        super().__init__(config)

    def process_pdf(
        self, pdf_path: str, scan_config: dict,
        pages_list: list[int]):
        relative_pdf_path = os.path.relpath(pdf_path, self._base_pdf_folder)
        output_ocr_dir = f"{self._base_ocr_folder}/{os.path.splitext(relative_pdf_path)[0]}"

        if os.path.exists(output_ocr_dir):
            shutil.rmtree(output_ocr_dir)

        os.makedirs(output_ocr_dir, exist_ok=True)

        # Get the base filename without path and extension for source directory
        base_filename = os.path.splitext(os.path.basename(pdf_path))[0]
        source_ocr_dir = f"{get_test_base_dir()}/data/ocr/{base_filename}"

        # Copy the page files for the pages in pages_list
        if os.path.exists(source_ocr_dir):
            for page_num in pages_list:
                source_file = f"{source_ocr_dir}/page_{page_num:04d}.txt"
                dest_file = f"{output_ocr_dir}/page_{page_num:04d}.txt"
                if os.path.exists(source_file):
                    shutil.copy2(source_file, dest_file)

        return True

class MockIndexState(IndexState):
    def calculate_ocr_checksum(self, relative_file_path: str, ocr_pages: list[int]) -> str:
        # only use relative file path
        if not relative_file_path:
            return ""
        return hashlib.sha256(relative_file_path.encode('utf-8')).hexdigest()

def test_forward_fill_doha_sutra():
    """
    Unit test for _apply_forward_fill with doha and sutra fields.

    Page layout:
      page 1 — bookmark with doha="3-4"
      pages 2-4 — no bookmarks → inherit doha="3-4"
      page 5 — bookmark with sutra="7" (replaces entire current_data, so doha resets to None)
      pages 6-8 — no bookmarks → inherit sutra="7"
    """
    setup()
    config = Config()
    pdf_path = f"{config.BASE_PDF_PATH}/hindi/history/hampi_hindi.pdf"

    sfp = SingleFileProcessor(
        config, pdf_path, None, None,
        datetime.datetime.now().isoformat(),
        pdf_processor_factory=MockPDFProcessor
    )

    parsed_bookmarks = [
        {"page": 1, "pravachan_no": None, "date": None, "gatha": None, "kalash": None,
         "shlok": None, "doha": "3-4", "sutra": None},
        {"page": 5, "pravachan_no": None, "date": None, "gatha": None, "kalash": None,
         "shlok": None, "doha": None, "sutra": "7"},
    ]

    result = sfp._apply_forward_fill(parsed_bookmarks, total_pages=8)

    # Pages 1-4: doha="3-4", sutra=None
    for page in range(1, 5):
        assert result[page]["doha"] == "3-4", f"page {page}: expected doha='3-4', got {result[page]['doha']}"
        assert result[page]["sutra"] is None, f"page {page}: expected sutra=None, got {result[page]['sutra']}"

    # Pages 5-8: sutra="7", doha=None (new bookmark resets all fields)
    for page in range(5, 9):
        assert result[page]["sutra"] == "7", f"page {page}: expected sutra='7', got {result[page]['sutra']}"
        assert result[page]["doha"] is None, f"page {page}: expected doha=None, got {result[page]['doha']}"


def test_get_metadata():
    setup()
    config = Config()
    pdf_dir = config.BASE_PDF_PATH

    # Test bangalore_hindi.pdf in hindi/cities/metro/ - should get language, category, and type
    sfp = SingleFileProcessor(
        config, f"{pdf_dir}/hindi/cities/metro/bangalore_hindi.pdf",
        None, None,
        datetime.datetime.now().isoformat(),
        pdf_processor_factory=MockPDFProcessor
    )
    meta = sfp._get_metadata()
    assert meta == {'language': 'hi', 'category': 'Pravachan', 'Anuyog': 'city', 'type': 'metro',
                    'Name': 'Bangalore', 'count': 'compiled', 'file_url': ''}

    # Test bangalore_gujarati.pdf in gujarati/cities/metro/ - should get language, category, and type
    sfp = SingleFileProcessor(
        config, f"{pdf_dir}/gujarati/cities/metro/bangalore_gujarati.pdf",
        None, None,
        datetime.datetime.now().isoformat()
    )
    meta = sfp._get_metadata()
    assert meta == {'language': 'gu', 'category': 'Pravachan', 'Anuyog': 'city', 'type': 'metro',
                    'Name': 'Bangalore', 'count': 'compiled', 'file_url': ''}

    # Test hampi_hindi.pdf in hindi/history/ - should get language and category
    sfp = SingleFileProcessor(
        config, f"{pdf_dir}/hindi/history/hampi_hindi.pdf",
        None, None,
        datetime.datetime.now().isoformat()
    )
    meta = sfp._get_metadata()
    assert meta == {'language': 'hi', 'category': 'Pravachan', 'Anuyog': 'history', 'Name': 'Hampi', 'file_url': ''}

    # Test indore_hindi.pdf in hindi/cities/non_metro/ - should get language, category, and type
    sfp = SingleFileProcessor(
        config, f"{pdf_dir}/hindi/cities/non_metro/indore_hindi.pdf",
        None, None,
        datetime.datetime.now().isoformat()
    )
    meta = sfp._get_metadata()
    assert meta == {'language': 'hi', 'category': 'Pravachan', 'Anuyog': 'city', 'type': 'non_metro', 'file_url': ''}

    # Test songadh_gujarati.pdf in gujarati/spiritual/ - should get language and category
    sfp = SingleFileProcessor(
        config, f"{pdf_dir}/gujarati/spiritual/songadh_gujarati.pdf",
        None, None,
        datetime.datetime.now().isoformat()
    )
    meta = sfp._get_metadata()
    assert meta == {'language': 'gu', 'category': 'Pravachan', 'Anuyog': 'spiritual',
                    'Pravachankar': 'Test Pravachankar',
                    'Name': 'Songadh', 'series_start_date': '1975-01-01',
                    'series_end_date': '1977-12-31', 'count': '50', 'file_url': ''}

def test_crawl(initialise):
    config = Config()
    # create temp dir
    doc_ids = setup()

    index_state = MockIndexState(config.SQLITE_DB_PATH)

    discovery = Discovery(
        config,
        MockIndexGenerator(config, None),
        index_state,
        pdf_processor_factory=MockPDFProcessor)

    discovery.crawl(process=True, index=True)

    state1 = index_state.load_state()
    log_handle.info(f"state: {json_dumps(state1)}")
    assert len(state1) == 13

    # change the hindi cities config file to affect all hindi city files
    new_config = {"Anuyog": "urban"}
    write_config_file(f"{config.BASE_PDF_PATH}/hindi/cities/config.json", new_config)
    # re-crawl

    log_handle.info(f"Test 1: re-crawling after changing config file")
    discovery.crawl(process=True, index=True)

    changed_keys = [
        doc_ids["bangalore_hindi"][1],
        doc_ids["indore_hindi"][1],
        doc_ids["jaipur_hindi"][1]
    ]
    state2 = index_state.load_state()
    log_handle.info(f"state: {json_dumps(state2)}")
    log_handle.info(f"changed_keys: {changed_keys}")

    validate(state1, state2, changed_keys, check_file_changed=False, check_config_changed=True)

    log_handle.info(f"Test 2: re-crawling after changing config file again")
    # change the config for jaipur_gujarati.pdf
    jgx = {"Anuyog": "special_city", "type": "heritage"}
    fname = doc_ids["jaipur_gujarati"][0]
    config_fname = fname.replace(".pdf", "_config.json")
    write_config_file(config_fname, jgx)

    changed_keys = [doc_ids["jaipur_gujarati"][1]]
    discovery.crawl(process=True, index=True)
    state3 = index_state.load_state()
    validate(state2, state3, changed_keys, check_file_changed=False, check_config_changed=True)

    # delete a config file. should be removed from state
    log_handle.info(f"Test 3: re-crawling after deleting config file")
    fname = doc_ids["jaipur_hindi"][0]
    assert os.path.exists(fname)
    os.remove(fname)
    assert not os.path.exists(fname)
    discovery.crawl(process=True, index=True)
    state4 = index_state.load_state()
    log_handle.info(f"state: {json_dumps(state4)}")
    assert len(state4) == 12

    # it shouldn't have the fname in "state"
    assert doc_ids["jaipur_hindi"][1] not in state4
    validate(state3, state4, changed_keys=[], check_file_changed=False, check_config_changed=False)

    # copy an existing file to another folder to test new file discovery
    log_handle.info(f"Test 4: copying file to new location and re-crawling")
    source_file = doc_ids["songadh_hindi"][0]  # hindi/spiritual/songadh_hindi.pdf
    dest_file = f"{config.BASE_PDF_PATH}/gujarati/history/songadh_copy.pdf"
    shutil.copy(source_file, dest_file)

    discovery.crawl(process=True, index=True)
    state5 = index_state.load_state()
    log_handle.info(f"state after copying file: {json_dumps(state5)}")
    assert len(state5) == 13  # should be back to 13 files (12 + 1 new copy)


def test_pages_crawl(initialise):
    config = Config()
    doc_ids = setup()

    index_state = MockIndexState(config.SQLITE_DB_PATH)

    discovery = Discovery(
        config,
        MockIndexGenerator(config, None),
        index_state,
        pdf_processor_factory=MockPDFProcessor)

    # Start with scan_config pages [1]
    config.SCAN_CONFIG = {"pages": [1]}
    discovery.crawl(process=True, index=True)

    state1 = index_state.load_state()
    log_handle.info(f"Initial state with pages [1]: {json_dumps(state1)}")
    assert len(state1) == 13

    # Change scan_config to pages [1, 2] for some specific files by updating their config files
    files_to_change = [
        (f"{config.BASE_PDF_PATH}/hindi/cities/metro/bangalore_hindi.pdf", doc_ids["bangalore_hindi"][1]),
        (f"{config.BASE_PDF_PATH}/gujarati/cities/metro/bangalore_gujarati.pdf", doc_ids["bangalore_gujarati"][1]),
        (f"{config.BASE_PDF_PATH}/hindi/history/hampi_hindi.pdf", doc_ids["hampi_hindi"][1])
    ]

    for file_path, doc_id in files_to_change:
        config_path = file_path.replace(".pdf", "_config.json")
        config_data = {"pages": [1, 2]}
        write_config_file(config_path, config_data)

    discovery.crawl(process=True, index=True)

    state2 = index_state.load_state()
    log_handle.info(f"State after changing pages config for some files: {json_dumps(state2)}")

    # Ensure that only the modified files have their config_checksum changed
    changed_files = [doc_ids["bangalore_hindi"][1], doc_ids["bangalore_gujarati"][1], doc_ids["hampi_hindi"][1]]

    validate(state1, state2, changed_files, check_file_changed=False, check_config_changed=True)

    # Add skip_pdf_pages to a file — should trigger re-index (config_hash changes)
    skip_target_path = f"{config.BASE_PDF_PATH}/hindi/history/hampi_hindi.pdf"
    skip_target_id = doc_ids["hampi_hindi"][1]
    skip_config_path = skip_target_path.replace(".pdf", "_config.json")
    write_config_file(skip_config_path, {"skip_pdf_pages": [2, 4, 6]})

    discovery.crawl(process=True, index=True)
    state3 = index_state.load_state()

    assert state3[skip_target_id]["last_indexed_timestamp"] != state2[skip_target_id]["last_indexed_timestamp"]
    assert state3[skip_target_id]["config_hash"] != state2[skip_target_id]["config_hash"]

    # Extend skip_pdf_pages — should trigger another re-index
    write_config_file(skip_config_path, {"skip_pdf_pages": [2, 4, 6, 8]})
    discovery.crawl(process=True, index=True)
    state4 = index_state.load_state()

    assert state4[skip_target_id]["last_indexed_timestamp"] != state3[skip_target_id]["last_indexed_timestamp"]
    assert state4[skip_target_id]["config_hash"] != state3[skip_target_id]["config_hash"]

    # Remove skip_pdf_pages entirely — config_hash changes again
    write_config_file(skip_config_path, {})
    discovery.crawl(process=True, index=True)
    state5 = index_state.load_state()

    assert state5[skip_target_id]["last_indexed_timestamp"] != state4[skip_target_id]["last_indexed_timestamp"]
    assert state5[skip_target_id]["config_hash"] != state4[skip_target_id]["config_hash"]

def test_ignore_file(initialise):
    config = Config()
    doc_ids = setup()

    index_state = MockIndexState(config.SQLITE_DB_PATH)

    discovery = Discovery(
        config,
        MockIndexGenerator(config, None),
        index_state,
        pdf_processor_factory=MockPDFProcessor)

    # Add _ignore files in 2 folders to ignore all files in those folders
    ignore_folders = [
        f"{config.BASE_PDF_PATH}/hindi/cities/metro",     # Will ignore bangalore_hindi.pdf
        f"{config.BASE_PDF_PATH}/gujarati/history"        # Will ignore hampi_gujarati.pdf, thanjavur_gujarati.pdf
    ]

    for folder in ignore_folders:
        ignore_file = f"{folder}/_ignore"
        with open(ignore_file, 'w') as f:
            f.write("")  # Empty file

    # First crawl - should ignore files in the 2 folders
    discovery.crawl(process=True, index=True)

    state1 = index_state.load_state()
    log_handle.info(f"Initial crawl with 2 ignored folders: {json_dumps(state1)}")
    # Should have fewer files (depends on how many files are in ignored folders)

    # Verify the ignored files are not in state
    ignored_doc_ids = [doc_ids["bangalore_hindi"][1], doc_ids["hampi_gujarati"][1],
                       doc_ids["thanjavur_gujarati"][1]]
    for ignored_id in ignored_doc_ids:
        assert ignored_id not in state1

    # Delete first ignore file
    first_ignore = f"{ignore_folders[0]}/_ignore"
    os.remove(first_ignore)

    discovery.crawl(process=True, index=True)
    state2 = index_state.load_state()
    log_handle.info(f"After removing first ignore file: {json_dumps(state2)}")
    assert doc_ids["bangalore_hindi"][1] in state2  # This file should now be indexed

    # Validate that only the newly unignored file is changed, others remain unchanged
    changed_keys = [doc_ids["bangalore_hindi"][1]]
    validate(state1, state2, changed_keys, check_file_changed=False, check_config_changed=True, new_file_added=True)

    # Delete second ignore file
    second_ignore = f"{ignore_folders[1]}/_ignore"
    os.remove(second_ignore)

    discovery.crawl(process=True, index=True)
    state3 = index_state.load_state()
    log_handle.info(f"After removing second ignore file: {json_dumps(state3)}")
    assert doc_ids["hampi_gujarati"][1] in state3  # This file should now be indexed
    assert doc_ids["thanjavur_gujarati"][1] in state3

    # Validate that only the newly unignored file is changed, others remain unchanged
    changed_keys = [doc_ids["hampi_gujarati"][1], doc_ids["thanjavur_gujarati"][1]]
    validate(state2, state3, changed_keys, check_file_changed=False, check_config_changed=True, new_file_added=True)

    # Final validation - should have all files
    assert len(state3) == 13

def test_crawl_vs_crawl_and_index(initialise):
    config = Config()
    doc_ids = setup()

    index_state = MockIndexState(config.SQLITE_DB_PATH)

    discovery = Discovery(
        config,
        MockIndexGenerator(config, None),
        index_state,
        pdf_processor_factory=MockPDFProcessor)

    # First call crawl with only process=True (no indexing)
    discovery.crawl(process=True, index=False)

    state1 = index_state.load_state()
    log_handle.info(f"State after crawl(process=True, index=False): {json_dumps(state1)}")
    assert len(state1) == 13

    # Validate that ocr_checksum is present but config_hash should be empty (since no indexing was done)
    for doc_id, vals in state1.items():
        assert vals["ocr_checksum"] is not None  # OCR processing was done
        assert vals["config_hash"] == ""         # No indexing was done, so config_hash is empty

    # Now call crawl with both process=True and index=True
    discovery.crawl(process=True, index=True)

    state2 = index_state.load_state()
    log_handle.info(f"State after crawl(process=True, index=True): {json_dumps(state2)}")
    assert len(state2) == 13

    # Validate that both ocr_checksum and config_hash are present
    for doc_id, vals in state2.items():
        assert vals["ocr_checksum"] is not None  # OCR processing was done
        assert vals["config_hash"] != ""         # Indexing was done, so config_hash is set to non-empty
        # Timestamp should be updated since indexing happened
        assert vals["last_indexed_timestamp"] != state1[doc_id]["last_indexed_timestamp"]
        # OCR checksum should remain the same since files didn't change
        assert vals["ocr_checksum"] == state1[doc_id]["ocr_checksum"]

def test_page_list_scan_config():
    setup()
    config = Config()
    sfp = SingleFileProcessor(
        config, f"{config.BASE_PDF_PATH}/hindi/cities/metro/bangalore_hindi.pdf",
        None, None,
        datetime.datetime.now().isoformat(),
        pdf_processor_factory=MockPDFProcessor
    )

    # page_list with two ranges
    pages = sfp._get_page_list({"page_list": [{"start": 1, "end": 3}, {"start": 5, "end": 6}]})
    assert pages == [1, 2, 3, 5, 6]

    # entries missing start or end are skipped; only complete entry {start:2, end:4} contributes
    pages = sfp._get_page_list({"page_list": [{"start": 1}, {"end": 5}, {"start": 2, "end": 4}]})
    assert pages == [2, 3, 4]

    # page_list combined with top-level start_page/end_page
    pages = sfp._get_page_list({"page_list": [{"start": 1, "end": 2}], "start_page": 4, "end_page": 5})
    assert pages == [1, 2, 4, 5]

    # skip_pdf_pages removes specific pages from a range
    pages = sfp._get_page_list({
        "start_page": 1, "end_page": 15,
        "skip_pdf_pages": [3, 7, 12]
    })
    assert 3 not in pages and 7 not in pages and 12 not in pages
    assert 2 in pages and 4 in pages and 6 in pages and 8 in pages and 11 in pages and 13 in pages
    assert len(pages) == 12  # 15 pages minus 3 skipped

    # skip_pdf_pages applies across sub_sections — pages skipped in whichever section they fall
    pages = sfp._get_page_list({
        "sub_sections": [
            {"start_page": 1, "end_page": 10},
            {"start_page": 11, "end_page": 20},
        ],
        "skip_pdf_pages": [5, 8, 15]
    })
    assert 5 not in pages and 8 not in pages and 15 not in pages
    assert 4 in pages and 6 in pages and 7 in pages and 9 in pages and 14 in pages and 16 in pages
    assert len(pages) == 17  # 20 pages minus 3 skipped

    # skip_pdf_pages at sub-section boundaries trims both sections
    pages = sfp._get_page_list({
        "sub_sections": [
            {"start_page": 1, "end_page": 20},
            {"start_page": 21, "end_page": 40},
        ],
        "skip_pdf_pages": [20, 21]
    })
    assert 20 not in pages and 21 not in pages
    assert 19 in pages and 22 in pages
    assert len(pages) == 38  # 40 pages minus 2 skipped


def test_force_crawl(initialise):
    config = Config()
    doc_ids = setup()
    index_state = MockIndexState(config.SQLITE_DB_PATH)
    discovery = Discovery(
        config,
        MockIndexGenerator(config, None),
        index_state,
        pdf_processor_factory=MockPDFProcessor)

    # Initial full crawl + index
    discovery.crawl(process=True, index=True)
    state0 = index_state.load_state()
    assert len(state0) == 13
    for doc_id, vals in state0.items():
        assert vals["ocr_checksum"] is not None
        assert vals["config_hash"] != ""

    # Re-crawl without force — nothing should change
    discovery.crawl(process=True, index=True)
    state_unchanged = index_state.load_state()
    for doc_id, vals in state_unchanged.items():
        assert vals["last_indexed_timestamp"] == state0[doc_id]["last_indexed_timestamp"]

    # --- Case 1: --crawl --force (ocr_checksum NULLed, config_hash untouched) ---
    target1 = doc_ids["bangalore_hindi"][1]
    rel1 = os.path.relpath(doc_ids["bangalore_hindi"][0], config.BASE_PDF_PATH)
    index_state.invalidate_state(rel1, crawl=True)

    s = index_state.get_state(target1)
    assert s["ocr_checksum"] is None
    assert s["config_hash"] != ""  # config_hash untouched

    discovery.crawl(process=True, index=False)
    state1 = index_state.load_state()

    assert state1[target1]["last_indexed_timestamp"] != state0[target1]["last_indexed_timestamp"]
    assert state1[target1]["ocr_checksum"] is not None        # restored by re-crawl
    assert state1[target1]["config_hash"] == ""               # process() clears config_hash to force re-index
    for doc_id in state1:
        if doc_id != target1:
            assert state1[doc_id]["last_indexed_timestamp"] == state0[doc_id]["last_indexed_timestamp"]

    # --- Case 2: --index --force (config_hash NULLed, ocr_checksum untouched) ---
    target2 = doc_ids["hampi_hindi"][1]
    rel2 = os.path.relpath(doc_ids["hampi_hindi"][0], config.BASE_PDF_PATH)
    index_state.invalidate_state(rel2, index=True)

    s = index_state.get_state(target2)
    assert s["config_hash"] is None
    assert s["ocr_checksum"] is not None  # ocr_checksum untouched

    discovery.crawl(process=False, index=True)
    state2 = index_state.load_state()

    assert state2[target2]["last_indexed_timestamp"] != state1[target2]["last_indexed_timestamp"]
    assert state2[target2]["config_hash"] is not None         # restored by re-index
    assert state2[target2]["ocr_checksum"] == state1[target2]["ocr_checksum"]  # unchanged
    # target1 is excluded: Case 1 left it with config_hash="" so it also gets re-indexed here
    for doc_id in state2:
        if doc_id not in (target2, target1):
            assert state2[doc_id]["last_indexed_timestamp"] == state1[doc_id]["last_indexed_timestamp"]

    # --- Case 3: --crawl --index --force (both NULLed) ---
    target3 = doc_ids["indore_hindi"][1]
    rel3 = os.path.relpath(doc_ids["indore_hindi"][0], config.BASE_PDF_PATH)
    index_state.invalidate_state(rel3, crawl=True, index=True)

    s = index_state.get_state(target3)
    assert s["ocr_checksum"] is None
    assert s["config_hash"] is None

    discovery.crawl(process=True, index=True)
    state3 = index_state.load_state()

    assert state3[target3]["last_indexed_timestamp"] != state2[target3]["last_indexed_timestamp"]
    assert state3[target3]["ocr_checksum"] is not None        # restored
    assert state3[target3]["config_hash"] is not None         # restored
    for doc_id in state3:
        if doc_id != target3:
            assert state3[doc_id]["last_indexed_timestamp"] == state2[doc_id]["last_indexed_timestamp"]


def test_crawl_with_root_folder(initialise):
    config = Config()
    doc_ids = setup()

    hindi_base = f"{config.BASE_PDF_PATH}/hindi"
    index_state = MockIndexState(config.SQLITE_DB_PATH)
    discovery = Discovery(
        config,
        MockIndexGenerator(config, None),
        index_state,
        pdf_processor_factory=MockPDFProcessor)

    # Crawl only the hindi subtree
    discovery.crawl(process=True, index=True, root_folder=hindi_base)

    state1 = index_state.load_state()
    assert len(state1) == 7, f"Expected 7 hindi files, got {len(state1)}"

    hindi_ids = {
        doc_ids["bangalore_hindi"][1],
        doc_ids["hampi_hindi"][1],
        doc_ids["indore_hindi"][1],
        doc_ids["jaipur_hindi"][1],
        doc_ids["songadh_hindi"][1],
        doc_ids["thanjavur_hindi"][1],
        doc_ids["vachanamrut_hindi"][1],
    }
    gujarati_ids = {
        doc_ids["bangalore_gujarati"][1],
        doc_ids["hampi_gujarati"][1],
        doc_ids["indore_gujarati"][1],
        doc_ids["jaipur_gujarati"][1],
        doc_ids["songadh_gujarati"][1],
        doc_ids["thanjavur_gujarati"][1],
    }
    assert hindi_ids == set(state1.keys()), "State should contain only hindi doc IDs"
    for gid in gujarati_ids:
        assert gid not in state1, f"Gujarati doc {gid} should not be indexed"

    # Full crawl — should pick up the remaining gujarati files
    discovery.crawl(process=True, index=True)

    state2 = index_state.load_state()
    assert len(state2) == 13, f"Expected 13 files after full crawl, got {len(state2)}"

    # Hindi files already indexed — timestamps must be unchanged
    for hid in hindi_ids:
        assert state2[hid]["last_indexed_timestamp"] == state1[hid]["last_indexed_timestamp"], \
            f"Hindi doc {hid} should not have been re-indexed"

    # Gujarati files are new — must now be present
    for gid in gujarati_ids:
        assert gid in state2, f"Gujarati doc {gid} should now be indexed"


"""
Test Suite 3: Full end-to-end discovery workflow, verified via the live HTTP API.

Every test above this point uses MockIndexGenerator (index_document() is a no-op)
and only checks crawl-state mechanics or the filesystem-config merge logic in
isolation. It never actually writes to OpenSearch, so it can't catch bugs in how
indexing populates the metadata/catalogue indices, or in how the API serves what
was indexed (e.g. the pravachan_series_cascade dict-in-set crash, which lived
entirely in the API's response-combining logic and was invisible to any
MockIndexGenerator-based test).

This suite runs a REAL discovery crawl (real IndexGenerator, real OCR fixtures via
setup(copy_ocr_files=True), real OpenSearch) over the same Stage-1 fixture tree
used above, then asserts against the live /api/metadata, /api/catalogue and
/api/search endpoints -- the same way the frontend consumes them.
"""

_WORKFLOW_API_HOST = "127.0.0.1"
_WORKFLOW_API_PORT = 19878


@pytest.fixture(scope="module")
def full_discovery_state(initialise):
    """
    Runs a full discovery crawl end-to-end with the REAL IndexGenerator, then
    performs the same post-crawl steps production's DiscoveryDaemon does after
    a crawl: rebuild_catalogue_index() + refresh_pravachan_series_metadata().
    Starts a live API server against the same indices and yields its base_url.

    Clean-slate: deletes and recreates all three OpenSearch indices before the
    crawl, and deletes them again on teardown.
    """
    config = Config()
    opensearch_client = get_opensearch_client(config)

    all_indices = [
        config.OPENSEARCH_INDEX_NAME,
        config.OPENSEARCH_METADATA_INDEX_NAME,
        config.OPENSEARCH_CATALOGUE_INDEX_NAME,
    ]
    for idx in all_indices:
        opensearch_client.indices.delete(index=idx, ignore=[400, 404])
    create_indices_if_not_exists(config, opensearch_client)

    doc_ids = setup(copy_ocr_files=True, add_scan_config=True)

    discovery = Discovery(
        config,
        IndexGenerator(config, opensearch_client),
        IndexState(config.SQLITE_DB_PATH),
    )
    discovery.crawl(process=False, index=True)
    rebuild_catalogue_index(config, opensearch_client)
    refresh_pravachan_series_metadata(config, opensearch_client)

    for idx in all_indices:
        opensearch_client.indices.refresh(index=idx)

    server = APIServerManager(host=_WORKFLOW_API_HOST, port=_WORKFLOW_API_PORT)
    server.start_server_in_thread()

    try:
        yield {
            "doc_ids": doc_ids,
            "base_url": f"http://{server.host}:{server.port}",
        }
    finally:
        server.stop_server()
        for idx in all_indices:
            opensearch_client.indices.delete(index=idx, ignore=[400, 404])


def test_full_discovery_workflow_metadata_via_api(full_discovery_state):
    """
    Workflow: full discovery crawl -> /api/metadata should reflect per-language
    Name aggregates correctly, including a hindi-only Name (Vachanamrut, nested
    under a Series-grouping parent folder) not leaking into the gujarati set.
    """
    base_url = full_discovery_state["base_url"]

    resp = requests.get(f"{base_url}/api/metadata", timeout=10)
    assert resp.status_code == 200
    metadata = resp.json()

    assert "Pravachan" in metadata
    name_hi = set(metadata["Pravachan"].get("Name_hi", []))
    name_gu = set(metadata["Pravachan"].get("Name_gu", []))

    assert {"Songadh", "Bangalore", "Hampi", "Thanjavur", "Vachanamrut"} <= name_hi
    assert {"Songadh", "Bangalore", "Hampi", "Thanjavur"} <= name_gu
    assert "Vachanamrut" not in name_gu, \
        "Vachanamrut only exists under hindi_base -- must not leak into gujarati metadata"


def test_full_discovery_workflow_catalogue_via_api(full_discovery_state):
    """
    Workflow: full discovery crawl -> /api/catalogue should contain exactly the
    curated rows (count-bearing series, the "compiled" sentinel, and a leaf
    series folder under a Series-grouping parent) and exclude everything else --
    in particular the Vachanamrut parent folder itself, which has no count of
    its own and must not inherit one from a sibling (see the fixture comment in
    common.py:setup() for why it's a sibling of spiritual/, not nested inside it).
    """
    base_url = full_discovery_state["base_url"]

    resp = requests.get(f"{base_url}/api/catalogue", timeout=10)
    assert resp.status_code == 200
    rows_by_path = {row["relative_path"]: row for row in resp.json()}

    expected_present = {
        "hindi/spiritual": {"granth": "Songadh", "count": "50"},
        "gujarati/spiritual": {"granth": "Songadh", "count": "50"},
        "hindi/cities/metro": {"granth": "Bangalore", "count": "compiled"},
        "gujarati/cities/metro": {"granth": "Bangalore", "count": "compiled"},
        "hindi/vachanamrut/1980_series": {"granth": "Vachanamrut", "count": "10", "series": "1980 Series"},
    }
    for path, expected in expected_present.items():
        assert path in rows_by_path, f"expected catalogue row for {path}"
        for key, value in expected.items():
            assert rows_by_path[path][key] == value, \
                f"{path}: expected {key}={value!r}, got {rows_by_path[path][key]!r}"

    expected_absent = {
        "hindi/vachanamrut",           # series-grouping parent, no count of its own
        "hindi/history",               # Name is per-file (Hampi/Thanjavur), not folder-level
        "gujarati/history",
        "hindi/cities/non_metro",      # no Name, no count
        "gujarati/cities/non_metro",
        "hindi/cities",
        "gujarati/cities",
    }
    for path in expected_absent:
        assert path not in rows_by_path, \
            f"{path} should be excluded from the catalogue (no count, not a Name-bearing leaf)"


def test_full_discovery_workflow_mixed_language_routing(full_discovery_state):
    """
    Workflow: a document whose raw config `language` is the mixed value "gu+hi"
    (indore_gujarati_config.json, mirroring real production's Bahinshree content)
    must still be routed entirely as gujarati -- both at index time (content
    written to text_content_gujarati, not text_content_hindi, and chunked with
    gujarati paragraph-generation rules) and at query time (found by a gu search,
    not a hi search).

    This is a direct regression guard for the most severe bug found this
    session: an unnormalized raw language value like "gu+hi" caused content to
    be written to the WRONG OpenSearch text field and processed with the wrong
    language's paragraph rules. Fixed by unifying language normalization into
    backend/common/language.py, but until now nothing exercised the "gu+hi"
    raw value end-to-end through the real indexing pipeline -- existing unit
    tests (test_index_generator.py) only ever used plain "hi"/"gu".
    """
    base_url = full_discovery_state["base_url"]
    config = Config()
    opensearch_client = get_opensearch_client(config)

    doc_id = full_discovery_state["doc_ids"]["indore_gujarati"][1]
    hits = opensearch_client.search(
        index=config.OPENSEARCH_INDEX_NAME,
        body={"size": 50, "query": {"term": {"document_id": doc_id}}},
    )["hits"]["hits"]
    assert hits, "Expected indexed chunks for indore_gujarati (raw language 'gu+hi')"

    for hit in hits:
        source = hit["_source"]
        assert source["metadata"]["language"] == "gu+hi", \
            "The raw config value should be stored as-is on the document (cleanup deferred, only routing was fixed)"
        assert source.get("text_content_gujarati"), \
            f"Expected gu+hi content in text_content_gujarati, chunk={hit['_id']}"
        assert not source.get("text_content_hindi"), \
            f"gu+hi content must NOT be written to text_content_hindi, chunk={hit['_id']}"

    # Query-time routing: a gujarati search must find it, a hindi search must not.
    gu_payload = {
        "query": "ઇન્દોર", "language": "gu", "exact_match": False, "exclude_words": [],
        "categories": {},
        "search_types": {
            "Pravachan": {"enabled": True, "page_size": 10, "page_number": 1},
            "Granth": {"enabled": False, "page_size": 10, "page_number": 1},
        },
        "enable_reranking": False,
    }
    gu_response = requests.post(f"{base_url}/api/search", json=gu_payload, timeout=30)
    assert gu_response.status_code == 200
    gu_results = consume_sse(gu_response)["pravachan_results"]["results"]
    assert any(r.get("original_filename", "").endswith("indore_gujarati.pdf") for r in gu_results), \
        "Expected a gujarati-language search to find the gu+hi indore_gujarati content"

    hi_payload = dict(gu_payload, language="hi")
    hi_response = requests.post(f"{base_url}/api/search", json=hi_payload, timeout=30)
    assert hi_response.status_code == 200
    hi_results = consume_sse(hi_response)["pravachan_results"]["results"]
    assert not any(r.get("original_filename", "").endswith("indore_gujarati.pdf") for r in hi_results), \
        "A hindi-language search must not surface gu+hi content indexed under text_content_gujarati"


def test_full_discovery_workflow_pravachankar_via_search(full_discovery_state):
    """
    Workflow: full discovery crawl -> searching Songadh content via /api/search
    should surface the Pravachankar honorific display on results, falling back
    to the raw config value for a Pravachankar not yet in PRAVACHANKAR_HONORIFICS.

    This is a regression guard for the original Pravachankar bug this session
    started from: a hardcoded "Kanji" substring check that blocked any other
    Pravachankar's honorific from ever displaying.
    """
    base_url = full_discovery_state["base_url"]

    search_payload = {
        "query": "सोनगढ़",
        "language": "hi",
        "exact_match": False,
        "exclude_words": [],
        "categories": {},
        "search_types": {
            "Pravachan": {"enabled": True, "page_size": 10, "page_number": 1},
            "Granth": {"enabled": False, "page_size": 10, "page_number": 1},
        },
        "enable_reranking": False,
    }
    response = requests.post(f"{base_url}/api/search", json=search_payload, timeout=30)
    assert response.status_code == 200
    data = consume_sse(response)

    results = data["pravachan_results"]["results"]
    assert len(results) > 0, "Expected at least one Songadh search hit"
    assert any(r.get("Pravachankar") == "Test Pravachankar" for r in results), \
        "Expected the Songadh result's Pravachankar honorific to fall back to the raw config value"


def test_full_discovery_workflow_cascade_cross_language_isolation(full_discovery_state):
    """
    Workflow: full discovery crawl -> the Pravachan_series_cascade metadata doc
    must be scoped per-language. Thanjavur exists in both hindi and gujarati
    with the *same* Name and series dates but *different* bookmark-derived
    pravachan numbers (hindi: 3, 6; gujarati: 15, 18) -- mirrors real
    production's Niyamsaar "1975 Series" existing independently per language.

    This is a regression guard for the original cascade bug this session found:
    a single unified (not per-language) cascade doc caused cross-language data
    leakage, so a hindi-language filter could surface gujarati pravachan numbers
    and vice versa.
    """
    base_url = full_discovery_state["base_url"]

    resp = requests.get(f"{base_url}/api/metadata", timeout=10)
    assert resp.status_code == 200
    pravachan_meta = resp.json()["Pravachan"]

    cascade_hi = pravachan_meta.get("pravachan_series_cascade_hi", [])
    cascade_gu = pravachan_meta.get("pravachan_series_cascade_gu", [])
    assert cascade_hi, "Expected a non-empty hindi cascade"
    assert cascade_gu, "Expected a non-empty gujarati cascade"

    def _thanjavur_pravachan_numbers(series_list):
        for series in series_list:
            if series.get("granth") == "Thanjavur":
                numbers = set()
                for volume in series.get("volumes", []):
                    numbers.update(str(n) for n in volume.get("pravachan_numbers", []))
                return numbers
        return set()

    hi_numbers = _thanjavur_pravachan_numbers(cascade_hi)
    gu_numbers = _thanjavur_pravachan_numbers(cascade_gu)

    assert hi_numbers == {"3", "6"}, f"Expected hindi Thanjavur pravachan numbers {{3, 6}}, got {hi_numbers}"
    assert gu_numbers == {"15", "18"}, f"Expected gujarati Thanjavur pravachan numbers {{15, 18}}, got {gu_numbers}"
    assert hi_numbers.isdisjoint(gu_numbers), \
        f"Cross-language leakage: hindi and gujarati Thanjavur cascades share numbers {hi_numbers & gu_numbers}"


def test_partial_discovery_workflow_adds_new_pravachan(full_discovery_state):
    """
    Workflow: after the initial full discovery, a curator adds ONE new PDF (a
    brand-new named work, "Pune") under an existing directory tree. A partial
    (incremental) discovery run -- reusing the same IndexState, not a fresh
    setup() -- must pick it up and surface it via /api/metadata and
    /api/catalogue without disturbing anything already indexed.

    Reuses an already-OCR'd fixture PDF (same basename, so its pre-built OCR
    JSON already exists) copied into a brand-new directory, so no new PDF/OCR
    fixture needs to be generated -- the file's relative path (and therefore
    its doc_id) is what makes it "new" to Discovery.
    """
    config = Config()
    opensearch_client = get_opensearch_client(config)
    base_url = full_discovery_state["base_url"]

    baseline = requests.get(f"{base_url}/api/metadata", timeout=10).json()
    assert "Pune" not in baseline.get("Pravachan", {}).get("Name_hi", []), \
        "Pune should not exist before the partial discovery run"

    new_dir = f"{config.BASE_PDF_PATH}/hindi/cities/non_metro/pune"
    os.makedirs(new_dir, exist_ok=True)
    new_pdf_path = f"{new_dir}/indore_hindi.pdf"
    shutil.copy(f"{config.BASE_PDF_PATH}/hindi/cities/non_metro/indore_hindi.pdf", new_pdf_path)
    write_config_file(f"{new_dir}/config.json", {"Name": "Pune", "count": "5"})

    # Mirror what setup(copy_ocr_files=True) does for this basename's pre-built
    # OCR fixture, so process=False can index it without running real OCR.
    relpath_no_ext = os.path.splitext(os.path.relpath(new_pdf_path, config.BASE_PDF_PATH))[0]
    src_ocr = os.path.join(get_test_base_dir(), "data", "ocr", config.CHUNK_STRATEGY, "indore_hindi")
    dest_ocr = os.path.join(config.BASE_OCR_PATH, relpath_no_ext)
    shutil.copytree(src_ocr, dest_ocr)

    discovery = Discovery(
        config,
        IndexGenerator(config, opensearch_client),
        IndexState(config.SQLITE_DB_PATH),
    )
    discovery.crawl(process=False, index=True)
    rebuild_catalogue_index(config, opensearch_client)
    refresh_pravachan_series_metadata(config, opensearch_client)

    for idx in (config.OPENSEARCH_INDEX_NAME, config.OPENSEARCH_METADATA_INDEX_NAME,
                config.OPENSEARCH_CATALOGUE_INDEX_NAME):
        opensearch_client.indices.refresh(index=idx)

    assert requests.post(f"{base_url}/api/cache/invalidate", timeout=10).status_code == 200

    metadata = requests.get(f"{base_url}/api/metadata", timeout=10).json()
    name_hi = metadata["Pravachan"]["Name_hi"]
    assert "Pune" in name_hi, "Partial discovery should have surfaced the new Pune work"
    assert "Songadh" in name_hi, "Partial discovery must not disturb previously-indexed content"

    catalogue = requests.get(f"{base_url}/api/catalogue", timeout=10).json()
    rows_by_path = {row["relative_path"]: row for row in catalogue}
    assert "hindi/cities/non_metro/pune" in rows_by_path
    assert rows_by_path["hindi/cities/non_metro/pune"]["count"] == "5"
    assert "hindi/spiritual" in rows_by_path, "Previously-existing catalogue rows must survive a partial crawl"


def test_refresh_metadata_workflow_cleans_up_after_rename(full_discovery_state):
    """
    Workflow: renaming a curated work (folder-level "Bangalore" -> "Bengaluru")
    and re-crawling normally only *adds* the new Name -- update_metadata_index()
    is a per-document append-only upsert, so it has no way to know whether some
    OTHER still-indexed document also needs the old value, and never removes it.
    The stale old Name lingers in /api/metadata until an explicit
    --refresh-metadata (rebuild_full_metadata_index() + rebuild_catalogue_index()
    + refresh_pravachan_series_metadata(), the same trio scripts/discovery_cli.py
    runs) does a full rebuild from scratch instead.
    """
    config = Config()
    opensearch_client = get_opensearch_client(config)
    base_url = full_discovery_state["base_url"]

    write_config_file(f"{config.BASE_PDF_PATH}/hindi/cities/metro/config.json",
                      {"type": "metro", "Name": "Bengaluru", "count": "compiled"})
    write_config_file(f"{config.BASE_PDF_PATH}/gujarati/cities/metro/config.json",
                      {"type": "metro", "Name": "Bengaluru", "count": "compiled"})

    discovery = Discovery(
        config,
        IndexGenerator(config, opensearch_client),
        IndexState(config.SQLITE_DB_PATH),
    )
    discovery.crawl(process=False, index=True)
    opensearch_client.indices.refresh(index=config.OPENSEARCH_INDEX_NAME)
    opensearch_client.indices.refresh(index=config.OPENSEARCH_METADATA_INDEX_NAME)

    assert requests.post(f"{base_url}/api/cache/invalidate", timeout=10).status_code == 200
    name_hi = requests.get(f"{base_url}/api/metadata", timeout=10).json()["Pravachan"]["Name_hi"]
    assert "Bengaluru" in name_hi, "New name should appear after a normal re-crawl"
    assert "Bangalore" in name_hi, \
        "Documents the append-only limitation: a normal re-crawl doesn't remove the stale old name"

    # --refresh-metadata's real workflow: full rebuild, not per-document append.
    rebuild_full_metadata_index(config, opensearch_client)
    rebuild_catalogue_index(config, opensearch_client)
    refresh_pravachan_series_metadata(config, opensearch_client)
    opensearch_client.indices.refresh(index=config.OPENSEARCH_METADATA_INDEX_NAME)
    opensearch_client.indices.refresh(index=config.OPENSEARCH_CATALOGUE_INDEX_NAME)

    assert requests.post(f"{base_url}/api/cache/invalidate", timeout=10).status_code == 200
    name_hi = requests.get(f"{base_url}/api/metadata", timeout=10).json()["Pravachan"]["Name_hi"]
    assert "Bengaluru" in name_hi
    assert "Bangalore" not in name_hi, "A full --refresh-metadata rebuild must clear the stale name"

    rows_by_path = {row["relative_path"]: row
                    for row in requests.get(f"{base_url}/api/catalogue", timeout=10).json()}
    assert rows_by_path["hindi/cities/metro"]["granth"] == "Bengaluru"
    assert rows_by_path["gujarati/cities/metro"]["granth"] == "Bengaluru"


def validate(old_state, new_state, changed_keys,
             check_file_changed=False, check_config_changed=True, new_file_added=False):
    for doc_id, vals in new_state.items():
        if doc_id in changed_keys:
            if new_file_added:
                # For newly added files, they shouldn't exist in old_state
                assert doc_id not in old_state
                assert vals["ocr_checksum"] is not None
            else:
                # For existing files that changed
                assert vals["last_indexed_timestamp"] != old_state[doc_id]["last_indexed_timestamp"]
                assert check_config_changed == (vals["config_hash"] != old_state[doc_id]["config_hash"])
                assert vals["ocr_checksum"] == old_state[doc_id]["ocr_checksum"]
        else:
            # For unchanged files, they should exist in both states and be identical
            assert doc_id in old_state
            assert vals["last_indexed_timestamp"] == old_state[doc_id]["last_indexed_timestamp"]
            assert vals["config_hash"] == old_state[doc_id]["config_hash"]
            assert vals["ocr_checksum"] == old_state[doc_id]["ocr_checksum"]