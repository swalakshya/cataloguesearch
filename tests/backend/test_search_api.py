import hashlib
import logging
import os
import sqlite3
import pytest
import requests
from backend.common import embedding_models
from backend.common.opensearch import get_opensearch_client
from backend.search.index_searcher import IndexSearcher
from tests.backend.base import *
from tests.backend.common import consume_sse

log_handle = logging.getLogger(__name__)

_admin_token = None


@pytest.fixture(scope="module", autouse=True)
def _require_index(build_index):
    """Pull the session-scoped build_index into this module."""



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
    data = consume_sse(response)

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

    # Categories not in active_categories must never appear
    assert "Books" not in actual_keys, \
        f"'Books' must not appear in /api/metadata (not in active_categories), got keys: {actual_keys}"

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
            # composite_key is like "Name_hi", "Anuyog_gu", etc.
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
            # Pravachan has Anuyog, Name, Year; Granth content type has Author, Name, Anuyog
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


def test_books_category_excluded(api_server):
    """
    Books is not in active_categories.
    A document indexed with category='Books' must not appear in /api/search results
    and must not appear in /api/metadata.
    """
    from backend.config import Config
    from backend.common.opensearch import get_opensearch_client

    config = Config()
    client = get_opensearch_client(config)
    index_name = config.OPENSEARCH_INDEX_NAME
    metadata_index = config.OPENSEARCH_METADATA_INDEX_NAME

    books_chunk_id = "test_books_excluded_p1_para1"
    books_chunk = {
        "document_id": "test_books_excluded",
        "filename": "books_test.pdf",
        "text_content_hindi": "पुस्तक विशेष परीक्षण सामग्री अनोखा",
        "text_content_gujarati": "પુસ્તક વિશેષ",
        "content_snippet": "पुस्तक विशेष परीक्षण सामग्री अनोखा",
        "page_number": 1,
        "metadata": {"category": "Books", "language": "hi"},
    }
    books_meta_id = "Books_Anuyog_hi_test"
    books_meta = {
        "content_type": "Books",
        "key": "Anuyog",
        "language": "hi",
        "values": ["books_test_value"],
    }

    client.index(index=index_name, id=books_chunk_id, body=books_chunk, refresh=True)
    client.index(index=metadata_index, id=books_meta_id, body=books_meta, refresh=True)

    # Invalidate the metadata cache so the API re-reads from OpenSearch
    inv = requests.post(f"http://{api_server.host}:{api_server.port}/api/cache/invalidate")
    assert inv.status_code == 200

    try:
        # /api/metadata must not include "Books"
        meta_r = requests.get(f"http://{api_server.host}:{api_server.port}/api/metadata")
        assert meta_r.status_code == 200
        assert "Books" not in meta_r.json(), \
            f"'Books' must not appear in /api/metadata; got: {list(meta_r.json().keys())}"

        # /api/search must not return the Books document in either result set
        search_payload = {
            "query": "पुस्तक विशेष परीक्षण सामग्री अनोखा",
            "language": "hi",
            "exact_match": True,
            "exclude_words": [],
            "categories": {},
            "search_types": {
                "Pravachan": {"enabled": True, "page_size": 10, "page_number": 1},
                "Granth":    {"enabled": True, "page_size": 10, "page_number": 1},
            },
            "enable_reranking": False,
        }
        search_r = requests.post(
            f"http://{api_server.host}:{api_server.port}/api/search",
            json=search_payload,
        )
        assert search_r.status_code == 200
        data = consume_sse(search_r)
        all_results = (
            data["pravachan_results"]["results"] +
            data["granth_results"]["results"]
        )
        assert all(r.get("filename") != "books_test.pdf" for r in all_results), \
            "Books document must not appear in search results"

        log_handle.info("✓ Books category correctly excluded from /api/metadata and /api/search")

    finally:
        client.delete(index=index_name, id=books_chunk_id, ignore=[404])
        client.delete(index=metadata_index, id=books_meta_id, ignore=[404])
        client.indices.refresh(index=index_name)
        client.indices.refresh(index=metadata_index)


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
        data = consume_sse(response)
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
    data = consume_sse(response)
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
    data = consume_sse(response)
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
    search_data = consume_sse(search_response)

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
    data_1 = consume_sse(response_1)
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
    assert response_2.status_code == 200
    data_2 = consume_sse(response_2)

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
    data_3 = consume_sse(response_3)
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
    data_4 = consume_sse(response_4)
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
    data_5 = consume_sse(response_5)
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
        data_1 = consume_sse(response_1)
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
        data_2 = consume_sse(response_2)
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
        search_data = consume_sse(search_response)
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
        search_data = consume_sse(search_response)
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
    data_no_filter = consume_sse(response_no_filter)
    log_handle.info(f"Search WITHOUT year filter response: {json_dumps(data_no_filter, truncate_fields=['vector_embedding'])}")

    # Check if we have any results without year filter
    if data_no_filter["pravachan_results"]["total_hits"] > 0:
        # Log what dates are actually in the results
        for result in data_no_filter["pravachan_results"]["results"]:
            date = result.get("chunk_labels", {}).get("date")
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
    data = consume_sse(response)
    log_handle.info(f"Year filter (1985) response: {json_dumps(data, truncate_fields=['vector_embedding'])}")

    # Validate response structure
    validate_result_schema(data, True)

    # Should have results from 1985
    assert data["pravachan_results"]["total_hits"] > 0, "Expected results for year 1985"

    # Validate all results have dates in 1985
    for result in data["pravachan_results"]["results"]:
        chunk_labels = result.get("chunk_labels", {})
        date = chunk_labels.get("date")
        assert date is not None, f"Expected chunk_labels.date in result {result.get('document_id')}"

        # Extract year from date (format: YYYY-MM-DD)
        year = date.split("-")[0]
        assert year == "1985", f"Expected year 1985, got {year} for result with date {date}"

        # Should be from hampi_hindi.pdf
        assert "hampi_hindi.pdf" in result["filename"], \
            f"Expected result from hampi_hindi.pdf, got {result['filename']}"

        # hampi_hindi has volume=3 set in its scan_config entry
        assert result.get("metadata", {}).get("volume") == 3, \
            f"Expected metadata.volume=3 for hampi_hindi result, got {result.get('metadata', {}).get('volume')}"

        log_handle.info(f"✓ Result: file={result['filename']}, page={result.get('page_number')}, date={date}, volume={result.get('metadata', {}).get('volume')}")

    log_handle.info(f"✓ Year filter test (1985) passed - found {data['pravachan_results']['total_hits']} results, all from 1985 with volume=3")


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
    data = consume_sse(response)
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
        date = result.get("chunk_labels", {}).get("date")
        assert date is not None, f"Expected chunk_labels.date in result {result.get('document_id')}"

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

    data = consume_sse(response)
    assert data["pravachan_results"]["total_hits"] > 0, \
        "Expected to find results via series date filtering"

    # Verify the results have series dates
    results = data["pravachan_results"]["results"]
    assert len(results) > 0, "Expected at least one result"

    for result in results:
        log_handle.info(
            f"Result: file={result['filename']}, page={result.get('page_number')}, "
            f"date={result.get('chunk_labels', {}).get('date')}, series_start={result.get('series_start_date')}, "
            f"series_end={result.get('series_end_date')}, Anuyog={result.get('metadata', {}).get('Anuyog')}")

        # Should be from spiritual files (which have series dates but no bookmark dates)
        assert result.get('metadata', {}).get('Anuyog') == 'spiritual', \
            f"Expected spiritual Anuyog, got {result.get('metadata', {}).get('Anuyog')}"

        # Document date should be None (no bookmarks)
        assert result.get('chunk_labels', {}).get('date') is None, \
            f"Expected no document date (no bookmarks), got {result.get('chunk_labels', {}).get('date')}"

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

    data = consume_sse(response)

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
            f"date={result.get('chunk_labels', {}).get('date')}, series_start={result.get('series_start_date')}, "
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
        if result.get('chunk_labels', {}).get('date'):
            pages_with_dates.append((page_num, result.get('chunk_labels', {}).get('date')))
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

    data = consume_sse(response)

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
            f"date={result.get('chunk_labels', {}).get('date')}, series_start={result.get('series_start_date')}, "
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
        chunk_date = result.get('chunk_labels', {}).get('date')
        if chunk_date:
            pages_with_dates[page_num] = chunk_date
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


# ── Agent Router Tests ────────────────────────────────────────────────────────
# The search_api app mounts the agent router at /api/agent/*, so the same
# server and indexed data used by the tests above are reused here.

_AGENT_BASE = "http://{host}:{port}/api/agent"


def _agent_url(api_server, path):
    return f"http://{api_server.host}:{api_server.port}/api/agent{path}"


def _agent_search(api_server, query, language="hi", content_type=None, rerank=False, page_size=5, chat_request_id=None):
    payload = {
        "query": query,
        "language": language,
        "content_type": content_type or ["Pravachan"],
        "page_size": page_size,
        "page": 1,
        "rerank": rerank,
    }
    headers = {}
    if chat_request_id:
        headers["X-Chat-Request-Id"] = chat_request_id
    return requests.post(_agent_url(api_server, "/search"), json=payload, headers=headers)


def test_agent_search_lexical(api_server):
    """Agent /search returns a list of chunks for a short lexical query."""
    resp = _agent_search(api_server, "इंदौर", chat_request_id="pytest-chat-req-001")
    assert resp.status_code == 200
    results = resp.json()
    assert isinstance(results, list)
    assert len(results) > 0

    chunk = results[0]
    for field in ("chunk_id", "text_content", "category", "language", "score", "file_url"):
        assert field in chunk, f"Missing field '{field}' in agent search result"

    assert chunk["category"] == "Pravachan"
    assert chunk["language"] == "hi"
    assert chunk["score"] >= 0
    log_handle.info(f"✓ agent_search lexical returned {len(results)} results")


def test_agent_search_vector(api_server):
    """Agent /search switches to vector mode for a natural-language query."""
    # Trailing '?' makes is_lexical_query return False → vector search
    resp = _agent_search(api_server, "इंदौर का इतिहास क्या है?", rerank=False)
    assert resp.status_code == 200
    results = resp.json()
    assert isinstance(results, list)
    assert len(results) > 0
    log_handle.info(f"✓ agent_search vector returned {len(results)} results")


def test_agent_search_with_anuyog_filter(api_server):
    """Agent /search honours the anuyog filter."""
    payload = {
        "query": "इतिहास",
        "language": "hi",
        "content_type": ["Pravachan"],
        "anuyog": "history",
        "page_size": 10,
        "page": 1,
        "rerank": False,
    }
    resp = requests.post(_agent_url(api_server, "/search"), json=payload)
    assert resp.status_code == 200
    results = resp.json()
    assert isinstance(results, list)
    # All returned chunks should have anuyog == "history"
    for r in results:
        assert r.get("anuyog") == "history", f"Unexpected anuyog: {r.get('anuyog')}"
    log_handle.info(f"✓ agent_search anuyog filter returned {len(results)} results")


def test_agent_search_gujarati(api_server):
    """Agent /search works for Gujarati language content."""
    resp = _agent_search(api_server, "ઇતિહાસ", language="gu")
    assert resp.status_code == 200
    results = resp.json()
    assert isinstance(results, list)
    log_handle.info(f"✓ agent_search Gujarati returned {len(results)} results")


def test_agent_navigate(api_server):
    """Agent /navigate returns surrounding chunks for a valid chunk_id."""
    # Get a real chunk_id from search first
    resp = _agent_search(api_server, "इंदौर", page_size=1)
    assert resp.status_code == 200
    results = resp.json()
    if not results:
        pytest.skip("No search results; cannot test navigate")

    chunk_id = results[0]["chunk_id"]
    nav_resp = requests.post(_agent_url(api_server, "/navigate"), json={
        "chunk_id": chunk_id,
        "direction": "both",
        "steps": 1,
    })
    assert nav_resp.status_code == 200
    nav_results = nav_resp.json()
    assert isinstance(nav_results, list)
    # The current chunk should be among the returned results
    returned_ids = [r["chunk_id"] for r in nav_results]
    assert chunk_id in returned_ids, f"Expected {chunk_id} in navigate results {returned_ids}"
    log_handle.info(f"✓ agent_navigate returned {len(nav_results)} chunks around {chunk_id}")


def test_agent_navigate_next_and_prev(api_server):
    """Agent /navigate works for direction=next and direction=prev."""
    resp = _agent_search(api_server, "बेंगलुरु", page_size=1)
    assert resp.status_code == 200
    results = resp.json()
    if not results:
        pytest.skip("No search results; cannot test navigate")

    chunk_id = results[0]["chunk_id"]

    for direction in ("next", "prev"):
        nav_resp = requests.post(_agent_url(api_server, "/navigate"), json={
            "chunk_id": chunk_id,
            "direction": direction,
            "steps": 1,
        })
        assert nav_resp.status_code == 200
        assert isinstance(nav_resp.json(), list)

    log_handle.info("✓ agent_navigate next/prev both succeeded")


def test_agent_find_similar(api_server):
    """Agent /find_similar returns semantically related chunks."""
    resp = _agent_search(api_server, "हिंदू पौराणिक", page_size=1)
    assert resp.status_code == 200
    results = resp.json()
    if not results:
        pytest.skip("No search results; cannot test find_similar")

    chunk_id = results[0]["chunk_id"]
    sim_resp = requests.post(_agent_url(api_server, "/find_similar"), json={"chunk_id": chunk_id})
    assert sim_resp.status_code == 200
    sim_results = sim_resp.json()
    assert isinstance(sim_results, list)
    # The source chunk itself should not appear in similar results
    returned_ids = [r["chunk_id"] for r in sim_results]
    assert chunk_id not in returned_ids, "Source chunk should be excluded from find_similar results"
    log_handle.info(f"✓ agent_find_similar returned {len(sim_results)} similar chunks for {chunk_id}")


def test_agent_get_filter_options_pravachan(api_server):
    """Agent /get_filter_options returns correct keys for Pravachan/hi."""
    resp = requests.post(_agent_url(api_server, "/get_filter_options"), json={
        "language": "hi",
        "content_type": "Pravachan",
    })
    assert resp.status_code == 200
    data = resp.json()

    for key in ("granths", "anuyogs", "contributors", "date_ranges"):
        assert key in data, f"Missing key '{key}' in filter options"

    assert isinstance(data["granths"], list)
    assert isinstance(data["anuyogs"], list)

    # Known anuyog values from test data
    assert "history" in data["anuyogs"], f"Expected 'history' in anuyogs: {data['anuyogs']}"
    assert "city" in data["anuyogs"], f"Expected 'city' in anuyogs: {data['anuyogs']}"

    # Known granth from test data
    assert "Hampi" in data["granths"], f"Expected 'Hampi' in granths: {data['granths']}"
    log_handle.info(f"✓ agent_get_filter_options returned granths={data['granths']}, anuyogs={data['anuyogs']}")


def test_agent_get_filter_options_gujarati(api_server):
    """Agent /get_filter_options works for Gujarati language."""
    resp = requests.post(_agent_url(api_server, "/get_filter_options"), json={
        "language": "gu",
        "content_type": "Pravachan",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert "granths" in data
    assert "anuyogs" in data
    log_handle.info(f"✓ agent_get_filter_options Gujarati returned {len(data['granths'])} granths")


def test_agent_get_pravachan(api_server):
    """Agent /get_pravachan returns all chunks for a known Pravachan in order."""
    # hampi_hindi has bookmark: page 2 → "prav number 248, 1985-10-23"
    resp = requests.post(_agent_url(api_server, "/get_pravachan"), json={
        "granth": "Hampi",
        "pravachan_number": "248",
        "language": "hi",
    })
    assert resp.status_code == 200
    results = resp.json()
    assert isinstance(results, list)
    if results:
        # All returned chunks should belong to Hampi and be in paragraph order
        para_ids = [r.get("page_number") for r in results]
        log_handle.info(f"✓ agent_get_pravachan returned {len(results)} chunks, pages={para_ids}")
    else:
        log_handle.info("agent_get_pravachan returned 0 results (pravachan_number may not be parsed)")


def test_agent_get_pravachan_empty_for_unknown(api_server):
    """Agent /get_pravachan returns empty list for a nonexistent pravachan."""
    resp = requests.post(_agent_url(api_server, "/get_pravachan"), json={
        "granth": "NonExistentGranth",
        "pravachan_number": "9999",
        "language": "hi",
    })
    assert resp.status_code == 200
    assert resp.json() == []
    log_handle.info("✓ agent_get_pravachan returned [] for unknown granth/pravachan")


def test_agent_search_with_year_range(api_server):
    """Agent /search with year_from + year_to applies the full date range filter."""
    resp = requests.post(_agent_url(api_server, "/search"), json={
        "query": "हंपी",
        "language": "hi",
        "content_type": ["Pravachan"],
        "year_from": 1985,
        "year_to": 1986,
        "page_size": 10,
        "page": 1,
        "rerank": False,
    })
    assert resp.status_code == 200
    results = resp.json()
    assert isinstance(results, list)
    # Any dated results must fall within the requested range
    for r in results:
        if r.get("date"):
            year = int(r["date"][:4])
            assert 1985 <= year <= 1986, f"Date outside filter range: {r['date']}"
    log_handle.info(f"✓ agent_search year_from=1985 year_to=1986 returned {len(results)} results")


def test_agent_search_with_year_from_only(api_server):
    """Agent /search with only year_from — covers the one-sided date range path."""
    resp = requests.post(_agent_url(api_server, "/search"), json={
        "query": "इतिहास",
        "language": "hi",
        "content_type": ["Pravachan"],
        "year_from": 1985,
        "page_size": 5,
        "page": 1,
        "rerank": False,
    })
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)
    log_handle.info("✓ agent_search year_from=1985 (no year_to) returned results")


def test_agent_search_with_year_to_only(api_server):
    """Agent /search with only year_to — covers the other one-sided date range path."""
    resp = requests.post(_agent_url(api_server, "/search"), json={
        "query": "इतिहास",
        "language": "hi",
        "content_type": ["Pravachan"],
        "year_to": 1986,
        "page_size": 5,
        "page": 1,
        "rerank": False,
    })
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)
    log_handle.info("✓ agent_search year_to=1986 (no year_from) returned results")


def test_agent_search_with_rerank(api_server):
    """Agent /search with rerank=True exercises the cross-encoder reranker pipeline."""
    resp = requests.post(_agent_url(api_server, "/search"), json={
        "query": "इंदौर का इतिहास क्या है?",
        "language": "hi",
        "content_type": ["Pravachan"],
        "page_size": 5,
        "page": 1,
        "rerank": True,
    })
    assert resp.status_code == 200
    results = resp.json()
    assert isinstance(results, list)
    if results:
        chunk = results[0]
        for field in ("chunk_id", "text_content", "score"):
            assert field in chunk
        assert isinstance(chunk["score"], float)
    log_handle.info(f"✓ agent_search rerank=True returned {len(results)} results")


def test_agent_search_with_contributor_filter(api_server):
    """Agent /search with contributor builds the multi-field bool/should query without error."""
    # Test data has no Author/Tikakaar metadata so 0 results is expected —
    # the point is that the filter construction runs end-to-end.
    resp = requests.post(_agent_url(api_server, "/search"), json={
        "query": "इतिहास",
        "language": "hi",
        "content_type": ["Pravachan"],
        "contributor": "TestAuthor",
        "page_size": 5,
        "page": 1,
        "rerank": False,
    })
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)
    log_handle.info("✓ agent_search contributor filter ran without error")


# ---------------------------------------------------------------------------
# Admin API tests
# ---------------------------------------------------------------------------

_ADMIN_TEST_KEY = "test-admin-secret"


def test_admin_auth_no_key(api_server):
    """Auth returns 503 when ADMIN_KEY env var is not set."""
    os.environ.pop("ADMIN_KEY", None)
    response = requests.post(
        f"http://{api_server.host}:{api_server.port}/api/admin/auth",
        json={"key_hash": "doesnotmatter"},
    )
    assert response.status_code == 503


def test_admin_auth_success(api_server):
    """Auth returns a token when the correct SHA-256 hash is supplied."""
    global _admin_token
    os.environ["ADMIN_KEY"] = _ADMIN_TEST_KEY
    key_hash = hashlib.sha256(_ADMIN_TEST_KEY.encode()).hexdigest()
    response = requests.post(
        f"http://{api_server.host}:{api_server.port}/api/admin/auth",
        json={"key_hash": key_hash},
    )
    assert response.status_code == 200
    data = response.json()
    assert "token" in data
    _admin_token = data["token"]
    log_handle.info("✓ admin auth succeeded, token acquired")


def test_admin_config_update(api_server):
    """POST /admin/config sets page_size_pravachan=3; GET /admin/config reflects it."""
    auth = {"Authorization": f"Bearer {_admin_token}"}

    update_resp = requests.post(
        f"http://{api_server.host}:{api_server.port}/api/admin/config",
        json={"page_size_pravachan": 3},
        headers=auth,
    )
    assert update_resp.status_code == 200
    assert update_resp.json()["overrides"]["page_size_pravachan"] == 3

    get_resp = requests.get(
        f"http://{api_server.host}:{api_server.port}/api/admin/config",
        headers=auth,
    )
    assert get_resp.status_code == 200
    cfg = get_resp.json()
    assert cfg["overrides"]["page_size_pravachan"] == 3
    assert cfg["effective"]["page_size_pravachan"] == 3
    log_handle.info("✓ admin config update reflected in GET /admin/config")


def test_admin_config_affects_search(api_server):
    """/api/config exposes the override; search with page_size=3 returns ≤3 results."""
    auth = {"Authorization": f"Bearer {_admin_token}"}
    try:
        app_cfg = requests.get(
            f"http://{api_server.host}:{api_server.port}/api/config"
        ).json()
        assert app_cfg["page_size_pravachan"] == 3

        search_payload = {
            "query": "बेंगलुरु",
            "language": "hi",
            "exact_match": False,
            "exclude_words": [],
            "categories": {},
            "search_types": {
                "Pravachan": {"enabled": True, "page_size": 3, "page_number": 1},
                "Granth":    {"enabled": False, "page_size": 3, "page_number": 1},
            },
            "enable_reranking": False,
        }
        search_resp = requests.post(
            f"http://{api_server.host}:{api_server.port}/api/search",
            json=search_payload,
        )
        assert search_resp.status_code == 200
        data = consume_sse(search_resp)
        results = data["pravachan_results"]["results"]
        assert len(results) <= 3
        log_handle.info("✓ search with page_size=3 returned %d results (≤3)", len(results))
    finally:
        reset_resp = requests.delete(
            f"http://{api_server.host}:{api_server.port}/api/admin/config",
            headers=auth,
        )
        assert reset_resp.status_code == 200
        log_handle.info("✓ admin config reset after test")


def test_admin_search_mode_rrf(api_server):
    """Setting search_mode=rrf triggers RRF fusion; results carry lexical_score + vector_score."""
    # Acquire a fresh token (test may run standalone without test_admin_auth_success)
    os.environ["ADMIN_KEY"] = _ADMIN_TEST_KEY
    key_hash = hashlib.sha256(_ADMIN_TEST_KEY.encode()).hexdigest()
    token = requests.post(
        f"http://{api_server.host}:{api_server.port}/api/admin/auth",
        json={"key_hash": key_hash},
    ).json()["token"]
    auth = {"Authorization": f"Bearer {token}"}
    try:
        # Switch to RRF mode
        update_resp = requests.post(
            f"http://{api_server.host}:{api_server.port}/api/admin/config",
            json={"search_mode": "rrf"},
            headers=auth,
        )
        assert update_resp.status_code == 200

        # Confirm /api/config reflects it
        app_cfg = requests.get(
            f"http://{api_server.host}:{api_server.port}/api/config"
        ).json()
        assert app_cfg["effective_mode"] == "rrf"

        # Use a short query that auto-mode would classify as lexical —
        # in RRF mode it must go through rrf_rank regardless.
        search_payload = {
            "query": "बेंगलुरु",
            "language": "hi",
            "exact_match": False,
            "exclude_words": [],
            "categories": {},
            "search_types": {
                "Pravachan": {"enabled": True, "page_size": 5, "page_number": 1},
                "Granth":    {"enabled": False, "page_size": 5, "page_number": 1},
            },
            "enable_reranking": False,
        }
        search_resp = requests.post(
            f"http://{api_server.host}:{api_server.port}/api/search",
            json=search_payload,
        )
        assert search_resp.status_code == 200
        data = consume_sse(search_resp)
        results = data["pravachan_results"]["results"]
        assert len(results) > 0, "Expected results in RRF mode"

        # rrf_rank stamps lexical_score and vector_score on every result —
        # these fields prove the RRF code path ran (not lexical or vector-only).
        for r in results:
            assert "lexical_score" in r, f"Result missing lexical_score: {r.get('document_id')}"
            assert "vector_score" in r, f"Result missing vector_score: {r.get('document_id')}"

        log_handle.info("✓ RRF mode: %d results, all carry lexical_score + vector_score", len(results))
    finally:
        reset_resp = requests.delete(
            f"http://{api_server.host}:{api_server.port}/api/admin/config",
            headers=auth,
        )
        assert reset_resp.status_code == 200
        log_handle.info("✓ admin config reset after RRF test")


def test_metrics_db_state(api_server):
    """Verify SQLite metrics DB is populated correctly by all prior tests.

    This test MUST run last — it inspects the DB written by the live server
    that was exercised by all the preceding test functions.
    """
    logs_dir = os.environ.get("LOGS_DIR", "logs")
    db_path = os.path.join(logs_dir, "metrics.db")
    assert os.path.exists(db_path), f"metrics.db not found at {db_path}"

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute("SELECT * FROM search_metrics").fetchall()
        assert len(rows) >= 10, f"Expected ≥10 rows, got {len(rows)}"

        valid_modes = {"lexical", "vector", "rrf"}
        valid_langs = {"hi", "gu"}
        for r in rows:
            assert r["latency_ms"] is not None and r["latency_ms"] > 0, (
                f"Row {r['query_id']} has bad latency_ms: {r['latency_ms']}"
            )
            assert r["total_hits"] is not None, f"Row {r['query_id']} has NULL total_hits"
            assert r["search_mode"] in valid_modes, (
                f"Row {r['query_id']} has unexpected search_mode: {r['search_mode']!r}"
            )
            assert r["language"] in valid_langs, (
                f"Row {r['query_id']} has un-normalised language: {r['language']!r}"
            )
            assert r["source"] is not None, f"Row {r['query_id']} has NULL source"

        # Agent rows
        agent_rows = [r for r in rows if r["source"] == "agent"]
        assert len(agent_rows) >= 5, f"Expected ≥5 agent rows, got {len(agent_rows)}"

        # chat_request_id linkage: at least one row carries the sentinel id
        # (agent auto-mode may write multiple rows per request — one per search probe)
        linked = [r for r in rows if r["chat_request_id"] == "pytest-chat-req-001"]
        assert len(linked) >= 1, (
            f"Expected ≥1 row with chat_request_id='pytest-chat-req-001', got {len(linked)}"
        )

        # All other rows must have chat_request_id = NULL
        unlinked_with_id = [
            r for r in rows
            if r["chat_request_id"] is not None and r["chat_request_id"] != "pytest-chat-req-001"
        ]
        assert len(unlinked_with_id) == 0, (
            f"Unexpected non-null chat_request_id values: {[r['chat_request_id'] for r in unlinked_with_id]}"
        )

        # At least one non-agent row should have ttfb_ms recorded
        ttfb_rows = [r for r in rows if r["source"] != "agent" and r["ttfb_ms"] is not None]
        assert len(ttfb_rows) >= 1, "Expected ≥1 non-agent row with ttfb_ms set"

    finally:
        conn.close()

    log_handle.info(f"✓ metrics_db_state: {len(rows)} rows validated")


# ---------------------------------------------------------------------------
# Admin API — additional coverage
# ---------------------------------------------------------------------------

def _admin_url(api_server, path):
    return f"http://{api_server.host}:{api_server.port}/api{path}"


def _get_admin_token(api_server):
    """Acquire a fresh admin token. Sets ADMIN_KEY env var as a side effect."""
    os.environ["ADMIN_KEY"] = _ADMIN_TEST_KEY
    key_hash = hashlib.sha256(_ADMIN_TEST_KEY.encode()).hexdigest()
    resp = requests.post(_admin_url(api_server, "/admin/auth"), json={"key_hash": key_hash})
    assert resp.status_code == 200
    return resp.json()["token"]


def test_admin_auth_wrong_key(api_server):
    """Wrong hash → 401."""
    os.environ["ADMIN_KEY"] = _ADMIN_TEST_KEY
    resp = requests.post(
        _admin_url(api_server, "/admin/auth"),
        json={"key_hash": "a" * 64},
    )
    assert resp.status_code == 401


def test_admin_missing_token(api_server):
    """Requests without Authorization header → 401."""
    resp = requests.get(_admin_url(api_server, "/admin/config"))
    assert resp.status_code == 401


def test_admin_invalid_token(api_server):
    """Requests with a bogus Bearer token → 401."""
    resp = requests.get(
        _admin_url(api_server, "/admin/config"),
        headers={"Authorization": "Bearer notarealtoken"},
    )
    assert resp.status_code == 401


def test_admin_config_get_structure(api_server):
    """GET /admin/config returns defaults, overrides, and effective keys."""
    token = _get_admin_token(api_server)
    auth = {"Authorization": f"Bearer {token}"}
    resp = requests.get(_admin_url(api_server, "/admin/config"), headers=auth)
    assert resp.status_code == 200
    body = resp.json()
    assert "defaults" in body
    assert "overrides" in body
    assert "effective" in body
    assert "search_mode" in body["defaults"]


def test_admin_config_unknown_key_rejected(api_server):
    """POST /admin/config with an unknown key → 400."""
    token = _get_admin_token(api_server)
    auth = {"Authorization": f"Bearer {token}"}
    resp = requests.post(
        _admin_url(api_server, "/admin/config"),
        json={"nonexistent_param": 99},
        headers=auth,
    )
    assert resp.status_code == 400
    assert "Unknown keys" in resp.json()["detail"]


def test_admin_config_reset_single_key(api_server):
    """DELETE /admin/config/{key} resets only that key."""
    token = _get_admin_token(api_server)
    auth = {"Authorization": f"Bearer {token}"}
    # Set an override
    requests.post(
        _admin_url(api_server, "/admin/config"),
        json={"page_size_granth": 3},
        headers=auth,
    )
    # Reset just that key
    resp = requests.delete(_admin_url(api_server, "/admin/config/page_size_granth"), headers=auth)
    assert resp.status_code == 200
    assert resp.json()["key"] == "page_size_granth"
    # Confirm it's gone from overrides
    get_resp = requests.get(_admin_url(api_server, "/admin/config"), headers=auth)
    assert "page_size_granth" not in get_resp.json()["overrides"]


def test_admin_config_reset_unknown_key(api_server):
    """DELETE /admin/config/{unknown_key} → 400."""
    token = _get_admin_token(api_server)
    auth = {"Authorization": f"Bearer {token}"}
    resp = requests.delete(_admin_url(api_server, "/admin/config/no_such_key"), headers=auth)
    assert resp.status_code == 400


def test_admin_agent_config_get(api_server):
    """GET /admin/agent-config returns defaults, overrides, effective."""
    token = _get_admin_token(api_server)
    auth = {"Authorization": f"Bearer {token}"}
    resp = requests.get(_admin_url(api_server, "/admin/agent-config"), headers=auth)
    assert resp.status_code == 200
    body = resp.json()
    assert "defaults" in body
    assert "overrides" in body
    assert "effective" in body
    assert "rerank_oversample" in body["defaults"]


def test_admin_agent_config_update(api_server):
    """POST /admin/agent-config sets a value; GET reflects it."""
    token = _get_admin_token(api_server)
    auth = {"Authorization": f"Bearer {token}"}
    try:
        resp = requests.post(
            _admin_url(api_server, "/admin/agent-config"),
            json={"rerank_batch_size": 2},
            headers=auth,
        )
        assert resp.status_code == 200
        assert resp.json()["overrides"]["rerank_batch_size"] == 2

        get_resp = requests.get(_admin_url(api_server, "/admin/agent-config"), headers=auth)
        assert get_resp.json()["effective"]["rerank_batch_size"] == 2
    finally:
        requests.delete(_admin_url(api_server, "/admin/agent-config"), headers=auth)


def test_admin_agent_config_unknown_key_rejected(api_server):
    """POST /admin/agent-config with an unknown key → 400."""
    token = _get_admin_token(api_server)
    auth = {"Authorization": f"Bearer {token}"}
    resp = requests.post(
        _admin_url(api_server, "/admin/agent-config"),
        json={"no_such_key": 1},
        headers=auth,
    )
    assert resp.status_code == 400
    assert "Unknown agent config keys" in resp.json()["detail"]


def test_admin_agent_config_reset_all(api_server):
    """DELETE /admin/agent-config clears all agent overrides."""
    token = _get_admin_token(api_server)
    auth = {"Authorization": f"Bearer {token}"}
    requests.post(
        _admin_url(api_server, "/admin/agent-config"),
        json={"rerank_batch_size": 2},
        headers=auth,
    )
    resp = requests.delete(_admin_url(api_server, "/admin/agent-config"), headers=auth)
    assert resp.status_code == 200
    get_resp = requests.get(_admin_url(api_server, "/admin/agent-config"), headers=auth)
    assert get_resp.json()["overrides"] == {}


def test_admin_agent_config_reset_single_key(api_server):
    """DELETE /admin/agent-config/{key} resets only that key."""
    token = _get_admin_token(api_server)
    auth = {"Authorization": f"Bearer {token}"}
    try:
        requests.post(
            _admin_url(api_server, "/admin/agent-config"),
            json={"rerank_batch_size": 2, "rerank_max_length": 500},
            headers=auth,
        )
        resp = requests.delete(
            _admin_url(api_server, "/admin/agent-config/rerank_batch_size"),
            headers=auth,
        )
        assert resp.status_code == 200
        assert resp.json()["key"] == "rerank_batch_size"
        get_resp = requests.get(_admin_url(api_server, "/admin/agent-config"), headers=auth)
        overrides = get_resp.json()["overrides"]
        assert "rerank_batch_size" not in overrides
        assert "rerank_max_length" in overrides  # other key untouched
    finally:
        requests.delete(_admin_url(api_server, "/admin/agent-config"), headers=auth)


def test_admin_agent_config_reset_unknown_key(api_server):
    """DELETE /admin/agent-config/{unknown} → 400."""
    token = _get_admin_token(api_server)
    auth = {"Authorization": f"Bearer {token}"}
    resp = requests.delete(
        _admin_url(api_server, "/admin/agent-config/no_such_key"),
        headers=auth,
    )
    assert resp.status_code == 400


def test_admin_cache_clear(api_server):
    """POST /admin/cache/clear returns 200 (live OS) or 503 (network error)."""
    token = _get_admin_token(api_server)
    auth = {"Authorization": f"Bearer {token}"}
    resp = requests.post(_admin_url(api_server, "/admin/cache/clear"), headers=auth)
    assert resp.status_code in (200, 503)


# ---------------------------------------------------------------------------
# Analytics endpoint coverage
# ---------------------------------------------------------------------------

def test_analytics_requires_auth(api_server):
    """GET /admin/analytics without token → 401."""
    resp = requests.get(_admin_url(api_server, "/admin/analytics"))
    assert resp.status_code == 401


def test_analytics_basic_structure(api_server):
    """GET /admin/analytics returns expected top-level keys and types."""
    token = _get_admin_token(api_server)
    auth = {"Authorization": f"Bearer {token}"}
    resp = requests.get(_admin_url(api_server, "/admin/analytics"), headers=auth)
    assert resp.status_code == 200
    body = resp.json()
    assert "total" in body
    assert "sources" in body
    assert "by_day" in body
    assert "queries" in body
    assert isinstance(body["total"], int)
    assert isinstance(body["sources"], list)
    assert isinstance(body["by_day"], list)
    assert isinstance(body["queries"], list)
    assert body["total"] >= 0


def test_analytics_date_filter(api_server):
    """from_date + to_date narrows the result set (today's date → should include test rows)."""
    from datetime import date
    token = _get_admin_token(api_server)
    auth = {"Authorization": f"Bearer {token}"}
    today = date.today().isoformat()
    resp = requests.get(
        _admin_url(api_server, "/admin/analytics"),
        params={"from_date": today, "to_date": today},
        headers=auth,
    )
    assert resp.status_code == 200
    body = resp.json()
    # Rows were inserted by today's test run → should find some
    assert body["total"] >= 1
    # by_day entries must be on or after from_date
    for entry in body["by_day"]:
        assert entry["date"] >= today


def test_analytics_invalid_date_format(api_server):
    """from_date with bad format → 400."""
    token = _get_admin_token(api_server)
    auth = {"Authorization": f"Bearer {token}"}
    resp = requests.get(
        _admin_url(api_server, "/admin/analytics"),
        params={"from_date": "not-a-date"},
        headers=auth,
    )
    assert resp.status_code == 400
    assert "from_date" in resp.json()["detail"]


def test_analytics_to_date_invalid_format(api_server):
    """to_date with bad format → 400."""
    token = _get_admin_token(api_server)
    auth = {"Authorization": f"Bearer {token}"}
    resp = requests.get(
        _admin_url(api_server, "/admin/analytics"),
        params={"to_date": "2026/01/01"},
        headers=auth,
    )
    assert resp.status_code == 400


def test_analytics_date_order_violation(api_server):
    """from_date > to_date → 400."""
    token = _get_admin_token(api_server)
    auth = {"Authorization": f"Bearer {token}"}
    resp = requests.get(
        _admin_url(api_server, "/admin/analytics"),
        params={"from_date": "2026-12-31", "to_date": "2026-01-01"},
        headers=auth,
    )
    assert resp.status_code == 400
    assert "from_date" in resp.json()["detail"]


def test_analytics_source_filter(api_server):
    """?source=agent returns only agent rows."""
    token = _get_admin_token(api_server)
    auth = {"Authorization": f"Bearer {token}"}
    resp = requests.get(
        _admin_url(api_server, "/admin/analytics"),
        params={"source": "agent"},
        headers=auth,
    )
    assert resp.status_code == 200
    body = resp.json()
    for q in body["queries"]:
        assert q["source"] == "agent"


def test_analytics_language_filter(api_server):
    """?language=hi returns only hi rows."""
    token = _get_admin_token(api_server)
    auth = {"Authorization": f"Bearer {token}"}
    resp = requests.get(
        _admin_url(api_server, "/admin/analytics"),
        params={"language": "hi"},
        headers=auth,
    )
    assert resp.status_code == 200
    body = resp.json()
    for q in body["queries"]:
        assert q["language"] == "hi"


def test_analytics_sources_field_is_unfiltered(api_server):
    """The 'sources' field always returns all distinct sources, regardless of ?source filter."""
    token = _get_admin_token(api_server)
    auth = {"Authorization": f"Bearer {token}"}
    # Get all sources first
    all_resp = requests.get(_admin_url(api_server, "/admin/analytics"), headers=auth)
    all_sources = set(all_resp.json()["sources"])
    # Filter to a single source
    filtered_resp = requests.get(
        _admin_url(api_server, "/admin/analytics"),
        params={"source": "agent"},
        headers=auth,
    )
    assert filtered_resp.status_code == 200
    # sources in filtered response should equal the unfiltered list
    assert set(filtered_resp.json()["sources"]) == all_sources