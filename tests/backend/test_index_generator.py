import os
import shutil
import tempfile
import traceback

import pytest

from backend.crawler.index_generator import IndexGenerator
from backend.common.embedding_models import get_embedding_model_factory
from backend.common.opensearch import get_opensearch_client
from backend.common.opensearch import create_indices_if_not_exists
from tests.backend.base import *

log_handle = logging.getLogger(__name__)

@pytest.fixture(scope="module")
def setup():
    config = Config()
    temp_dir = tempfile.mkdtemp("indexing_module_test")
    # copy ocr files to this directory
    base_test_dir = get_test_base_dir()
    ocr_source_dir = os.path.join(base_test_dir, "data", "ocr", config.CHUNK_STRATEGY)
    ocr_dest_dir = os.path.join(temp_dir, "ocr")

    shutil.copytree(ocr_source_dir, ocr_dest_dir)

    config.settings()["crawler"]["base_ocr_path"] = ocr_dest_dir
    return temp_dir

@pytest.fixture(scope="module")
def indexing_module():
    """
    Provides an initialized IndexingEmbeddingModule instance for testing.
    Module-scoped so it's created once per test module.
    """
    config = Config()
    opensearch_client = get_opensearch_client(config)
    try:
        if opensearch_client.indices.exists(config.OPENSEARCH_INDEX_NAME):
            response = opensearch_client.indices.delete(index=config.OPENSEARCH_INDEX_NAME)
            log_handle.info(f"Deleted index '{config.OPENSEARCH_INDEX_NAME}' before recreating: {response}")
        else:
            log_handle.warning(f"Index '{config.OPENSEARCH_INDEX_NAME}' does not exist, skipping deletion.")
    except Exception as e:
        traceback.print_exc()
        log_handle.error(f"Error deleting index '{config.OPENSEARCH_INDEX_NAME}': {e}")

    module = IndexGenerator(config, opensearch_client)
    create_indices_if_not_exists(config, opensearch_client)
    return module

@pytest.fixture(scope="module")
def indexed_documents(setup, indexing_module):
    """
    Module-scoped fixture that indexes documents once with bookmark data.
    All tests in this module can reuse the indexed data.

    Returns:
        List of document configs used for indexing
    """
    config = Config()
    opensearch_client = get_opensearch_client(config)
    temp_dir = setup

    scan_config = {
        "header_regex": [
            "^.{0,20}इतिहास एवं लेख$",
            "^.{0,15}पर.{0,5}निबंध$",
            "^निबंध.{0,15}$",
            "^નિબંધ.{0,15}$",
            "^.{0,15}ઉપર.{0,15}નિબંધ$",
            "^.{0,20}ઇતિહાસ.{0,8}લેખ$",
            "^[0-9]{0,4}$"
        ],
        "crop": {
            "top": 8,
            "bottom": 8,
            "left": 1,
            "right": 1
        }
    }

    # Document configurations for testing - using documents WITH bookmarks
    document_configs = [
        {
            'doc_name': 'hampi_hindi',
            'doc_id': 'hampi_hindi_doc_id',
            'filename': 'hampi_hindi.pdf',
            'language': 'hi',
            'metadata': {'language': 'hi'},
            'para_count_advanced': 19,
            'para_count_paragraph': 20
        },
        {
            'doc_name': 'jaipur_hindi',
            'doc_id': 'jaipur_hindi_doc_id',
            'filename': 'jaipur_hindi.pdf',
            'language': 'hi',
            'metadata': {'language': 'hi'},
            'para_count_advanced': 18,
            'para_count_paragraph': 20
        },
        {
            'doc_name': 'indore_gujarati',
            'doc_id': 'indore_gujarati_doc_id',
            'filename': 'indore_gujarati.pdf',
            'language': 'gu',
            'metadata': {'language': 'gu'},
            'para_count_advanced': 17,
            'para_count_paragraph': 20
        },
        {
            'doc_name': 'thanjavur_gujarati',
            'doc_id': 'thanjavur_gujarati_doc_id',
            'filename': 'thanjavur_gujarati.pdf',
            'language': 'gu',
            'metadata': {'language': 'gu'},
            'para_count_advanced': 17,
            'para_count_paragraph': 20
        }
    ]

    log_handle.info("=== INDEXED_DOCUMENTS FIXTURE: SETUP PHASE ===")

    # Setup document paths and expected counts
    for doc_config in document_configs:
        doc_name = doc_config['doc_name']

        # Setup paths
        ocr_dir, pages_list = setup_document_paths(temp_dir, doc_name)
        output_dir = os.path.join(temp_dir, "text", doc_name)
        os.makedirs(output_dir, exist_ok=True)

        # Calculate expected count
        para_count_key = "para_count_%s" % config.CHUNK_STRATEGY
        expected_count = doc_config[para_count_key]

        # Add to config
        doc_config.update({
            'ocr_dir': ocr_dir,
            'pages_list': pages_list,
            'output_dir': output_dir,
            'expected_count': expected_count
        })

        log_handle.info(f"{doc_name}: {len(pages_list)} pages, expected {expected_count} paragraphs")

    log_handle.info("=== INDEXED_DOCUMENTS FIXTURE: INDEXING WITH BOOKMARK DATA ===")

    # Index all documents with bookmark data
    for i, doc_config in enumerate(document_configs):
        doc_name = doc_config['doc_name']
        log_handle.info(f"Indexing document {i+1}/{len(document_configs)}: {doc_name}")

        # Get bookmark data for this document
        page_to_pravachan_data = get_page_to_pravachan_data(doc_name)

        indexing_module.index_document(
            doc_config['doc_id'], doc_config['filename'], doc_config['ocr_dir'],
            doc_config['output_dir'], doc_config['pages_list'], doc_config['metadata'],
            scan_config, page_to_pravachan_data, reindex_metadata_only=False, dry_run=False)

    # Refresh index
    opensearch_client.indices.refresh(index=indexing_module._index_name)

    total_docs = len(get_documents(config, "match_all"))
    log_handle.info(f"=== INDEXED_DOCUMENTS FIXTURE: COMPLETE ({total_docs} documents indexed) ===")

    return document_configs

# Helper functions for test_index_generator
def setup_document_paths(temp_dir, doc_name):
    """Set up OCR directory paths and get pages list for a document."""
    ocr_base_dir = os.path.join(temp_dir, "ocr")
    ocr_dir = os.path.join(ocr_base_dir, doc_name)
    pages_list = get_pages_list(ocr_dir)
    return ocr_dir, pages_list

def get_pages_list(ocr_dir):
    """Get sorted list of page numbers from OCR directory."""
    pages = []
    config = Config()
    extn = ".txt" if config.CHUNK_STRATEGY == "paragraph" else ".json"
    if os.path.exists(ocr_dir):
        for file in os.listdir(ocr_dir):
            if file.startswith("page_") and file.endswith(extn):
                page_num = int(file.replace("page_", "").replace(extn, ""))
                pages.append(page_num)
    return sorted(pages)

def count_paragraphs_in_output_dir(output_dir):
    """Count total paragraphs written to output text directory."""
    total_paragraphs = 0
    for file in os.listdir(output_dir):
        if file.endswith('.txt'):
            file_path = os.path.join(output_dir, file)
            with open(file_path, 'r', encoding='utf-8') as f:
                content = f.read().strip()
                if content:
                    paragraphs = content.split("\n----\n")
                    total_paragraphs += len(paragraphs)
    return total_paragraphs

def get_page_to_pravachan_data(doc_name):
    """
    Returns hardcoded page_to_pravachan_data for test documents.
    Based on bookmarks added in common.py lines 219-238.

    Bookmark behavior: A bookmark applies from that page onwards until the next bookmark.
    """
    bookmarks_data = {
        'hampi_hindi': {
            # Bookmark at page 2: "prav number 248, 1985-10-23"
            2: {'pravachan_no': '248', 'date': '23-10-1985'},
            3: {'pravachan_no': '248', 'date': '23-10-1985'},
            # Bookmark at page 4: "Prav 324. Date 24-05-1986"
            4: {'pravachan_no': '324', 'date': '24-05-1986'},
            5: {'pravachan_no': '324', 'date': '24-05-1986'},
            # Note: page 6 has no content, not included
        },
        'jaipur_hindi': {
            # Bookmark at page 1: "Pravachan Num 10 on Date 03-05-1986"
            1: {'pravachan_no': '10', 'date': '03-05-1986'},
            2: {'pravachan_no': '10', 'date': '03-05-1986'},
            3: {'pravachan_no': '10', 'date': '03-05-1986'},
            4: {'pravachan_no': '10', 'date': '03-05-1986'},
            # Bookmark at page 5: "Pravachan Num 12 on Date 04-06-1987"
            5: {'pravachan_no': '12', 'date': '04-06-1987'},
            6: {'pravachan_no': '12', 'date': '04-06-1987'},
        },
        'indore_gujarati': {
            # Bookmark at page 2: "pr number 28, 1982-10-23"
            2: {'pravachan_no': '28', 'date': '23-10-1982'},
            3: {'pravachan_no': '28', 'date': '23-10-1982'},
            # Bookmark at page 4: "Prav 324. Date 24-05-1982"
            4: {'pravachan_no': '324', 'date': '24-05-1982'},
            5: {'pravachan_no': '324', 'date': '24-05-1982'},
            6: {'pravachan_no': '324', 'date': '24-05-1982'},
            # Note: page 7 has no content, not included
        },
        'thanjavur_gujarati': {
            # Bookmark at page 2: "Pravachan Num 15 on Date 06-05-1980"
            2: {'pravachan_no': '15', 'date': '06-05-1980'},
            # Bookmark at page 3: "Pravachan Num 18 on Date 04-06-1983"
            3: {'pravachan_no': '18', 'date': '04-06-1983'},
            4: {'pravachan_no': '18', 'date': '04-06-1983'},
            5: {'pravachan_no': '18', 'date': '04-06-1983'},
        },
        # Documents without bookmarks
        'bangalore_hindi': {},
        'bangalore_gujarati': {},
        'songadh_gujarati': {},
    }
    return bookmarks_data.get(doc_name, {})

def validate_dry_run_phase(config, temp_dir, doc_configs, indexing_module, opensearch_client):
    """Validate dry run phase: no documents indexed, but paragraphs generated."""
    log_handle.info("=== DRY RUN VALIDATION ===")

    # Refresh and verify no documents indexed
    opensearch_client.indices.refresh(index=indexing_module._index_name)
    all_docs_after_dry_run = get_documents(config, "match_all")
    log_handle.info(f"Documents after dry run: {len(all_docs_after_dry_run)}")
    assert len(all_docs_after_dry_run) == 0, "No documents should be indexed to OpenSearch during dry run"

    # Validate paragraph generation for each document
    for doc_config in doc_configs:
        output_dir = doc_config['output_dir']
        expected_count = doc_config['expected_count']
        doc_name = doc_config['doc_name']

        assert os.path.exists(output_dir), f"{doc_name} output directory should exist"

        text_files = [f for f in os.listdir(output_dir) if f.endswith('.txt')]
        log_handle.info(f"{doc_name} text files generated: {len(text_files)}")

        actual_paragraphs = count_paragraphs_in_output_dir(output_dir)
        log_handle.info(f"{doc_name} paragraphs in output files: {actual_paragraphs}")

        assert actual_paragraphs == expected_count, \
            f"{doc_name} paragraphs in files should match expected count: expected {expected_count}, got {actual_paragraphs}"

def validate_document_counts(config, doc_configs):
    """Validate that document counts match expected paragraph counts."""
    log_handle.info("=== DOCUMENT COUNT VALIDATION ===")

    # Get language-specific documents
    hindi_docs = get_documents(config, "field_exists", "text_content_hindi")
    gujarati_docs = get_documents(config, "field_exists", "text_content_gujarati")

    # Filter and validate each document set
    for doc_config in doc_configs:
        doc_id = doc_config['doc_id']
        expected_count = doc_config['expected_count']
        filename = doc_config['filename']
        language = doc_config['language']
        doc_name = doc_config['doc_name']

        if language == 'hi':
            docs = [doc for doc in hindi_docs if doc['_source']['document_id'] == doc_id]
        else:  # gujarati
            docs = [doc for doc in gujarati_docs if doc['_source']['document_id'] == doc_id]

        actual_count = len(docs)
        log_handle.info(f"Actual {doc_name} document count: {actual_count}")

        # Validate document properties
        for doc in docs:
            source = doc['_source']
            assert source['document_id'] == doc_id
            assert source['original_filename'] == filename
            assert source['metadata']['language'] == language

            if language == 'hi':
                assert 'text_content_hindi' in source
                assert source['text_content_hindi'].strip() != ""
                assert 'text_content_gujarati' not in source or source['text_content_gujarati'] == ''
            else:
                assert 'text_content_gujarati' in source
                assert source['text_content_gujarati'].strip() != ""
                assert 'text_content_hindi' not in source or source['text_content_hindi'] == ''

        # Validate counts match
        assert actual_count == expected_count, \
            f"{doc_name} document count mismatch: expected {expected_count}, got {actual_count}"

    return hindi_docs, gujarati_docs

def validate_vector_embeddings(config):
    """Validate that all documents have properly sized vector embeddings."""
    log_handle.info("=== VECTOR EMBEDDING VALIDATION ===")

    expected_embedding_dim = get_embedding_model_factory(config).get_embedding_dimension()
    all_indexed_docs = get_documents(config, "match_all")

    log_handle.info(f"Expected embedding dimension: {expected_embedding_dim}")
    log_handle.info(f"Validating vector embeddings for all {len(all_indexed_docs)} documents")

    for doc in all_indexed_docs:
        source = doc['_source']
        doc_id_for_logging = source.get('document_id', 'unknown')

        # Validate vector embedding exists and has correct properties
        assert 'vector_embedding' in source, f"Missing vector_embedding in document {doc['_id']} (doc_id: {doc_id_for_logging})"
        assert isinstance(source['vector_embedding'], list), f"vector_embedding should be a list in document {doc['_id']} (doc_id: {doc_id_for_logging})"
        assert len(source['vector_embedding']) == expected_embedding_dim, \
            f"vector_embedding dimension mismatch in document {doc['_id']} (doc_id: {doc_id_for_logging}): expected {expected_embedding_dim}, got {len(source['vector_embedding'])}"
        assert all(isinstance(x, (int, float)) for x in source['vector_embedding']), \
            f"vector_embedding should contain only numbers in document {doc['_id']} (doc_id: {doc_id_for_logging})"

    log_handle.info(f"✅ Vector embedding validation passed for all {len(all_indexed_docs)} documents!")

def get_documents(config, query_type="match_all", field=None, max_results: int = 1000) -> list:
    """
    Retrieves documents from the configured OpenSearch index based on query type.

    Args:
        config: The application configuration object, which contains OpenSearch settings.
        query_type: Type of query - "match_all", "field_exists", or "count_only"
        field: Field name for field_exists queries (required when query_type="field_exists")
        max_results: The maximum number of documents to return.

    Returns:
        A list of the documents found in the index for regular queries, or count for "count_only".
        Returns an empty list or 0 if an error occurs.
    """
    try:
        # Initialize the OpenSearch client and get the index name from the config
        opensearch_client = get_opensearch_client(config)
        index_name = config.OPENSEARCH_INDEX_NAME

        # Build query based on type
        if query_type == "match_all":
            query = {"match_all": {}}
        elif query_type == "field_exists":
            if not field:
                raise ValueError("field parameter required for field_exists query")
            query = {"exists": {"field": field}}
        else:
            raise ValueError(f"Unsupported query_type: {query_type}")

        # Define the search body
        search_body = {
            "size": max_results,
            "query": query
        }

        # Execute the search query
        response = opensearch_client.search(
            index=index_name,
            body=search_body
        )

        # Return results based on query type
        if query_type == "count_only":
            return response['hits']['total']['value']
        else:
            return response['hits']['hits']

    except Exception as e:
        print(f"An error occurred while querying OpenSearch: {e}")
        return [] if query_type != "count_only" else 0

# Keep the old function for backward compatibility
def get_all_documents(config, max_results: int = 1000) -> list:
    """Legacy function - use get_documents() instead."""
    return get_documents(config, "match_all", max_results=max_results)

def query_by_pravachan_number(config, pravachan_num: str, max_results: int = 1000) -> list:
    """
    Query documents by pravachan_number field.

    Args:
        config: Configuration object
        pravachan_num: The pravachan number to search for (e.g., "248")
        max_results: Maximum number of results to return

    Returns:
        List of matching documents
    """
    try:
        opensearch_client = get_opensearch_client(config)
        index_name = config.OPENSEARCH_INDEX_NAME

        search_body = {
            "size": max_results,
            "query": {
                "term": {
                    "pravachan_number": pravachan_num
                }
            }
        }

        response = opensearch_client.search(
            index=index_name,
            body=search_body
        )

        return response['hits']['hits']

    except Exception as e:
        log_handle.error(f"Error querying by pravachan_number '{pravachan_num}': {e}")
        return []

def query_by_date_range(config, start_date: str, end_date: str, max_results: int = 1000) -> list:
    """
    Query documents by date range.

    Args:
        config: Configuration object
        start_date: Start date in YYYY-MM-DD format (e.g., "1985-01-01")
        end_date: End date in YYYY-MM-DD format (e.g., "1985-12-31")
        max_results: Maximum number of results to return

    Returns:
        List of matching documents
    """
    try:
        opensearch_client = get_opensearch_client(config)
        index_name = config.OPENSEARCH_INDEX_NAME

        search_body = {
            "size": max_results,
            "query": {
                "range": {
                    "date": {
                        "gte": start_date,
                        "lte": end_date
                    }
                }
            }
        }

        response = opensearch_client.search(
            index=index_name,
            body=search_body
        )

        return response['hits']['hits']

    except Exception as e:
        log_handle.error(f"Error querying by date range '{start_date}' to '{end_date}': {e}")
        return []

def test_create_index_if_not_exists(indexing_module):
    """
    Tests that the index is created correctly with the specified mappings and settings.
    """
    config = Config()
    opensearch_client = get_opensearch_client(config)
    index_name = indexing_module._index_name
    assert opensearch_client.indices.exists(index_name)

    # Verify some settings and mappings
    index_info = opensearch_client.indices.get(index_name)
    assert index_info[index_name]['settings']['index']['knn'] == 'true'

    mappings = index_info[index_name]['mappings']['properties']
    assert 'document_id' in mappings and mappings['document_id']['type'] == 'keyword'
    assert 'vector_embedding' in mappings and mappings['vector_embedding']['type'] == 'knn_vector'
    assert mappings['vector_embedding']['dimension'] == \
           get_embedding_model_factory(config).get_embedding_dimension()
    assert 'text_content_hindi' in mappings and mappings['text_content_hindi']['analyzer'] == 'hindi_analyzer'
    assert 'text_content_gujarati' in mappings and mappings['text_content_gujarati']['analyzer'] == 'gujarati_analyzer'

def test_generate_embedding_empty_text(indexing_module):
    """
    Tests embedding generation for empty text.
    """
    config = Config()
    embedding_model = get_embedding_model_factory(config)
    embedding = embedding_model.get_embedding("")
    assert len(embedding) == embedding_model.get_embedding_dimension()

def test_dry_run_behavior(setup, indexing_module):
    """
    Tests that dry run mode generates paragraphs but does NOT index to OpenSearch.
    """
    config = Config()
    opensearch_client = get_opensearch_client(config)
    temp_dir = setup

    scan_config = {
        "header_regex": [
            "^.{0,20}इतिहास एवं लेख$",
            "^.{0,15}पर.{0,5}निबंध$",
            "^निबंध.{0,15}$",
            "^નિબંધ.{0,15}$",
            "^.{0,15}ઉપર.{0,15}નિબંધ$",
            "^.{0,20}ઇતિહાસ.{0,8}લેખ$",
            "^[0-9]{0,4}$"
        ],
        "crop": {
            "top": 8,
            "bottom": 8,
            "left": 1,
            "right": 1
        }
    }

    # Test with a single document
    document_configs = [
        {
            'doc_name': 'bangalore_hindi',
            'doc_id': 'bangalore_hindi_doc_id',
            'filename': 'bangalore_hindi.pdf',
            'language': 'hi',
            'metadata': {'language': 'hi'},
            'para_count_advanced': 25,
            'para_count_paragraph': 20
        }
    ]

    log_handle.info("=== DRY RUN TEST: SETUP ===")

    # Setup document paths
    for doc_config in document_configs:
        doc_name = doc_config['doc_name']
        ocr_dir, pages_list = setup_document_paths(temp_dir, doc_name)
        output_dir = os.path.join(temp_dir, "text_dry_run", doc_name)
        os.makedirs(output_dir, exist_ok=True)

        para_count_key = "para_count_%s" % config.CHUNK_STRATEGY
        expected_count = doc_config[para_count_key]

        doc_config.update({
            'ocr_dir': ocr_dir,
            'pages_list': pages_list,
            'output_dir': output_dir,
            'expected_count': expected_count
        })

    log_handle.info("=== DRY RUN TEST: INDEXING WITH DRY_RUN=TRUE ===")

    # Run dry run indexing
    for doc_config in document_configs:
        indexing_module.index_document(
            doc_config['doc_id'], doc_config['filename'], doc_config['ocr_dir'],
            doc_config['output_dir'], doc_config['pages_list'], doc_config['metadata'],
            scan_config, {}, reindex_metadata_only=False, dry_run=True)

    # Validate dry run behavior
    validate_dry_run_phase(config, temp_dir, document_configs, indexing_module, opensearch_client)

    log_handle.info("✅ Dry run test completed successfully!")

def validate_query_by_pravachan_number(config, pravachan_num, expected_filename, expected_pages, expected_date):
    """
    Validates querying documents by pravachan_number field.

    Args:
        config: Configuration object
        pravachan_num: Pravachan number to query
        expected_filename: Expected PDF filename (e.g., 'hampi_hindi.pdf')
        expected_pages: List of expected page numbers (e.g., [2, 3])
        expected_date: Expected date in YYYY-MM-DD format (e.g., '1985-10-23')
    """
    log_handle.info(f"=== VALIDATE QUERY BY PRAVACHAN NUMBER '{pravachan_num}' ===")

    results = query_by_pravachan_number(config, pravachan_num)
    log_handle.info(f"Query for pravachan_number='{pravachan_num}' returned {len(results)} documents")

    assert len(results) > 0, f"Expected results for pravachan_number '{pravachan_num}', got 0"

    # Validate all results have correct pravachan_number
    for doc in results:
        source = doc['_source']
        assert 'pravachan_number' in source, f"Missing pravachan_number in document {doc['_id']}"
        assert source['pravachan_number'] == pravachan_num, \
            f"Expected pravachan_number '{pravachan_num}', got '{source['pravachan_number']}' in document {doc['_id']}"

        # Validate date field
        assert 'date' in source, f"Missing date field in document {doc['_id']}"
        assert source['date'] == expected_date, \
            f"Expected date '{expected_date}' for pravachan_number '{pravachan_num}', got '{source['date']}'"

        # Validate filename
        assert source['original_filename'] == expected_filename, \
            f"Expected {expected_filename}, got {source['original_filename']}"

        # Validate page number
        page_num = source.get('page_number')
        assert page_num in expected_pages, \
            f"Expected page_number in {expected_pages} for pravachan '{pravachan_num}', got {page_num}"

        log_handle.info(
            f"✓ Document {doc['_id']}: pravachan={source['pravachan_number']}, "
            f"date={source['date']}, page={page_num}, file={source['original_filename']}"
        )

    log_handle.info(f"✅ Pravachan number query validation passed for '{pravachan_num}': {len(results)} documents")

def validate_query_pravachan_not_found(config, pravachan_num):
    """
    Validates that querying for a non-existent pravachan number returns no results.

    Args:
        config: Configuration object
        pravachan_num: Pravachan number that doesn't exist
    """
    log_handle.info(f"=== VALIDATE QUERY FOR NON-EXISTENT PRAVACHAN '{pravachan_num}' ===")

    results = query_by_pravachan_number(config, pravachan_num)
    log_handle.info(f"Query for non-existent pravachan_number='{pravachan_num}' returned {len(results)} documents")

    assert len(results) == 0, \
        f"Expected 0 results for non-existent pravachan_number '{pravachan_num}', got {len(results)}"

    log_handle.info(f"✅ Negative test passed: pravachan_number '{pravachan_num}' correctly returns 0 results")

def test_index_generator(indexed_documents):
    """
    Tests that documents are indexed correctly with proper counts and embeddings.
    Uses the indexed_documents fixture which indexes documents once per module.
    """
    config = Config()
    doc_configs = indexed_documents

    log_handle.info("=== VALIDATION PHASE ===")

    # Validate document counts and properties
    hindi_docs, gujarati_docs = validate_document_counts(config, doc_configs)

    # Validate total counts match expectations
    total_expected_hindi = sum(d['expected_count'] for d in doc_configs if d['language'] == 'hi')
    total_expected_gujarati = sum(d['expected_count'] for d in doc_configs if d['language'] == 'gu')

    assert len(hindi_docs) == total_expected_hindi, \
        f"Total Hindi count mismatch: expected {total_expected_hindi}, got {len(hindi_docs)}"
    assert len(gujarati_docs) == total_expected_gujarati, \
        f"Total Gujarati count mismatch: expected {total_expected_gujarati}, got {len(gujarati_docs)}"

    log_handle.info(f"✅ Total validation passed - Hindi: {len(hindi_docs)}, Gujarati: {len(gujarati_docs)}")

    # Validate vector embeddings for all documents
    validate_vector_embeddings(config)

    log_handle.info("✅ All validations passed!")

def validate_query_by_date_range(config, start_date, end_date, expected_files_pages):
    """
    Validates querying documents by date range.

    Args:
        config: Configuration object
        start_date: Start date in YYYY-MM-DD format
        end_date: End date in YYYY-MM-DD format
        expected_files_pages: Dict mapping filename -> list of expected page numbers
                             e.g., {'hampi_hindi.pdf': [2, 3]}
    """
    log_handle.info(f"=== VALIDATE QUERY BY DATE RANGE '{start_date}' to '{end_date}' ===")

    results = query_by_date_range(config, start_date, end_date)
    log_handle.info(f"Query for date range '{start_date}' to '{end_date}' returned {len(results)} documents")

    assert len(results) > 0, f"Expected results for date range '{start_date}' to '{end_date}', got 0"

    # Group results by filename
    results_by_file = {}
    for doc in results:
        source = doc['_source']
        filename = source['original_filename']
        page_num = source['page_number']

        if filename not in results_by_file:
            results_by_file[filename] = []
        results_by_file[filename].append(page_num)

        # Validate date is within range
        doc_date = source.get('date')
        assert doc_date, f"Missing date in document {doc['_id']}"
        assert start_date <= doc_date <= end_date, \
            f"Date '{doc_date}' is outside range '{start_date}' to '{end_date}' in document {doc['_id']}"

        log_handle.info(
            f"✓ Document {doc['_id']}: file={filename}, page={page_num}, date={doc_date}"
        )

    # Validate expected files and pages
    for expected_file, expected_pages in expected_files_pages.items():
        assert expected_file in results_by_file, \
            f"Expected file '{expected_file}' not found in results. Found: {list(results_by_file.keys())}"

        actual_pages = set(results_by_file[expected_file])
        expected_pages_set = set(expected_pages)
        assert actual_pages == expected_pages_set, \
            f"Page mismatch for '{expected_file}': expected {expected_pages_set}, got {actual_pages}"

    log_handle.info(f"✅ Date range query validation passed: {len(results)} documents across {len(results_by_file)} files")

def validate_query_date_not_found(config, start_date, end_date):
    """
    Validates that querying for a date range with no data returns no results.

    Args:
        config: Configuration object
        start_date: Start date in YYYY-MM-DD format
        end_date: End date in YYYY-MM-DD format
    """
    log_handle.info(f"=== VALIDATE QUERY FOR EMPTY DATE RANGE '{start_date}' to '{end_date}' ===")

    results = query_by_date_range(config, start_date, end_date)
    log_handle.info(f"Query for date range '{start_date}' to '{end_date}' returned {len(results)} documents")

    assert len(results) == 0, \
        f"Expected 0 results for date range '{start_date}' to '{end_date}', got {len(results)}"

    log_handle.info(f"✅ Negative test passed: date range '{start_date}' to '{end_date}' correctly returns 0 results")

def test_pravachan_query_single_number(indexed_documents):
    """
    Tests querying by pravachan numbers - positive and negative test cases.
    """
    config = Config()

    # Test Case 1: Pravachan "248" (hampi_hindi pages 2-3)
    validate_query_by_pravachan_number(
        config,
        pravachan_num="248",
        expected_filename="hampi_hindi.pdf",
        expected_pages=[2, 3],
        expected_date="1985-10-23"
    )

    # Test Case 2: Pravachan "10" (jaipur_hindi pages 1-4)
    validate_query_by_pravachan_number(
        config,
        pravachan_num="10",
        expected_filename="jaipur_hindi.pdf",
        expected_pages=[1, 2, 3, 4],
        expected_date="1986-05-03"
    )

    # Test Case 3: Negative test - pravachan "999" doesn't exist
    validate_query_pravachan_not_found(config, pravachan_num="999")

def test_date_range_queries(indexed_documents):
    """
    Tests querying by date ranges - single year, year range, and negative test.
    """
    config = Config()

    # Test Case 1: Single year 1985 (only hampi_hindi pages 2-3)
    validate_query_by_date_range(
        config,
        start_date="1985-01-01",
        end_date="1985-12-31",
        expected_files_pages={
            'hampi_hindi.pdf': [2, 3]
        }
    )

    # Test Case 2: Year range 1986-1987 (jaipur_hindi pages 1-6 + hampi_hindi pages 4-5)
    # Note: hampi_hindi page 6 has no content, so only pages 4-5 are indexed
    validate_query_by_date_range(
        config,
        start_date="1986-01-01",
        end_date="1987-12-31",
        expected_files_pages={
            'jaipur_hindi.pdf': [1, 2, 3, 4, 5, 6],
            'hampi_hindi.pdf': [4, 5]
        }
    )

    # Test Case 3: Negative test - year 1990 has no data
    validate_query_date_not_found(
        config,
        start_date="1990-01-01",
        end_date="1990-12-31"
    )


def validate_query_by_pravachan_number_multiple_docs(
        config, pravachan_num: str, expected_files_pages_dates: dict):
    """
    Validates querying by a pravachan number that exists in multiple documents.

    Args:
        config: Test configuration
        pravachan_num: The pravachan number to query
        expected_files_pages_dates: Dict mapping filename to {pages: list, date: str}
            Example: {
                'hampi_hindi': {'pages': [4, 5], 'date': '1986-05-24'},
                'indore_gujarati': {'pages': [4, 5, 6, 7], 'date': '1982-05-24'}
            }
    """
    results = query_by_pravachan_number(config, pravachan_num)

    # Group results by filename
    results_by_file = {}
    for doc in results:
        filename = doc['_source']['original_filename']
        if filename not in results_by_file:
            results_by_file[filename] = []
        results_by_file[filename].append(doc)

    # Validate we got results from all expected files
    assert set(results_by_file.keys()) == set(expected_files_pages_dates.keys()), \
        f"Expected results from files {set(expected_files_pages_dates.keys())}, " \
        f"but got {set(results_by_file.keys())}"

    # Validate each file's results
    for filename, expected_data in expected_files_pages_dates.items():
        docs = results_by_file[filename]
        expected_pages = expected_data['pages']
        expected_date = expected_data['date']

        # Validate all documents have the correct pravachan_number
        for doc in docs:
            assert doc['_source']['pravachan_number'] == pravachan_num, \
                f"Document {doc['_id']} has pravachan_number " \
                f"{doc['_source']['pravachan_number']}, expected {pravachan_num}"

        # Validate all documents have the correct date
        for doc in docs:
            assert doc['_source']['date'] == expected_date, \
                f"Document {doc['_id']} has date {doc['_source']['date']}, " \
                f"expected {expected_date}"

        # Validate page numbers
        actual_pages = sorted(set(doc['_source']['page_number'] for doc in docs))
        assert actual_pages == expected_pages, \
            f"For file {filename}, expected pages {expected_pages}, got {actual_pages}"

        # Validate filename
        for doc in docs:
            assert doc['_source']['original_filename'] == filename, \
                f"Document {doc['_id']} has filename " \
                f"{doc['_source']['original_filename']}, expected {filename}"


def test_pravachan_query_duplicate_number(indexed_documents):
    """
    Tests querying for a pravachan number that exists in multiple documents.

    Pravachan "324" exists in:
    - hampi_hindi pages 4-5 with date 1986-05-24
    - indore_gujarati pages 4-6 with date 1982-05-24
    """
    config = Config()

    # Query for pravachan "324" which exists in multiple documents
    validate_query_by_pravachan_number_multiple_docs(
        config,
        pravachan_num="324",
        expected_files_pages_dates={
            'hampi_hindi.pdf': {
                'pages': [4, 5],
                'date': '1986-05-24'
            },
            'indore_gujarati.pdf': {
                'pages': [4, 5, 6],
                'date': '1982-05-24'
            }
        }
    )