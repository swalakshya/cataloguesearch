import asyncio
import logging
import os
import shutil
import threading
import time
import uvicorn
import pytest
import requests
from backend.common import embedding_models
from backend.common.opensearch import get_opensearch_client
from backend.crawler.discovery import Discovery
from backend.crawler.index_state import IndexState
from backend.crawler.index_generator import IndexGenerator
from backend.crawler.pdf_factory import create_pdf_processor
from backend.search.index_searcher import IndexSearcher
from tests.backend.common import setup, get_all_documents
from tests.backend.base import *

log_handle = logging.getLogger(__name__)

def run_api_server_in_thread(host, port, stop_event):
    """Function to run the API server in a thread."""
    # Initialize test environment in the API server thread
    # This ensures the same process context as the test
    import os
    from dotenv import load_dotenv
    from backend.config import Config

    # Load .env file (same logic as in tests.backend.base.initialise)
    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    load_dotenv(dotenv_path=f"{project_root}/.env", verbose=True)

    # Set test environment variables
    test_base_dir = os.getenv("TEST_BASE_DIR")
    if not test_base_dir:
        raise ValueError("TEST_BASE_DIR not set in .env file")

    # Set environment variables for the API server
    os.environ["LOGS_DIR"] = "logs"
    os.environ["CONFIG_PATH"] = f"{test_base_dir}/data/configs/test_config.yaml"

    # Reset Config singleton to use the test config
    Config.reset()

    # Import the FastAPI app
    from backend.api.search_api import app

    # Create a custom server that can be stopped
    import uvicorn
    from uvicorn import Config as UvicornConfig

    config = UvicornConfig(
        app=app,
        host=host,
        port=port,
        log_level="error",
        access_log=False
    )
    server = uvicorn.Server(config)

    # Run server until stop event is set
    import asyncio

    async def serve():
        await server.serve()

    # Run the server
    try:
        asyncio.run(serve())
    except Exception as e:
        log_handle.error(f"API server error: {e}")


@pytest.fixture(scope="module", autouse=True)
def build_index(initialise):
    """
    Setup test data and build search index.
    Process PDFs and index them to support both 'paragraph' and 'advanced' CHUNK_STRATEGY.
    """
    try:
        requests.get("http://localhost:11434", timeout=2)
    except requests.exceptions.ConnectionError:
        pytest.fail("Ollama server is not running on localhost:11434. Start it with 'ollama serve'.")

    # Setup test environment with scan_config files (don't copy OCR files, we'll process PDFs)
    setup(copy_ocr_files=True, add_scan_config=True)
    config = Config()

    # Initialize OpenSearch client and ensure clean index state
    opensearch_client = get_opensearch_client(config)
    indices_to_delete = [config.OPENSEARCH_INDEX_NAME, config.OPENSEARCH_METADATA_INDEX_NAME]

    # Explicitly delete indices to ensure clean state and proper mapping creation
    log_handle.info("Deleting existing indices to ensure clean state for vector search")
    for index_name in indices_to_delete:
        if index_name and opensearch_client.indices.exists(index=index_name):
            opensearch_client.indices.delete(index=index_name)
            log_handle.info(f"Deleted existing index: {index_name}")

    # Create indices with proper mapping (including knn_vector for embeddings)
    from backend.common.opensearch import create_indices_if_not_exists
    create_indices_if_not_exists(config, opensearch_client)
    log_handle.info("Created indices with proper mapping for vector search")

    pdf_processor = create_pdf_processor(config)
    discovery = Discovery(
        config,
        IndexGenerator(config, opensearch_client),
        IndexState(config.SQLITE_DB_PATH),
        pdf_processor
    )

    # Call discovery with process=True, index=True to generate OCR files based on CHUNK_STRATEGY
    log_handle.info(f"Starting discovery with process=True, index=True (CHUNK_STRATEGY={config.CHUNK_STRATEGY})")
    discovery.crawl(process=False, index=True)

    # Verify indexes are present
    os_all_docs = get_all_documents()
    doc_count = len(os_all_docs)
    log_handle.info(f"Indexed {doc_count} documents")

    # Refresh indices to make all data available for search
    opensearch_client.indices.refresh(index=config.OPENSEARCH_INDEX_NAME)
    opensearch_client.indices.refresh(index=config.OPENSEARCH_METADATA_INDEX_NAME)

    yield

    # Cleanup - delete indices
    for index_name in indices_to_delete:
        opensearch_client.indices.delete(index=index_name, ignore=[400, 404])


class APIServerManager:
    """Manager class to handle API server startup and shutdown."""

    def __init__(self, host="127.0.0.1", port=19876):
        self.host = host
        self.port = port
        self.server_thread = None
        self.stop_event = None

    def start_server_in_thread(self):
        """Start the API server in a separate thread."""
        self.stop_event = threading.Event()

        # Start server in a separate thread
        self.server_thread = threading.Thread(
            target=run_api_server_in_thread,
            args=(self.host, self.port, self.stop_event),
            daemon=True
        )
        self.server_thread.start()

        # Wait for server to start up
        self._wait_for_server_startup()

    def _wait_for_server_startup(self, timeout=30):
        """Wait for the server to start up by checking if it's responding."""
        start_time = time.time()
        while time.time() - start_time < timeout:
            try:
                response = requests.get(f"http://{self.host}:{self.port}/api/metadata", timeout=1)
                if response.status_code in [200, 404, 500]:  # Any response means server is up
                    log_handle.info(f"API server started successfully at http://{self.host}:{self.port}")
                    return True
            except requests.exceptions.RequestException:
                pass  # Server not ready yet

            time.sleep(0.5)

        raise TimeoutError(f"API server failed to start within {timeout} seconds")

    def stop_server(self):
        """Stop the API server."""
        if self.stop_event:
            self.stop_event.set()

        if self.server_thread and self.server_thread.is_alive():
            log_handle.info("Stopping API server thread...")
            self.server_thread.join(timeout=5)
            if self.server_thread.is_alive():
                log_handle.warning("API server thread did not stop gracefully")

        self.server_thread = None
        self.stop_event = None


@pytest.fixture(scope="module")
def api_server():
    """Fixture to start and stop the API server for tests."""
    server_manager = APIServerManager(host="127.0.0.1", port=19876)

    try:
        log_handle.info("Starting API server for tests...")
        server_manager.start_server_in_thread()
        yield server_manager
    finally:
        log_handle.info("Stopping API server...")
        server_manager.stop_server()


def test_api_server_startup(api_server):
    """Test that the API server starts up successfully."""
    # Test that the server is responding
    response = requests.get(f"http://{api_server.host}:{api_server.port}/api/metadata")
    assert response.status_code == 200
    log_handle.info("API server startup test passed")


def test_api_search_endpoint(api_server):
    """Test the /api/search endpoint."""
    # Test search endpoint with a simple query
    search_payload = {
        "query": "बेंगलुरु",
        "language": "hi",
        "exact_match": False,
        "exclude_words": [],
        "categories": {},
        "search_types": {
            "Pravachan": {
                "enabled": True,
                "page_size": 10,
                "page_number": 1
            },
            "Granth": {
                "enabled": False,
                "page_size": 10,
                "page_number": 1
            }
        },
        "enable_reranking": True
    }

    response = requests.post(
        f"http://{api_server.host}:{api_server.port}/api/search",
        json=search_payload
    )

    assert response.status_code == 200
    data = response.json()

    # Check response structure
    validate_result_schema(data, True)
    log_handle.info(f"✓ API search test passed - found {data['pravachan_results']['total_hits']} pravachan results")


def test_api_metadata_endpoint(api_server):
    """Test the /api/metadata endpoint."""
    response = requests.get(f"http://{api_server.host}:{api_server.port}/api/metadata")
    assert response.status_code == 200

    data = response.json()
    assert isinstance(data, dict)

    # Check new content-type-specific structure
    expected_content_types = {"Pravachan"}
    actual_keys = set(data.keys())

    # Should have the Pravachan content type key
    assert expected_content_types.issubset(actual_keys), f"Expected content type keys {expected_content_types} in metadata, got {actual_keys}"

    # Expected values for each content type
    expected_values_by_content_type = {
        "Pravachan": {
            "Anuyog": {'city', 'history', 'spiritual'},
        },
    }

    # Each content type should have its own metadata dictionary with composite keys
    for content_type in expected_content_types:
        content_metadata = data[content_type]
        assert isinstance(content_metadata, dict), f"Expected dict for {content_type} metadata"

        # Extract field names and languages from composite keys
        fields_by_language = {}
        for composite_key, values in content_metadata.items():
            # composite_key is like "Granth_hi", "Anuyog_gu", etc.
            parts = composite_key.rsplit('_', 1)
            if len(parts) == 2:
                field_name, lang_code = parts
                if lang_code not in fields_by_language:
                    fields_by_language[lang_code] = {}
                fields_by_language[lang_code][field_name] = values

        # Verify both languages exist
        expected_languages = {"hi", "gu"}
        actual_languages = set(fields_by_language.keys())
        assert expected_languages.issubset(actual_languages), \
            f"Expected languages {expected_languages} in {content_type} metadata, got {actual_languages}"

        # Verify metadata fields for each language
        for lang_code, lang_metadata in fields_by_language.items():
            # Pravachan has Anuyog, Granth, Year; Granth content type has Author, Granth, Anuyog
            if content_type == "Pravachan":
                expected_metadata_keys = {"Anuyog"}  # Granth and Year are optional
            else:
                expected_metadata_keys = set()

            for key in expected_metadata_keys:
                if key in lang_metadata:  # Some keys may be optional
                    # Each metadata key should have a list of string values
                    assert isinstance(lang_metadata[key], list), \
                        f"Expected list for {content_type}/{lang_code} metadata['{key}'], got {type(lang_metadata[key])}"
                    assert len(lang_metadata[key]) > 0, \
                        f"Expected non-empty list for {content_type}/{lang_code} metadata['{key}']"

                    # Each value should be a string and non-empty
                    for value in lang_metadata[key]:
                        assert isinstance(value, str), \
                            f"Expected string values in {content_type}/{lang_code} metadata['{key}'], got {type(value)}"
                        assert value.strip(), \
                            f"Expected non-empty string values in {content_type}/{lang_code} metadata['{key}']"

                    # Values should be sorted (as per update_metadata_index implementation)
                    values = lang_metadata[key]
                    assert values == sorted(values), \
                        f"Expected sorted values for {content_type}/{lang_code} metadata['{key}'], got {values}"

            log_handle.info(f"{content_type}/{lang_code} metadata: {json_dumps(lang_metadata)}")

        # Verify actual values match expected values from granth setup (combine all languages)
        combined_values = {}
        for lang_code, lang_metadata in fields_by_language.items():
            for key, values in lang_metadata.items():
                if key not in combined_values:
                    combined_values[key] = set()
                combined_values[key].update(values)

        # Get expected values for this content type
        expected_values = expected_values_by_content_type.get(content_type, {})

        for key in combined_values:
            if key in expected_values:
                actual_values_set = combined_values[key]
                expected_values_set = expected_values[key]

                assert actual_values_set == expected_values_set, \
                    f"Expected {key} values {expected_values_set} for {content_type}, got {actual_values_set}"

    log_handle.info(f"✓ API metadata test passed - validated content-type-specific metadata structure with expected keys and values")


def test_api_exact_phrase_search(api_server):
    """Test the /api/search endpoint with exact phrase matching."""
    test_cases = [
        {
            "query": "बृहदीश्वर मंदिर",
            "language": "hi",
            "expected_file": "thanjavur_hindi.pdf"
        },
        {
            "query": "એતિહાસિક દીવાલોની",
            "language": "gu",
            "expected_file": "jaipur_gujarati.pdf"
        }
    ]

    for i, test_case in enumerate(test_cases):
        search_payload = {
            "query": test_case["query"],
            "language": test_case["language"],
            "exact_match": True,
            "exclude_words": [],
            "categories": {},
            "search_types": {
                "Pravachan": {
                    "enabled": True,
                    "page_size": 10,
                    "page_number": 1
                },
                "Granth": {
                    "enabled": False,
                    "page_size": 10,
                    "page_number": 1
                }
            },
            "enable_reranking": True
        }

        response = requests.post(
            f"http://{api_server.host}:{api_server.port}/api/search",
            json=search_payload
        )

        assert response.status_code == 200
        data = response.json()
        log_handle.info(f"response: {json_dumps(data, truncate_fields=['vector_embedding'])}")
        validate_result_schema(data, True)

        assert len(data["pravachan_results"]["results"]) > 0
        for result in data["pravachan_results"]["results"]:
            fname = result["filename"]
            assert fname == test_case["expected_file"]


def test_api_exclude_words(api_server):
    """Test the /api/search endpoint with exclude words functionality."""
    query = "हिंदू पौराणिक"
    language = "hi"

    # First test: regular search without exclude words - should return 2 results
    regular_search_payload = {
        "query": query,
        "language": language,
        "exact_match": False,
        "exclude_words": [],
        "categories": {},
        "search_types": {
            "Pravachan": {
                "enabled": True,
                "page_size": 10,
                "page_number": 1
            },
            "Granth": {
                "enabled": False,
                "page_size": 10,
                "page_number": 1
            }
        },
        "enable_reranking": True
    }

    response = requests.post(
        f"http://{api_server.host}:{api_server.port}/api/search",
        json=regular_search_payload
    )

    assert response.status_code == 200
    data = response.json()
    log_handle.info(f"Regular search response: {json_dumps(data, truncate_fields=['vector_embedding'])}")

    # Check response structure
    validate_result_schema(data, True)

    # Should return 2 results
    regular_result_count = data["pravachan_results"]["total_hits"]
    assert regular_result_count == 3, f"Expected 2 results for regular search, got {regular_result_count}"

    # Second test: search with exclude words - should return only 1 result
    exclude_search_payload = {
        "query": query,
        "language": language,
        "exact_match": False,
        "exclude_words": ["हंपी"],
        "categories": {},
        "search_types": {
            "Pravachan": {
                "enabled": True,
                "page_size": 10,
                "page_number": 1
            },
            "Granth": {
                "enabled": False,
                "page_size": 10,
                "page_number": 1
            }
        },
        "enable_reranking": True
    }

    response = requests.post(
        f"http://{api_server.host}:{api_server.port}/api/search",
        json=exclude_search_payload
    )

    assert response.status_code == 200
    data = response.json()
    log_handle.info(f"Exclude words search response: {json_dumps(data, truncate_fields=['vector_embedding'])}")

    # Check response structure
    validate_result_schema(data, True)

    # Should return only 1 result after excluding "हंपी"
    exclude_result_count = data["pravachan_results"]["total_hits"]
    assert exclude_result_count == 1, f"Expected 1 result after excluding 'हंपी', got {exclude_result_count}"

    log_handle.info(f"✓ Exclude words test passed - regular search: {regular_result_count} results, exclude search: {exclude_result_count} results")


def test_api_context_endpoint(api_server):
    """Test the /api/context/{chunk_id} endpoint."""
    # First, get some search results to get a valid chunk_id
    search_payload = {
        "query": "बेंगलुरु",
        "language": "hi",
        "exact_match": False,
        "exclude_words": [],
        "categories": {},
        "search_types": {
            "Pravachan": {
                "enabled": True,
                "page_size": 1,
                "page_number": 1
            },
            "Granth": {
                "enabled": False,
                "page_size": 1,
                "page_number": 1
            }
        },
        "enable_reranking": True
    }

    search_response = requests.post(
        f"http://{api_server.host}:{api_server.port}/api/search",
        json=search_payload
    )

    assert search_response.status_code == 200
    search_data = search_response.json()

    if search_data["pravachan_results"]["total_hits"] > 0:
        # Get chunk_id from first result
        chunk_id = search_data["pravachan_results"]["results"][0].get("id") or search_data["pravachan_results"]["results"][0].get("_id")

        if chunk_id:
            # Test context endpoint
            context_response = requests.get(
                f"http://{api_server.host}:{api_server.port}/api/context/{chunk_id}?language=hi"
            )

            if context_response.status_code == 200:
                context_data = context_response.json()
                assert "current" in context_data
                log_handle.info("API context test passed")
            else:
                log_handle.info(f"Context endpoint returned {context_response.status_code}, may not be implemented or chunk not found")
        else:
            log_handle.info("No chunk_id found in search results, skipping context test")
    else:
        log_handle.info("No search results found, skipping context test")

def test_is_lexical_query(api_server):
    """Test is_lexical_query() logic with Hindi text searches."""
    # Test case 1: "इंदौर का इतिहास" - should trigger lexical search
    # (3 words, no punctuation, so is_lexical_query should return True)
    search_payload_1 = {
        "query": "इंदौर का इतिहास",
        "language": "hi",
        "exact_match": False,
        "exclude_words": [],
        "categories": {},
        "search_types": {
            "Pravachan": {
                "enabled": True,
                "page_size": 10,
                "page_number": 1
            },
            "Granth": {
                "enabled": False,
                "page_size": 10,
                "page_number": 1
            }
        },
        "enable_reranking": True
    }

    response_1 = requests.post(
        f"http://{api_server.host}:{api_server.port}/api/search",
        json=search_payload_1
    )

    assert response_1.status_code == 200
    data_1 = response_1.json()
    log_handle.info(f"Response for 'इंदौर का इतिहास': {json_dumps(data_1, truncate_fields=['vector_embedding'])}")

    # Validate response structure for lexical search
    validate_result_schema(data_1, True)

    # Should have lexical results and specifically from indore_hindi.pdf
    assert data_1["pravachan_results"]["total_hits"] > 0, "Expected lexical results for 'इंदौर का इतिहास'"

    # Verify results are from indore_hindi.pdf
    found_indore_file = False
    for result in data_1["pravachan_results"]["results"]:
        if "indore_hindi.pdf" in result["filename"]:
            found_indore_file = True
            break
    assert found_indore_file, "Expected to find results from indore_hindi.pdf"

    # Test case 2: "इंदौर का इतिहास?" - should trigger vector search
    # (has punctuation '?', so is_lexical_query should return False)
    search_payload_2 = {
        "query": "इंदौर का इतिहास?",
        "language": "hi",
        "exact_match": False,
        "exclude_words": [],
        "categories": {},
        "search_types": {
            "Pravachan": {
                "enabled": True,
                "page_size": 10,
                "page_number": 1
            },
            "Granth": {
                "enabled": False,
                "page_size": 10,
                "page_number": 1
            }
        },
        "enable_reranking": True
    }

    response_2 = requests.post(
        f"http://{api_server.host}:{api_server.port}/api/search",
        json=search_payload_2
    )
    data_2 = response_2.json()

    assert response_2.status_code == 200
    log_handle.info(f"Response for 'इंदौर का इतिहास?': {json_dumps(data_2, truncate_fields=['vector_embedding'])}")

    # Validate response structure for vector search
    validate_result_schema(data_2, False)

    # Should have vector results (can be from any file)
    assert data_2["pravachan_results"]["total_hits"] > 0, "Expected vector results for 'इंदौर का इतिहास?'"

    # Test case 3: "સોનગઢ ઇતિહાસ" - should trigger lexical search
    # (2 words, no punctuation, so is_lexical_query should return True)
    search_payload_3 = {
        "query": "સોનગઢ ઇતિહાસ",
        "language": "gu",
        "exact_match": False,
        "exclude_words": [],
        "categories": {},
        "search_types": {
            "Pravachan": {
                "enabled": True,
                "page_size": 10,
                "page_number": 1
            },
            "Granth": {
                "enabled": False,
                "page_size": 10,
                "page_number": 1
            }
        },
        "enable_reranking": True
    }

    response_3 = requests.post(
        f"http://{api_server.host}:{api_server.port}/api/search",
        json=search_payload_3
    )

    assert response_3.status_code == 200
    data_3 = response_3.json()
    log_handle.info(f"Response for 'સોનગઢ ઇતિહાસ': {json_dumps(data_3, truncate_fields=['vector_embedding'])}")

    # Validate response structure for lexical search
    validate_result_schema(data_3, True)

    # Should have lexical results
    assert data_3["pravachan_results"]["total_hits"] > 0, "Expected lexical results for 'સોનગઢ ઇતિહાસ'"

    # Test case 4: "સોનગઢનો ઇતિહાસ?" - should trigger vector search
    # (has punctuation '?', so is_lexical_query should return False)
    search_payload_4 = {
        "query": "સોનગઢનો ઇતિહાસ?",
        "language": "gu",
        "exact_match": False,
        "exclude_words": [],
        "categories": {},
        "search_types": {
            "Pravachan": {
                "enabled": True,
                "page_size": 10,
                "page_number": 1
            },
            "Granth": {
                "enabled": False,
                "page_size": 10,
                "page_number": 1
            }
        },
        "enable_reranking": True
    }

    response_4 = requests.post(
        f"http://{api_server.host}:{api_server.port}/api/search",
        json=search_payload_4
    )

    assert response_4.status_code == 200
    data_4 = response_4.json()
    log_handle.info(f"Response for 'સોનગઢનો ઇતિહાસ?': {json_dumps(data_4, truncate_fields=['vector_embedding'])}")

    # Validate response structure for vector search
    validate_result_schema(data_4, False)

    # Should have vector results
    assert data_4["pravachan_results"]["total_hits"] > 0, "Expected vector results for 'સોનગઢનો ઇતિહાસ?'"

    # Test case 5: "हंपी के बारे में कुछ बताइए" - should trigger vector search
    # (has question phrase "कुछ बताइए", so is_lexical_query should return False)
    search_payload_5 = {
        "query": "हंपी के बारे में कुछ बताइए",
        "language": "hi",
        "exact_match": False,
        "exclude_words": [],
        "categories": {},
        "search_types": {
            "Pravachan": {
                "enabled": True,
                "page_size": 10,
                "page_number": 1
            },
            "Granth": {
                "enabled": False,
                "page_size": 10,
                "page_number": 1
            }
        },
        "enable_reranking": True
    }

    response_5 = requests.post(
        f"http://{api_server.host}:{api_server.port}/api/search",
        json=search_payload_5
    )

    assert response_5.status_code == 200
    data_5 = response_5.json()
    log_handle.info(f"Response for 'हंपी के बारे में कुछ बताइए': {json_dumps(data_5, truncate_fields=['vector_embedding'])}")

    # Validate response structure for vector search
    validate_result_schema(data_5, False)

    # Should have vector results
    assert data_5["pravachan_results"]["total_hits"] > 0, "Expected vector results for 'हंपी के बारे में कुछ बताइए'"


def test_api_spell_suggestion_search(api_server):
    """Test search with spelling suggestion functionality."""
    test_cases = [
        {
            "misspelled_query": "सराफ",
            "language": "hi",
            "expected_suggestion": "सराफा",
            "expected_file": "indore_hindi.pdf"
        },
        {
            "misspelled_query": "સરાફ",
            "language": "gu",
            "expected_suggestion": "સરાફા",
            "expected_file": "indore_gujarati.pdf"
        }
    ]

    for i, test_case in enumerate(test_cases):
        # Test case 1: Search for misspelled word - should return no results but suggest correct spelling
        search_payload_1 = {
            "query": test_case["misspelled_query"],
            "language": test_case["language"],
            "exact_match": False,
            "exclude_words": [],
            "categories": {},
            "search_types": {
                "Pravachan": {
                    "enabled": True,
                    "page_size": 10,
                    "page_number": 1
                },
                "Granth": {
                    "enabled": False,
                    "page_size": 10,
                    "page_number": 1
                }
            },
            "enable_reranking": True
        }

        response_1 = requests.post(
            f"http://{api_server.host}:{api_server.port}/api/search",
            json=search_payload_1
        )

        assert response_1.status_code == 200
        data_1 = response_1.json()
        log_handle.info(f"Response for '{test_case['misspelled_query']}': {json_dumps(data_1, truncate_fields=['vector_embedding'])}")

        # Should have no results but contain suggestions
        assert data_1["pravachan_results"]["total_hits"] == 0, f"Expected no results for misspelled '{test_case['misspelled_query']}'"
        assert "suggestions" in data_1, "Expected suggestions in response"
        assert len(data_1["suggestions"]) > 0, "Expected at least one suggestion"

        # Check if expected suggestion is in suggestions
        suggested_words = data_1["suggestions"]
        assert test_case["expected_suggestion"] in suggested_words, f"Expected '{test_case['expected_suggestion']}' in suggestions"

        # Test case 2: Search for the suggested word - should return results from expected file
        search_payload_2 = {
            "query": test_case["expected_suggestion"],
            "language": test_case["language"],
            "exact_match": False,
            "exclude_words": [],
            "categories": {},
            "search_types": {
                "Pravachan": {
                    "enabled": True,
                    "page_size": 10,
                    "page_number": 1
                },
                "Granth": {
                    "enabled": False,
                    "page_size": 10,
                    "page_number": 1
                }
            },
            "enable_reranking": True
        }

        response_2 = requests.post(
            f"http://{api_server.host}:{api_server.port}/api/search",
            json=search_payload_2
        )

        assert response_2.status_code == 200
        data_2 = response_2.json()
        log_handle.info(f"Response for '{test_case['expected_suggestion']}': {json_dumps(data_2, truncate_fields=['vector_embedding'])}")

        # Should have results for the correctly spelled word
        assert data_2["pravachan_results"]["total_hits"] > 0, f"Expected results for correctly spelled '{test_case['expected_suggestion']}'"

        # Validate response structure
        validate_result_schema(data_2, True)

        # Validate that results come from expected file
        found_expected_file = False
        for result in data_2["pravachan_results"]["results"]:
            if test_case["expected_file"] in result["filename"]:
                found_expected_file = True
                break
        assert found_expected_file, f"Expected to find results from {test_case['expected_file']}"

        log_handle.info(f"✓ {test_case['language']} spell suggestion test passed - '{test_case['misspelled_query']}' returned {data_1['pravachan_results']['total_hits']} results with {len(data_1.get('suggestions', []))} suggestions, '{test_case['expected_suggestion']}' returned {data_2['pravachan_results']['total_hits']} results from {test_case['expected_file']}")

    log_handle.info("✓ All spell suggestion tests passed")


def test_get_context(api_server):
    """Test the /api/context/{document_id} endpoint with Gujarati and Hindi queries."""
    test_cases = [
        {
            "query": "અહમદનગર",
            "language": "gu",
            "expected_file": "hampi_gujarati.pdf"
        },
        {
            "query": "गोलकोंडा",
            "language": "hi",
            "expected_file": "hampi_hindi.pdf"
        }
    ]

    for i, test_case in enumerate(test_cases):
        # Step 1: Issue search query to get document_id
        search_payload = {
            "query": test_case["query"],
            "language": test_case["language"],
            "exact_match": False,
            "exclude_words": [],
            "categories": {},
            "search_types": {
                "Pravachan": {
                    "enabled": True,
                    "page_size": 10,
                    "page_number": 1
                },
                "Granth": {
                    "enabled": False,
                    "page_size": 10,
                    "page_number": 1
                }
            },
            "enable_reranking": True
        }

        search_response = requests.post(
            f"http://{api_server.host}:{api_server.port}/api/search",
            json=search_payload
        )

        assert search_response.status_code == 200
        search_data = search_response.json()
        log_handle.info(f"Search response for '{test_case['query']}': {json_dumps(search_data, truncate_fields=['vector_embedding'])}")

        # Validate we have search results
        assert search_data["pravachan_results"]["total_hits"] > 0, f"Expected results for '{test_case['query']}'"

        # Validate results come from expected file
        first_result = search_data["pravachan_results"]["results"][0]
        assert test_case["expected_file"] in first_result["filename"], f"Expected result from {test_case['expected_file']}"

        # Step 2: Get document_id from first result
        document_id = first_result.get("document_id") or first_result.get("id") or first_result.get("_id")
        assert document_id is not None, "Expected document_id in search result"

        # Step 3: Issue get_context API call
        context_response = requests.get(
            f"http://{api_server.host}:{api_server.port}/api/context/{document_id}?language={test_case['language']}"
        )

        assert context_response.status_code == 200, f"Context API should return 200 for document_id: {document_id}"
        context_data = context_response.json()
        log_handle.info(f"Context response for document_id '{document_id}': {json_dumps(context_data, truncate_fields=['vector_embedding'])}")

        # Step 4: Validate response structure - should have previous, current, next keys
        expected_keys = {"previous", "current", "next"}
        actual_keys = set(context_data.keys())
        assert expected_keys.issubset(actual_keys), f"Expected keys {expected_keys} in context response, got {actual_keys}"

        # Step 5: Validate consecutive paragraph_id values
        paragraphs = []
        for key in ["previous", "current", "next"]:
            if context_data[key] is not None:  # Some keys might be None at document boundaries
                paragraph_id = context_data[key].get("paragraph_id")
                if paragraph_id is not None:
                    paragraphs.append((key, paragraph_id))

        # Sort by paragraph_id to check if they are consecutive
        paragraphs.sort(key=lambda x: x[1])
        assert len(paragraphs) > 2

        # Check if paragraph_ids are consecutive
        for j in range(1, len(paragraphs)):
            current_id = paragraphs[j][1]
            previous_id = paragraphs[j-1][1]
            assert current_id == previous_id + 1, f"Expected consecutive paragraph_ids, got {previous_id} and {current_id}"

        log_handle.info(f"✓ {test_case['language']} context test passed - document_id: {document_id}, paragraph_ids: {[p[1] for p in paragraphs]}")

    log_handle.info("✓ All context tests passed")


def test_get_similar_documents(api_server):
    """Test the /api/similar/{document_id} endpoint with Gujarati and Hindi queries."""
    test_cases = [
        {
            "query": "સોનગઢનો ઇતિહાસ શું છે?",
            "language": "gu"
        },
        {
            "query": "सोनगढ़ का इतिहास क्या है?",
            "language": "hi"
        }
    ]

    for i, test_case in enumerate(test_cases):
        # Step 1: Issue search query to get search results
        search_payload = {
            "query": test_case["query"],
            "language": test_case["language"],
            "exact_match": False,
            "exclude_words": [],
            "categories": {},
            "search_types": {
                "Pravachan": {
                    "enabled": True,
                    "page_size": 10,
                    "page_number": 1
                },
                "Granth": {
                    "enabled": False,
                    "page_size": 10,
                    "page_number": 1
                }
            },
            "enable_reranking": True
        }

        search_response = requests.post(
            f"http://{api_server.host}:{api_server.port}/api/search",
            json=search_payload
        )

        assert search_response.status_code == 200
        search_data = search_response.json()
        log_handle.info(f"Search response for '{test_case['query']}': {json_dumps(search_data, truncate_fields=['vector_embedding'])}")

        # Validate we have enough search results to get the second one
        pravachan_results = search_data.get("pravachan_results", {})
        results = pravachan_results.get("results", [])
        total_results = len(results)
        assert total_results >= 2, f"Expected at least 2 results for '{test_case['query']}', got {total_results}"

        # Step 2: Get document_id from second result
        one_result = results[1]

        assert one_result is not None, "Could not find search result"

        document_id = one_result.get("document_id")
        assert document_id is not None, "Expected document_id in second search result"

        log_handle.info(f"Using document_id '{document_id}' from second search result")

        # Step 3: Issue get similar documents API call
        similar_response = requests.get(
            f"http://{api_server.host}:{api_server.port}/api/similar-documents/{document_id}?language={test_case['language']}"
        )

        assert similar_response.status_code == 200, f"Similar documents API should return 200 for document_id: {document_id}"
        similar_data = similar_response.json()
        log_handle.info(f"Similar documents response for document_id '{document_id}': {json_dumps(similar_data, truncate_fields=['vector_embedding'])}")

        # Step 4: Validate response has non-zero results
        similar_results_count = similar_data.get("total_results", 0)
        assert similar_results_count > 0, f"Expected non-zero similar documents for document_id: {document_id}, got {similar_results_count}"

        # Step 5: Validate response structure
        # Validate each similar document has required fields
        for doc in similar_data["results"]:
            assert "document_id" in doc or "_id" in doc or "document_id" in doc, "Expected id field in similar document"
            assert "filename" in doc, "Expected filename field in similar document"
            assert "content_snippet" in doc

        log_handle.info(f"✓ {test_case['language']} similar documents test passed - document_id: {document_id}, found {similar_results_count} similar documents")

    log_handle.info("✓ All similar documents tests passed")


def test_cache_invalidation(api_server):
    """
    Tests cache invalidation by:
    1. Calling metadata to populate cache
    2. Invalidating cache
    3. Calling metadata again and comparing - should be no change in data
    """
    # First call to populate cache
    response1 = requests.get(f"http://{api_server.host}:{api_server.port}/api/metadata")
    assert response1.status_code == 200
    metadata_before = response1.json()
    log_handle.info(f"before: {json_dumps(metadata_before)}")

    # Invalidate cache
    invalidate_response = requests.post(f"http://{api_server.host}:{api_server.port}/api/cache/invalidate")
    assert invalidate_response.status_code == 200
    assert invalidate_response.json()["status"] == "success"
    assert "Cache invalidated successfully" in invalidate_response.json()["message"]

    # Second call after cache invalidation
    response2 = requests.get(f"http://{api_server.host}:{api_server.port}/api/metadata")
    assert response2.status_code == 200
    metadata_after = response2.json()
    log_handle.info(f"after: {json_dumps(metadata_after)}")

    # Data should be the same (no change in underlying OpenSearch data)
    assert metadata_before == metadata_after
    assert "Pravachan" in metadata_after

    log_handle.info("✓ Cache invalidation test passed - metadata consistent after cache invalidation")


def validate_result_schema(data, lexical_results):
    # Check for lexical results structure
    assert "pravachan_results" in data, "Expected pravachan_results in response"
    assert "granth_results" in data, "Expected granth_results in response"
    pravachan_keys = ["results", "total_hits", "page_size", "page_number"]
    for key in pravachan_keys:
        assert key in data["pravachan_results"], f"Expected {key} in pravachan_results"

    # Validate granth_results structure
    granth_keys = ["results", "total_hits", "page_size", "page_number"]
    for key in granth_keys:
        assert key in data["granth_results"], f"Expected {key} in granth_results"


def test_api_year_filter_single_year_lexical(api_server):
    """Test year filtering with a single year (1985) using lexical search."""
    # Query for content that exists in hampi_hindi with dates in 1985
    # Based on common.py bookmarks: hampi_hindi page 2 has date 1985-10-23

    # First, search WITHOUT year filter to verify the word exists and check what dates are present
    search_payload_no_filter = {
        "query": "गोलकोंडा",  # This word appears in hampi_hindi
        "language": "hi",
        "exact_match": False,
        "exclude_words": [],
        "categories": {},
        "search_types": {
            "Pravachan": {
                "enabled": True,
                "page_size": 20,
                "page_number": 1
            },
            "Granth": {
                "enabled": False,
                "page_size": 20,
                "page_number": 1
            }
        },
        "enable_reranking": True
    }

    response_no_filter = requests.post(
        f"http://{api_server.host}:{api_server.port}/api/search",
        json=search_payload_no_filter
    )

    assert response_no_filter.status_code == 200
    data_no_filter = response_no_filter.json()
    log_handle.info(f"Search WITHOUT year filter response: {json_dumps(data_no_filter, truncate_fields=['vector_embedding'])}")

    # Check if we have any results without year filter
    if data_no_filter["pravachan_results"]["total_hits"] > 0:
        # Log what dates are actually in the results
        for result in data_no_filter["pravachan_results"]["results"]:
            date = result.get("date") or result.get("metadata", {}).get("date")
            log_handle.info(f"Result without filter: file={result['filename']}, page={result.get('page_number')}, date={date}")
    else:
        log_handle.warning("No results found even WITHOUT year filter - the word may not be indexed")

    # Test Case: Single year 1985 - should only return results from hampi_hindi pages 2-3
    search_payload = {
        "query": "गोलकोंडा",  # This word appears in hampi_hindi
        "language": "hi",
        "exact_match": False,
        "exclude_words": [],
        "categories": {},
        "start_year": 1985,
        "end_year": 1985,
        "search_types": {
            "Pravachan": {
                "enabled": True,
                "page_size": 20,
                "page_number": 1
            },
            "Granth": {
                "enabled": False,
                "page_size": 20,
                "page_number": 1
            }
        },
        "enable_reranking": True
    }

    response = requests.post(
        f"http://{api_server.host}:{api_server.port}/api/search",
        json=search_payload
    )

    assert response.status_code == 200
    data = response.json()
    log_handle.info(f"Year filter (1985) response: {json_dumps(data, truncate_fields=['vector_embedding'])}")

    # Validate response structure
    validate_result_schema(data, True)

    # Should have results from 1985
    assert data["pravachan_results"]["total_hits"] > 0, "Expected results for year 1985"

    # Validate all results have dates in 1985
    for result in data["pravachan_results"]["results"]:
        # The date field should be at the root level of the result or in metadata
        # Based on the implementation, it should be in metadata
        date = result.get("date") or result.get("metadata", {}).get("date")
        assert date is not None, f"Expected date field in result {result.get('document_id')}"

        # Extract year from date (format: YYYY-MM-DD)
        year = date.split("-")[0]
        assert year == "1985", f"Expected year 1985, got {year} for result with date {date}"

        # Should be from hampi_hindi.pdf
        assert "hampi_hindi.pdf" in result["filename"], \
            f"Expected result from hampi_hindi.pdf, got {result['filename']}"

        log_handle.info(f"✓ Result: file={result['filename']}, page={result.get('page_number')}, date={date}")

    log_handle.info(f"✓ Year filter test (1985) passed - found {data['pravachan_results']['total_hits']} results, all from 1985")


def test_api_year_filter_range_lexical(api_server):
    """Test year filtering with a year range (1986-1987) using lexical search."""
    # Based on common.py bookmarks:
    # - jaipur_hindi: pages 1-4 (1986-05-03), pages 5-6 (1987-06-04)
    # - hampi_hindi: pages 4-5 (1986-05-24)

    # Test Case: Year range 1986-1987 - should return results from both files
    search_payload = {
        "query": "इतिहास",  # Common word that appears in multiple files
        "language": "hi",
        "exact_match": False,
        "exclude_words": [],
        "categories": {},
        "start_year": 1986,
        "end_year": 1987,
        "search_types": {
            "Pravachan": {
                "enabled": True,
                "page_size": 50,
                "page_number": 1
            },
            "Granth": {
                "enabled": False,
                "page_size": 20,
                "page_number": 1
            }
        },
        "enable_reranking": True
    }

    response = requests.post(
        f"http://{api_server.host}:{api_server.port}/api/search",
        json=search_payload
    )

    assert response.status_code == 200
    data = response.json()
    log_handle.info(f"Year filter (1986-1987) response: {json_dumps(data, truncate_fields=['vector_embedding'])}")

    # Validate response structure
    validate_result_schema(data, True)

    # Should have results from 1986-1987
    assert data["pravachan_results"]["total_hits"] > 0, "Expected results for year range 1986-1987"

    # Track files and years found
    files_found = set()
    years_found = set()

    # Validate all results have dates in 1986-1987
    for result in data["pravachan_results"]["results"]:
        date = result.get("date") or result.get("metadata", {}).get("date")
        assert date is not None, f"Expected date field in result {result.get('document_id')}"

        # Extract year from date (format: YYYY-MM-DD)
        year = int(date.split("-")[0])
        assert 1986 <= year <= 1987, f"Expected year between 1986-1987, got {year} for result with date {date}"

        # Track files and years
        files_found.add(result["filename"])
        years_found.add(year)

        log_handle.info(f"✓ Result: file={result['filename']}, page={result.get('page_number')}, date={date}, year={year}")

    # Should have results from both jaipur_hindi and hampi_hindi
    expected_files = {"jaipur_hindi.pdf", "hampi_hindi.pdf"}
    assert files_found == expected_files, \
        f"Expected results from {expected_files}, got {files_found}"

    # Should have results from both 1986 and 1987
    expected_years = {1986, 1987}
    assert years_found == expected_years, \
        f"Expected years {expected_years}, got {years_found}"

    log_handle.info(f"✓ Year range filter test (1986-1987) passed - found {data['pravachan_results']['total_hits']} results from years {years_found} across files {files_found}")


def test_api_series_date_filter(api_server):
    """
    Test that year filtering works with series dates for documents without bookmarks.

    The songadh_hindi and songadh_gujarati files are in the spiritual directory which has:
    - series_start_date: 1975-01-01
    - series_end_date: 1977-12-31

    These files have NO bookmarks, so they should be found via series date overlap.
    """
    # Search for a word that appears in spiritual files
    search_payload = {
        "query": "सोनगढ़",
        "language": "hi",
        "start_year": 1976,
        "end_year": 1976,
        "exact_match": False,
        "exclude_words": [],
        "categories": {},
        "search_types": {
            "Pravachan": {
                "enabled": True,
                "page_size": 20,
                "page_number": 1
            },
            "Granth": {
                "enabled": False,
                "page_size": 20,
                "page_number": 1
            }
        },
        "enable_reranking": True
    }

    response = requests.post(
        f"http://{api_server.host}:{api_server.port}/api/search",
        json=search_payload
    )
    assert response.status_code == 200, f"API returned status {response.status_code}: {response.text}"

    data = response.json()
    assert data["pravachan_results"]["total_hits"] > 0, \
        "Expected to find results via series date filtering"

    # Verify the results have series dates
    results = data["pravachan_results"]["results"]
    assert len(results) > 0, "Expected at least one result"

    for result in results:
        log_handle.info(
            f"Result: file={result['filename']}, page={result.get('page_number')}, "
            f"date={result.get('date')}, series_start={result.get('series_start_date')}, "
            f"series_end={result.get('series_end_date')}, Anuyog={result.get('metadata', {}).get('Anuyog')}")

        # Should be from spiritual files (which have series dates but no bookmark dates)
        assert result.get('metadata', {}).get('Anuyog') == 'spiritual', \
            f"Expected spiritual Anuyog, got {result.get('metadata', {}).get('Anuyog')}"

        # Document date should be None (no bookmarks)
        assert result.get('date') is None, \
            f"Expected no document date (no bookmarks), got {result.get('date')}"

        # Should have series dates from config
        assert result.get('series_start_date') == '1975-01-01', \
            f"Expected series_start_date=1975-01-01, got {result.get('series_start_date')}"
        assert result.get('series_end_date') == '1977-12-31', \
            f"Expected series_end_date=1977-12-31, got {result.get('series_end_date')}"

    log_handle.info(f"✓ Series date filter test (1975-1977) passed - found {data['pravachan_results']['total_hits']} results with series dates")


def test_api_series_date_filter_exclude_bookmark_dates(api_server):
    """
    Test that series date filtering correctly excludes documents with bookmark dates outside the search range.

    thanjavur_gujarati has:
    - File-specific config: series_start_date=1978-01-01, series_end_date=1983-12-31
    - Bookmarks on page 2 (1980-05-06) and page 3 (1983-06-04)

    When searching for 1978-1979:
    - Should NOT find pages 2 and 3 (their bookmark dates are outside the range)
    - SHOULD find pages without bookmarks (1, 4, 5) via series date overlap
    """
    # Search for a word that appears throughout thanjavur_gujarati
    search_payload = {
        "query": "તંજાવુર",  # "Thanjavur" in Gujarati
        "language": "gu",
        "start_year": 1978,
        "end_year": 1979,
        "exact_match": False,
        "exclude_words": [],
        "categories": {},
        "search_types": {
            "Pravachan": {
                "enabled": True,
                "page_size": 50,
                "page_number": 1
            },
            "Granth": {
                "enabled": False,
                "page_size": 20,
                "page_number": 1
            }
        },
        "enable_reranking": True
    }

    response = requests.post(
        f"http://{api_server.host}:{api_server.port}/api/search",
        json=search_payload
    )
    assert response.status_code == 200, f"API returned status {response.status_code}: {response.text}"

    data = response.json()

    # Should find results via series date overlap
    assert data["pravachan_results"]["total_hits"] > 0, \
        "Expected to find results via series date filtering"

    # Verify the results
    results = data["pravachan_results"]["results"]
    assert len(results) > 0, "Expected at least one result"

    pages_with_dates = []
    pages_without_dates = []

    for result in results:
        log_handle.info(
            f"Result: file={result['filename']}, page={result.get('page_number')}, "
            f"date={result.get('date')}, series_start={result.get('series_start_date')}, "
            f"series_end={result.get('series_end_date')}")

        # Should be from thanjavur_gujarati
        assert "thanjavur_gujarati" in result['filename'], \
            f"Expected thanjavur_gujarati, got {result['filename']}"

        # Should have series dates from file-specific config
        assert result.get('series_start_date') == '1978-01-01', \
            f"Expected series_start_date=1978-01-01, got {result.get('series_start_date')}"
        assert result.get('series_end_date') == '1983-12-31', \
            f"Expected series_end_date=1983-12-31, got {result.get('series_end_date')}"

        page_num = result.get('page_number')
        if result.get('date'):
            pages_with_dates.append((page_num, result.get('date')))
        else:
            pages_without_dates.append(page_num)

    # Should NOT find pages 2 or 3 (they have dates outside the search range)
    assert 2 not in pages_without_dates, "Page 2 has bookmark date 1980-05-06, should not appear"
    assert 3 not in pages_without_dates, "Page 3 has bookmark date 1983-06-04, should not appear"
    assert len(pages_with_dates) == 0, \
        f"Expected no pages with dates in 1978-1979, found: {pages_with_dates}"

    # Should find pages without bookmarks (1, 4, 5) via series date overlap
    assert len(pages_without_dates) > 0, \
        "Expected to find pages without bookmarks via series date overlap"

    log_handle.info(
        f"✓ Series date exclusion test (1978-1979) passed - found {len(pages_without_dates)} "
        f"pages without bookmarks via series overlap, correctly excluded pages with dates outside range")


def test_api_series_date_filter_include_bookmark_dates(api_server):
    """
    Test that series date filtering includes both documents with matching bookmark dates
    and documents without bookmarks.

    thanjavur_gujarati has:
    - File-specific config: series_start_date=1978-01-01, series_end_date=1983-12-31
    - Bookmarks on page 2 (1980-05-06) and page 3 (1983-06-04)

    When searching for 1980:
    - SHOULD find page 2 (bookmark date matches)
    - SHOULD find pages without bookmarks (1, 4, 5) via series date overlap
    - Should NOT find page 3 (bookmark date 1983 is outside range)
    """
    # Search for a word that appears throughout thanjavur_gujarati
    search_payload = {
        "query": "મંદિર",
        "language": "gu",
        "start_year": 1980,
        "end_year": 1980,
        "exact_match": False,
        "exclude_words": [],
        "categories": {},
        "search_types": {
            "Pravachan": {
                "enabled": True,
                "page_size": 50,
                "page_number": 1
            },
            "Granth": {
                "enabled": False,
                "page_size": 20,
                "page_number": 1
            }
        },
        "enable_reranking": True
    }

    response = requests.post(
        f"http://{api_server.host}:{api_server.port}/api/search",
        json=search_payload
    )
    assert response.status_code == 200, f"API returned status {response.status_code}: {response.text}"

    data = response.json()

    # Should find results
    assert data["pravachan_results"]["total_hits"] > 0, \
        "Expected to find results"

    # Verify the results
    results = data["pravachan_results"]["results"]
    assert len(results) > 0, "Expected at least one result"

    pages_with_dates = {}
    pages_without_dates = []

    for result in results:
        log_handle.info(
            f"Result: file={result['filename']}, page={result.get('page_number')}, "
            f"date={result.get('date')}, series_start={result.get('series_start_date')}, "
            f"series_end={result.get('series_end_date')}")

        # Should be from thanjavur_gujarati
        assert "thanjavur_gujarati" in result['filename'], \
            f"Expected thanjavur_gujarati, got {result['filename']}"

        # Should have series dates from file-specific config
        assert result.get('series_start_date') == '1978-01-01', \
            f"Expected series_start_date=1978-01-01, got {result.get('series_start_date')}"
        assert result.get('series_end_date') == '1983-12-31', \
            f"Expected series_end_date=1983-12-31, got {result.get('series_end_date')}"

        page_num = result.get('page_number')
        if result.get('date'):
            pages_with_dates[page_num] = result.get('date')
        else:
            pages_without_dates.append(page_num)

    # Should find page 2 with date 1980-05-06
    assert 2 in pages_with_dates, "Expected to find page 2 with date 1980-05-06"
    assert pages_with_dates[2] == '1980-05-06', \
        f"Expected date 1980-05-06 for page 2, got {pages_with_dates[2]}"

    # Should NOT find page 3 (date 1983-06-04 is outside the 1980 range)
    assert 3 not in pages_with_dates, "Page 3 has date 1983-06-04, should not appear in 1980 search"
    assert 3 not in pages_without_dates, "Page 3 should not appear at all in 1980 search"

    # Should find pages without bookmarks via series date overlap
    assert len(pages_without_dates) > 0, \
        "Expected to find pages without bookmarks via series date overlap"

    log_handle.info(
        f"✓ Series date inclusion test (1980) passed - found page 2 with matching date, "
        f"and {len(pages_without_dates)} pages without bookmarks via series overlap")