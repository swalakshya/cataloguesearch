import datetime
import hashlib
import os
import shutil
import tempfile
import fitz
from opensearchpy import OpenSearch

from backend.crawler.discovery import SingleFileProcessor, Discovery
from backend.crawler.index_state import IndexState
from backend.crawler.index_generator import IndexGenerator
from backend.crawler.pdf_processor import PDFProcessor, log_handle
from tests.backend.base import *
from tests.backend.common import setup, write_config_file

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
    assert meta == {'language': 'hi', 'category': 'Pravachan', 'Anuyog': 'city', 'type': 'metro', 'file_url': ''}

    # Test bangalore_gujarati.pdf in gujarati/cities/metro/ - should get language, category, and type
    sfp = SingleFileProcessor(
        config, f"{pdf_dir}/gujarati/cities/metro/bangalore_gujarati.pdf",
        None, None,
        datetime.datetime.now().isoformat()
    )
    meta = sfp._get_metadata()
    assert meta == {'language': 'gu', 'category': 'Pravachan', 'Anuyog': 'city', 'type': 'metro', 'file_url': ''}

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
                    'Name': 'Songadh', 'series_start_date': '1975-01-01',
                    'series_end_date': '1977-12-31', 'file_url': ''}

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
    assert len(state1) == 12

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
    assert len(state4) == 11

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
    assert len(state5) == 12  # should be back to 12 files (11 + 1 new copy)


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
    assert len(state1) == 12

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

    # Final validation - should have all 10 files
    assert len(state3) == 12

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
    assert len(state1) == 12

    # Validate that ocr_checksum is present but config_hash should be empty (since no indexing was done)
    for doc_id, vals in state1.items():
        assert vals["ocr_checksum"] is not None  # OCR processing was done
        assert vals["config_hash"] == ""         # No indexing was done, so config_hash is empty

    # Now call crawl with both process=True and index=True
    discovery.crawl(process=True, index=True)

    state2 = index_state.load_state()
    log_handle.info(f"State after crawl(process=True, index=True): {json_dumps(state2)}")
    assert len(state2) == 12

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
    assert len(state0) == 12
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