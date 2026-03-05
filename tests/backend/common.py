import logging
import os
import shutil
import tempfile
import uuid

import fitz
from dotenv import load_dotenv

from backend.common import opensearch
from backend.common.opensearch import get_opensearch_client
from backend.config import Config
from backend.crawler.index_state import IndexState
from backend.utils import json_dump, json_dumps

log_handle = logging.getLogger(__name__)

def write_config_file(file_name, config_data):
    """
    Write the given config data to a JSON file.
    """
    with open(file_name, 'w') as f:
        json_dump(config_data, f)
    log_handle.info(f"Config file written: {file_name}")


def get_doc_id(base_dir, file_path):
    relative_path = os.path.relpath(file_path, base_dir)
    doc_id = str(
        uuid.uuid5(uuid.NAMESPACE_URL, relative_path))
    return doc_id

def setup(copy_ocr_files=False, add_scan_config=False, add_bookmarks=True):
    config = Config()
    base_dir = tempfile.mkdtemp(prefix="test_")
    pdf_dir = "%s/data/pdfs" % base_dir
    log_handle.info(f"Using base dir: {base_dir}, pdf dir: {pdf_dir}")
    config.settings()["crawler"]["base_pdf_path"] = pdf_dir
    config.settings()["crawler"]["base_text_path"] = "%s/data/texts" % base_dir
    config.settings()["crawler"]["base_ocr_path"] = "%s/data/ocr" % base_dir
    config.settings()["crawler"]["sqlite_db_path"] = "%s/crawl_state.db" % base_dir

    project_root = os.path.dirname(
        os.path.dirname(os.path.abspath(__file__))
    )
    load_dotenv(dotenv_path=f"{project_root}/.env")

    # Create directory structure for hindi and gujarati
    hindi_base = f"{pdf_dir}/hindi"
    gujarati_base = f"{pdf_dir}/gujarati"

    # Create base language directories
    os.makedirs(hindi_base, exist_ok=True)
    os.makedirs(gujarati_base, exist_ok=True)

    # Create subdirectories for each language
    for lang_base in [hindi_base, gujarati_base]:
        os.makedirs(f"{lang_base}/cities/metro", exist_ok=True)
        os.makedirs(f"{lang_base}/cities/non_metro", exist_ok=True)
        os.makedirs(f"{lang_base}/spiritual", exist_ok=True)
        os.makedirs(f"{lang_base}/history", exist_ok=True)

    TEST_BASE_DIR = os.getenv("TEST_BASE_DIR")

    # copy files - using all new test files
    data_pdf_path = os.path.join(TEST_BASE_DIR, "data", "pdfs")
    bangalore_hindi = os.path.join(data_pdf_path, "bangalore_hindi.pdf")
    bangalore_gujarati = os.path.join(data_pdf_path, "bangalore_gujarati.pdf")
    hampi_hindi = os.path.join(data_pdf_path, "hampi_hindi.pdf")
    hampi_gujarati = os.path.join(data_pdf_path, "hampi_gujarati.pdf")
    indore_hindi = os.path.join(data_pdf_path, "indore_hindi.pdf")
    indore_gujarati = os.path.join(data_pdf_path, "indore_gujarati.pdf")
    jaipur_hindi = os.path.join(data_pdf_path, "jaipur_hindi.pdf")
    jaipur_gujarati = os.path.join(data_pdf_path, "jaipur_gujarati.pdf")
    songadh_hindi = os.path.join(data_pdf_path, "songadh_hindi.pdf")
    songadh_gujarati = os.path.join(data_pdf_path, "songadh_gujarati.pdf")
    thanjavur_hindi = os.path.join(data_pdf_path, "thanjavur_hindi.pdf")
    thanjavur_gujarati = os.path.join(data_pdf_path, "thanjavur_gujarati.pdf")

    # Define file paths in new directory structure
    bangalore_hindi_path = f"{hindi_base}/cities/metro/bangalore_hindi.pdf"
    bangalore_gujarati_path = f"{gujarati_base}/cities/metro/bangalore_gujarati.pdf"
    hampi_hindi_path = f"{hindi_base}/history/hampi_hindi.pdf"
    hampi_gujarati_path = f"{gujarati_base}/history/hampi_gujarati.pdf"
    indore_hindi_path = f"{hindi_base}/cities/non_metro/indore_hindi.pdf"
    indore_gujarati_path = f"{gujarati_base}/cities/non_metro/indore_gujarati.pdf"
    jaipur_hindi_path = f"{hindi_base}/cities/non_metro/jaipur_hindi.pdf"
    jaipur_gujarati_path = f"{gujarati_base}/cities/non_metro/jaipur_gujarati.pdf"
    songadh_hindi_path = f"{hindi_base}/spiritual/songadh_hindi.pdf"
    songadh_gujarati_path = f"{gujarati_base}/spiritual/songadh_gujarati.pdf"
    thanjavur_hindi_path = f"{hindi_base}/history/thanjavur_hindi.pdf"
    thanjavur_gujarati_path = f"{gujarati_base}/history/thanjavur_gujarati.pdf"

    doc_ids = {
        "bangalore_hindi": [bangalore_hindi_path, get_doc_id(pdf_dir, bangalore_hindi_path)],
        "bangalore_gujarati": [bangalore_gujarati_path, get_doc_id(pdf_dir, bangalore_gujarati_path)],
        "hampi_hindi": [hampi_hindi_path, get_doc_id(pdf_dir, hampi_hindi_path)],
        "hampi_gujarati": [hampi_gujarati_path, get_doc_id(pdf_dir, hampi_gujarati_path)],
        "indore_hindi": [indore_hindi_path, get_doc_id(pdf_dir, indore_hindi_path)],
        "indore_gujarati": [indore_gujarati_path, get_doc_id(pdf_dir, indore_gujarati_path)],
        "jaipur_hindi": [jaipur_hindi_path, get_doc_id(pdf_dir, jaipur_hindi_path)],
        "jaipur_gujarati": [jaipur_gujarati_path, get_doc_id(pdf_dir, jaipur_gujarati_path)],
        "songadh_hindi": [songadh_hindi_path, get_doc_id(pdf_dir, songadh_hindi_path)],
        "songadh_gujarati": [songadh_gujarati_path, get_doc_id(pdf_dir, songadh_gujarati_path)],
        "thanjavur_hindi": [thanjavur_hindi_path, get_doc_id(pdf_dir, thanjavur_hindi_path)],
        "thanjavur_gujarati": [thanjavur_gujarati_path, get_doc_id(pdf_dir, thanjavur_gujarati_path)]
    }

    # Copy files to new directory structure
    shutil.copy(bangalore_hindi, bangalore_hindi_path)
    shutil.copy(bangalore_gujarati, bangalore_gujarati_path)
    shutil.copy(hampi_hindi, hampi_hindi_path)
    shutil.copy(hampi_gujarati, hampi_gujarati_path)
    shutil.copy(indore_hindi, indore_hindi_path)
    shutil.copy(indore_gujarati, indore_gujarati_path)
    shutil.copy(jaipur_hindi, jaipur_hindi_path)
    shutil.copy(jaipur_gujarati, jaipur_gujarati_path)
    shutil.copy(songadh_hindi, songadh_hindi_path)
    shutil.copy(songadh_gujarati, songadh_gujarati_path)
    shutil.copy(thanjavur_hindi, thanjavur_hindi_path)
    shutil.copy(thanjavur_gujarati, thanjavur_gujarati_path)

    # Create config files for language base directories
    hindi_config = {"language": "hi", "category": "Pravachan"}
    gujarati_config = {"language": "gu", "category": "Pravachan"}

    write_config_file(f"{hindi_base}/config.json", hindi_config)
    write_config_file(f"{gujarati_base}/config.json", gujarati_config)

    # Create config files for category directories
    cities_config = {"Anuyog": "city"}
    spiritual_config = {
        "Anuyog": "spiritual",
        "Granth": "Songadh",
        "series_start_date": "1975-01-01",
        "series_end_date": "1977-12-31"
    }
    history_config = {"Anuyog": "history"}
    metro_config = {"type": "metro"}
    non_metro_config = {"type": "non_metro"}

    # Write config files for all category and type directories
    for lang_base in [hindi_base, gujarati_base]:
        write_config_file(f"{lang_base}/cities/config.json", cities_config)
        write_config_file(f"{lang_base}/cities/metro/config.json", metro_config)
        write_config_file(f"{lang_base}/cities/non_metro/config.json", non_metro_config)
        write_config_file(f"{lang_base}/spiritual/config.json", spiritual_config)
        write_config_file(f"{lang_base}/history/config.json", history_config)

    # Per-file Granth configs for history documents
    write_config_file(f"{hindi_base}/history/hampi_hindi_config.json", {"Granth": "Hampi"})
    write_config_file(f"{gujarati_base}/history/hampi_gujarati_config.json", {"Granth": "Hampi"})
    write_config_file(f"{hindi_base}/history/thanjavur_hindi_config.json", {"Granth": "Thanjavur"})

    # Add file-specific config for thanjavur_gujarati with series dates and Granth name
    thanjavur_gujarati_file_config = {
        "Granth": "Thanjavur",
        "series_start_date": "1978-01-01",
        "series_end_date": "1983-12-31"
    }
    write_config_file(f"{gujarati_base}/history/thanjavur_gujarati_config.json", thanjavur_gujarati_file_config)

    if copy_ocr_files:
        # This is to simulate the text files that would be generated
        # by the PDF processor. This option is useful for speeding
        # up the tests by avoiding the need to process PDFs.
        for file_path, _ in doc_ids.values():
            log_handle.info(f"Processing file: {file_path}")
            relpath = os.path.relpath(file_path, pdf_dir) # a/b/c/bangalore_hindi.pdf
            relpath = os.path.splitext(relpath)[0] # a/b/c/bangalore_hindi
            log_handle.info(f"Relative path: {relpath}")

            src_folder = os.path.join(
                TEST_BASE_DIR, "data", "ocr", config.CHUNK_STRATEGY,
                os.path.basename(relpath))
            dest_folder = os.path.join(
                config.BASE_OCR_PATH,
                relpath
            )
            log_handle.info(f"Copying text ocr from {src_folder} to {dest_folder}")
            shutil.copytree(src_folder, dest_folder)

    if add_scan_config:
        # Create scan_config.json files for each directory containing PDF files
        # Group PDFs by their directories
        pdf_directories = {}

        for file_path, _ in doc_ids.values():
            directory = os.path.dirname(file_path)
            filename = os.path.basename(file_path)
            filename_without_ext = os.path.splitext(filename)[0]

            if directory not in pdf_directories:
                pdf_directories[directory] = []
            pdf_directories[directory].append((file_path, filename_without_ext))

        # Create scan_config for each directory
        for directory, pdf_files in pdf_directories.items():
            scan_config = {}

            for pdf_path, filename_without_ext in pdf_files:
                try:
                    # Open PDF and get page count
                    doc = fitz.open(pdf_path)
                    total_pages = doc.page_count
                    doc.close()

                    # Add to scan_config
                    scan_config[filename_without_ext] = {
                        "start_page": 1,
                        "end_page": total_pages,
                        "header_regex": [
                            "^.{0,20}इतिहास एवं लेख$",
                            "^.{0,15}पर.{0,5}निबंध$",
                            "^निबंध.{0,15}$",
                            "^નિબંધ.{0,15}$",
                            "^.{0,15}ઉપર.{0,15}નિબંધ$",
                            "^.{0,20}ઇતિહાસ.{0,8}લેખ$"
                        ],
                        "crop": {
                            "top": 8,
                            "bottom": 8
                        }
                    }
                    log_handle.info(f"Added {filename_without_ext} to scan_config: pages 1-{total_pages}")

                except Exception as e:
                    log_handle.error(f"Error processing PDF {pdf_path}: {e}")
                    continue

            # Write scan_config.json to the directory
            if scan_config:
                config_path = os.path.join(directory, "scan_config.json")
                write_config_file(config_path, scan_config)
                log_handle.info(f"Created scan_config.json for {directory}")

    if add_bookmarks:
        # add a few bookmarks in gujarati and hindi files
        add_bookmarks_to_pdf(
            doc_ids["hampi_hindi"][0],
            [(2, "prav number 248, 1985-10-23"), (4, "Prav 324. Date 24-05-1986")]
        )
        add_bookmarks_to_pdf(
            doc_ids["jaipur_hindi"][0],
            [(1, "Pravachan Num 10 on Date 03-05-1986"), (5, "Pravachan Num 12 on Date 04-06-1987")]
        )

        add_bookmarks_to_pdf(
            doc_ids["indore_gujarati"][0],
            [(2, "pr number 28, 1982-10-23"), (4, "Prav 324. Date 24-05-1982")]
        )
        add_bookmarks_to_pdf(
            doc_ids["thanjavur_gujarati"][0],
            [(2, "Pravachan Num 15 on Date 06-05-1980"), (3, "Pravachan Num 18 on Date 04-06-1983")]
        )

    return doc_ids

def get_all_documents(max_results: int = 1000) -> list:
    """
    Retrieves all documents from the configured OpenSearch index.

    Args:
        max_results: The maximum number of documents to return. Be aware that
                     very large numbers can impact performance. For retrieving
                     all documents from a large index, consider implementing
                     the OpenSearch Scroll API.

    Returns:
        A list of the documents found in the index. Each document is a dictionary.
        Returns an empty list if an error occurs.
    """
    try:
        # Initialize the OpenSearch client and get the index name from the config
        config = Config()
        opensearch_client = get_opensearch_client(config)
        index_name = config.OPENSEARCH_INDEX_NAME

        # Define the search query to match all documents
        search_body = {
            "size": max_results,
            "query": {
                "match_all": {}
            }
        }

        # Execute the search query
        response = opensearch_client.search(
            index=index_name,
            body=search_body
        )

        # The search results are in the 'hits' field of the response
        return response['hits']['hits']

    except Exception as e:
        print(f"An error occurred while querying OpenSearch: {e}")
        return []

def are_dicts_same(dict1: dict[str, list[str]], dict2: dict[str, list[str]]) -> bool:
    """
    Compares two dictionaries of the format {str: list[str]} to ensure they are the same,
    regardless of key order or element order within the lists.

    Args:
        dict1: The first dictionary.
        dict2: The second dictionary.

    Returns:
        True if the dictionaries are considered the same, False otherwise.
    """

    # 1. Check if the sets of keys are identical
    if set(dict1.keys()) != set(dict2.keys()):
        return False

    # 2. Iterate through keys and compare their corresponding lists
    for key in dict1:
        list1 = dict1[key]
        list2 = dict2[key]

        # Check if the lengths of the lists are the same
        if len(list1) != len(list2):
            return False

        # Convert lists to sets for order-independent comparison of elements
        if set(list1) != set(list2):
            return False

    return True


def add_bookmarks_to_pdf(file_name, bookmarks_list):
    """
    Add bookmarks to a PDF file.

    Args:
        file_name: Path to the PDF file
        bookmarks_list: List of tuples [(page_num, bookmark_str)] where page_num starts with 1
    """
    doc = fitz.open(file_name)

    toc = []
    for page_num, bookmark_str in bookmarks_list:
        toc.append([1, bookmark_str, page_num])

    doc.set_toc(toc)

    temp_file = f"{file_name}.tmp"
    doc.save(temp_file, encryption=fitz.PDF_ENCRYPT_NONE)
    doc.close()

    os.replace(temp_file, file_name)
