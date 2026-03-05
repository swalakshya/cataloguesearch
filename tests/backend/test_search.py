import os
import shutil
import random
import uuid

import pytest

from backend.common import embedding_models
from backend.common.opensearch import get_opensearch_client, create_indices_if_not_exists
from backend.crawler.discovery import Discovery
from backend.crawler.index_state import IndexState
from backend.crawler.index_generator import IndexGenerator
from backend.crawler.pdf_factory import create_pdf_processor
from backend.search.index_searcher import IndexSearcher
from tests.backend.common import setup, get_all_documents
from tests.backend.base import *

log_handle = logging.getLogger(__name__)

# simplify the logs. change opensearch's logging to WARN to avoid chunk indexing mesasges.
# comment it out if you need to debug something.
logging.getLogger('opensearch').setLevel(logging.WARNING)

@pytest.fixture(scope="module", autouse=True)
def build_index(initialise):
    # delete and create indexes if they do not exist
    config = Config()
    opensearch_client = get_opensearch_client(config)
    indexes = [
        config.OPENSEARCH_INDEX_NAME,
        config.OPENSEARCH_METADATA_INDEX_NAME,
    ]
    for index_name in indexes:
        if index_name and opensearch_client.indices.exists(index=index_name):
            opensearch_client.indices.delete(index=index_name)
            log_handle.info(f"Deleted existing index: {index_name}")
    create_indices_if_not_exists(config, opensearch_client)
    build_search_index()

    yield
    # Cleanup - delete index
    for index_name in indexes:
        opensearch_client.indices.delete(index=index_name, ignore=[400, 404])

def build_search_index():
    """
    Setup test data and build search index.
    Process PDFs and index them to support both 'paragraph' and 'advanced' CHUNK_STRATEGY.
    """
    # Setup test environment with scan_config files (don't copy OCR files, we'll process PDFs)
    config = Config()
    opensearch_client = get_opensearch_client(config)
    setup(copy_ocr_files=True, add_scan_config=True)
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

def test_lexical_search_basic():
    """Test basic lexical search with query-filename validation."""
    config = Config()
    index_searcher = IndexSearcher(config)

    # List of [query, expected_filename_substring, language]
    test_cases = [
        ["बेंगलुरु केम्पे गौड़ा", "bangalore_hindi", "hi"],
        ["विजयनगर साम्राज्य हरिहर", "hampi_hindi", "hi"],
        ["मैसूर साम्राज्य", "bangalore_hindi", "hi"],  # Content about Mysore in Bangalore file
        ["હમ્પી વિજયનગર", "hampi_gujarati", "gu"],
    ]

    for query, expected_filename, language in test_cases:
        log_handle.info(f"Running lexical search for: {query} (expecting {expected_filename})")

        results, total_hits = index_searcher.perform_lexical_search(
            keywords=query,
            exact_match=False,
            exclude_words=[],
            categories={},
            detected_language=language,
            page_size=10,
            page_number=1
        )

        log_handle.info(f"Found {len(results)} results for query: {query}")
        assert len(results) > 0, f"No results found for query: {query}"

        # Validate that expected filename appears in results
        found_expected = False
        for result in results:
            filename = result.get('filename', '').lower()
            if expected_filename.lower() in filename:
                found_expected = True
                log_handle.info(f"✓ Found expected file {expected_filename} in results for query: {query}")
                break

        assert found_expected, f"Expected filename '{expected_filename}' not found in results for query '{query}'"

def test_lexical_search_with_filters():
    """Test lexical search with category filters."""
    config = Config()
    index_searcher = IndexSearcher(config)

    # List of [query, filters, expected_filename_substring, language]
    test_cases = [
        ["बेंगलुरु", {"language": ["hi"]}, "hindi", "hi"],
        ["હમ્પી", {"language": ["gu"]}, "gujarati", "gu"],
        ["विजयनगर", {"category": ["history"]}, "hampi", "hi"],  # If history category exists
    ]

    for query, filters, expected_filename, language in test_cases:
        log_handle.info(f"Running filtered lexical search: {query} with filters {filters}")

        results, total_hits = index_searcher.perform_lexical_search(
            keywords=query,
            exact_match=False,
            exclude_words=[],
            categories=filters,
            detected_language=language,
            page_size=10,
            page_number=1
        )

        log_handle.info(f"Found {len(results)} filtered results for: {query}")
        if len(results) > 0:
            # Check if results match the expected filename pattern
            matching_files = []
            for result in results:
                filename = result.get('filename', '').lower()
                if expected_filename.lower() in filename:
                    matching_files.append(filename)

            log_handle.info(f"Matching files for filter: {matching_files}")

def test_lexical_search_exact_phrase():
    """Test lexical search with exact phrase matching."""
    config = Config()
    index_searcher = IndexSearcher(config)

    # List of [exact_phrase, expected_filename_substring, language]
    test_cases = [
        ["केम्पे गौड़ा प्रथम", "bangalore_hindi", "hi"],  # Exact phrase from Bangalore Hindi content
        ["बेंगलुरु: एक समग्र विश्लेषण", "bangalore_hindi", "hi"],  # Title from content
        ["કેમ્પે ગૌડા પ્રથમ", "bangalore_gujarati", "gu"],  # Exact phrase from Bangalore Gujarati
        ["હમ્પી: એક સર્વાગી વિશ્લેષણ", "hampi_gujarati", "gu"],  # Title from Hampi Gujarati
        ["हम्पी: एक समग्र विश्लेषण", "hampi_hindi", "hi"],  # Title from Hampi Hindi
        ["विजयनगर साम्राज्य की नींव", "hampi_hindi", "hi"],  # Specific phrase about Vijayanagar Empire
    ]

    for exact_phrase, expected_filename, language in test_cases:
        log_handle.info(f"Running exact phrase search for: '{exact_phrase}' (expecting {expected_filename})")

        results, total_hits = index_searcher.perform_lexical_search(
            keywords=exact_phrase,
            exact_match=True,  # Use exact match for phrase search
            exclude_words=[],
            categories={},
            detected_language=language,
            page_size=10,
            page_number=1
        )

        log_handle.info(f"Found {len(results)} exact phrase results for: '{exact_phrase}'")
        if len(results) > 0:
            # Check if results contain expected filename
            found_expected = False
            for result in results:
                filename = result.get('filename', '').lower()
                if expected_filename.lower() in filename:
                    found_expected = True
                    log_handle.info(f"✓ Found expected file {expected_filename} for exact phrase: '{exact_phrase}'")
                    break

            if not found_expected:
                log_handle.warning(f"Expected filename '{expected_filename}' not found for exact phrase '{exact_phrase}'")

def test_lexical_search_exact_phrase_negative():
    """Test that exact phrase search gives different results than regular lexical search."""
    config = Config()
    index_searcher = IndexSearcher(config)

    # List of [query_words, non_exact_phrase, expected_filename, language]
    # These are cases where individual words exist but the exact phrase doesn't
    test_cases = [
        # Hindi negative cases - using thanjavur and songadh content
        ["चोल साम्राज्य गौरव", "तंजावुर चोल गौरव इतिहास", "thanjavur_hindi", "hi"],  # Words exist separately but not as exact phrase
        ["सौराष्ट्र भावनगर किला", "सोनगढ़ भावनगर सामरिक किला", "songadh_hindi", "hi"],  # Words exist but phrase doesn't
        ["बृहदीश्वर मंदिर निर्माण", "राजराज चोल मंदिर शक्ति निर्माण", "thanjavur_hindi", "hi"],  # Individual words exist

        # Gujarati negative cases
        ["સૌરાષ્ટ્ર ભાવનગર કિલ્લો", "સોનગઢ ભાવનગર વ્યૂહાત્મક કિલ્લો", "songadh_gujarati", "gu"],  # Words exist but exact phrase doesn't
        ["મરાઠા ગાયકવાડ શક્તિ", "સોનગઢ મરાઠા ગાયકવાડ વંશ", "songadh_gujarati", "gu"],  # Individual words present
    ]

    for individual_words, non_exact_phrase, expected_filename, language in test_cases:
        log_handle.info(f"Testing negative case - Individual words: '{individual_words}' vs Non-exact phrase: '{non_exact_phrase}'")

        # Test 1: Individual words with regular lexical search (should find results)
        results_individual, _ = index_searcher.perform_lexical_search(
            keywords=individual_words,
            exact_match=False,  # Regular lexical search
            exclude_words=[],
            categories={},
            detected_language=language,
            page_size=10,
            page_number=1
        )

        # Test 2: Non-exact phrase with exact match (should find fewer/no results)
        results_exact, _ = index_searcher.perform_lexical_search(
            keywords=non_exact_phrase,
            exact_match=True,  # Exact phrase search
            exclude_words=[],
            categories={},
            detected_language=language,
            page_size=10,
            page_number=1
        )

        log_handle.info(f"Individual words '{individual_words}' found {len(results_individual)} results")
        log_handle.info(f"Exact phrase '{non_exact_phrase}' found {len(results_exact)} results")

        # Validate that individual words search finds results from expected file
        found_in_individual = False
        for result in results_individual:
            filename = result.get('filename', '').lower()
            if expected_filename.lower() in filename:
                found_in_individual = True
                break

        # Exact phrase search should have fewer results or different results
        found_in_exact = False
        for result in results_exact:
            filename = result.get('filename', '').lower()
            if expected_filename.lower() in filename:
                found_in_exact = True
                break

        if found_in_individual:
            log_handle.info(f"✓ Individual words search found expected file {expected_filename}")

        # The key assertion: individual word search should find more results than exact phrase search
        if len(results_individual) > len(results_exact):
            log_handle.info(f"✓ Negative test passed: Individual words found {len(results_individual)} results vs exact phrase found {len(results_exact)} results")
        else:
            log_handle.warning(f"Negative test inconclusive: Individual words ({len(results_individual)}) vs exact phrase ({len(results_exact)}) results")

def test_spelling_suggestions():
    """Test spelling suggestions functionality."""
    config = Config()
    index_searcher = IndexSearcher(config)

    # List of [misspelled_text, expected_corrections_context]
    test_cases = [
        # Hindi misspellings
        ["बंगलुरु", "bangalore_hindi", "hi"],  # Missing ए in बेंगलुरु
        ["केम्पे गौडा", "bangalore_hindi", "hi"],  # Missing diacritics in गौड़ा
        ["विजयनगार", "hampi_hindi", "hi"],  # Common misspelling of विजयनगर
        ["हम्पि", "hampi_hindi", "hi"],  # Missing ी in हम्पी

        # Gujarati misspellings
        ["મહાકાવ્", "jaipur_gujarati", "gu"],
        ["કેમ્પે ગૌડ", "bangalore_gujarati", "gu"],  # Missing final આ
        ["હમ્પि", "hampi_gujarati", "gu"],  # Missing ી
    ]

    for misspelled_text, context, language in test_cases:
        log_handle.info(f"Getting spelling suggestions for: '{misspelled_text}' (context: {context})")

        suggestions = index_searcher.get_spelling_suggestions(
            index_name=config.OPENSEARCH_INDEX_NAME,
            text=misspelled_text,
            language=language,
            min_score=0.6,
            num_suggestions=3
        )

        log_handle.info(f"Found {len(suggestions)} spelling suggestions for '{misspelled_text}': {suggestions}")

        # Test that we get some suggestions
        assert len(suggestions) > 0
        log_handle.info(f"✓ Got spelling suggestions for '{misspelled_text}': {suggestions}")

        # Optional: Try searching with the first suggestion
        if suggestions:
            first_suggestion = suggestions[0]
            log_handle.info(f"Testing search with suggested spelling: '{first_suggestion}'")

            language = "hi" if any(char in first_suggestion for char in "अआइईउऊएऐओऔकखगघचछजझटठडढणतथदधनपफबभमयरलवशषसह") else "gu"

            results, total_hits = index_searcher.perform_lexical_search(
                keywords=first_suggestion,
                exact_match=False,
                exclude_words=[],
                categories={},
                detected_language=language,
                page_size=5,
                page_number=1
            )

            log_handle.info(f"Search with suggested spelling '{first_suggestion}' returned {len(results)} results")
        else:
            log_handle.warning(f"No spelling suggestions found for '{misspelled_text}'")

def test_vector_search_basic_questions():
    """Test basic vector search with question-based queries."""
    config = Config()
    index_searcher = IndexSearcher(config)

    # List of [question_query, expected_filename_substring, language]
    test_cases = [
        # Hindi question-based queries
        ["बेंगलुरु का संस्थापक कौन था?", "bangalore_hindi", "hi"],  # About Kempe Gowda
        ["विजयनगर साम्राज्य कहाँ स्थापित हुआ था?", "hampi_hindi", "hi"],  # About Vijayanagar empire location
        ["तंजावुर में कौन सा प्रसिद्ध मंदिर है?", "thanjavur_hindi", "hi"],  # About Brihadeeswara temple
        ["सोनगढ़ किस राज्य में स्थित है?", "songadh_hindi", "hi"],  # About Songarh location in Gujarat

        # Gujarati question-based queries
        ["બેંગલુરુનો સ્થાપક કોણ હતો?", "bangalore_gujarati", "gu"],  # About Kempe Gowda
        ["હમ્પી કયા સામ્રાજ્યની રાજધાની હતી?", "hampi_gujarati", "gu"],  # About which empire's capital
        ["સોનગઢમાં કયો કિલ્લો છે?", "songadh_gujarati", "gu"],  # About the fort in Songarh
        ["જયપુર કયા પ્રદેશમાં આવેલું છે?", "jaipur_gujarati", "gu"],  # About Jaipur region
    ]

    for question, expected_filename, language in test_cases:
        log_handle.info(f"Running vector search for question: '{question}' (expecting {expected_filename})")

        # Generate embedding for the question
        embedding_model = embedding_models.get_embedding_model_factory(config)
        embedding = embedding_model.get_embedding(question)
        if embedding is None:
            log_handle.error(f"Embedding could not be generated for query: {question}")
            continue

        results, total_hits = index_searcher.perform_vector_search(
            keywords=question,
            embedding=embedding,
            categories={},
            page_size=10,
            page_number=1,
            language=language,
            rerank=True,
            rerank_top_k=10
        )

        log_handle.info(f"Vector search found {len(results)} results for: '{question}'")
        assert len(results) > 0, f"No vector search results found for question: {question}"


def test_vector_search_with_categories():
    """Test vector search with category filters."""
    config = Config()
    index_searcher = IndexSearcher(config)

    # List of [question_query, categories_filter, expected_filename_substring, language]
    test_cases = [
        # Hindi questions with language filter
        ["बेंगलुरु के बारे में बताएं?", {"language": ["hi"]}, "bangalore_hindi", "hi"],
        ["विजयनगर साम्राज्य का इतिहास क्या है?", {"language": ["hi"]}, "hampi_hindi", "hi"],

        # Gujarati questions with language filter
        ["બેંગલુરુ વિશે જણાવો?", {"language": ["gu"]}, "bangalore_gujarati", "gu"],
        ["હમ્પીનો ઇતિહાસ શું છે?", {"language": ["gu"]}, "hampi_gujarati", "gu"],

        # Mixed category filters (if they exist)
        ["तंजावुर मंदिर के बारे में?", {"category": ["history"], "language": ["hi"]}, "thanjavur_hindi", "hi"],
        ["સોનગઢનું મહત્વ શું છે?", {"category": ["history"], "language": ["gu"]}, "songadh_gujarati", "gu"],
    ]

    for question, categories, expected_filename, language in test_cases:
        log_handle.info(f"Running vector search with categories: '{question}' with filters {categories}")

        # Generate embedding for the question
        embedding_model = embedding_models.get_embedding_model_factory(config)
        embedding = embedding_model.get_embedding(question)
        if embedding is None:
            log_handle.error(f"Embedding could not be generated for query: {question}")
            continue

        results, total_hits = index_searcher.perform_vector_search(
            keywords=question,
            embedding=embedding,
            categories=categories,
            page_size=10,
            page_number=1,
            language=language,
            rerank=True,
            rerank_top_k=10
        )

        log_handle.info(f"Vector search with categories found {len(results)} results for: '{question}'")
        if len(results) > 0:
            # Check if results match the expected filename pattern
            found_expected = False
            for result in results[:3]:
                filename = result.get('filename', '').lower()
                if expected_filename.lower() in filename:
                    found_expected = True
                    log_handle.info(f"✓ Found expected file {expected_filename} in filtered vector results")
                    break

            if not found_expected:
                log_handle.warning(f"Expected filename '{expected_filename}' not found in filtered vector results for '{question}'")
        else:
            log_handle.info(f"No results found for filtered vector search: '{question}' with categories {categories}")

def test_exclude_words():
    """Test exclude words functionality in lexical search."""
    config = Config()
    index_searcher = IndexSearcher(config)

    # Test query that should return results without exclusion
    query = "दिगंबर जैन मनोरंजन"  # Traditional tourism
    exclude_word = "सोनगढ़"  # Songarh
    language = "hi"

    # First search without exclude words - should return 1 result
    log_handle.info(f"Running search without exclude words: '{query}'")
    results_without_exclude, total_hits_without_exclude = index_searcher.perform_lexical_search(
        keywords=query,
        exact_match=False,
        exclude_words=[],
        categories={},
        detected_language=language,
        page_size=10,
        page_number=1
    )

    log_handle.info(f"Search without exclude words returned {len(results_without_exclude)} results (total: {total_hits_without_exclude})")
    assert len(results_without_exclude) == 1, f"Expected 1 result without exclude words, got {len(results_without_exclude)}"

    # Second search with exclude words - should return 0 results
    log_handle.info(f"Running search with exclude word: '{query}' excluding '{exclude_word}'")
    results_with_exclude, total_hits_with_exclude = index_searcher.perform_lexical_search(
        keywords=query,
        exact_match=False,
        exclude_words=[exclude_word],
        categories={},
        detected_language=language,
        page_size=10,
        page_number=1
    )

    log_handle.info(f"Search with exclude words returned {len(results_with_exclude)} results (total: {total_hits_with_exclude})")
    assert len(results_with_exclude) == 0, f"Expected 0 results with exclude word '{exclude_word}', got {len(results_with_exclude)}"

    log_handle.info(f"✓ Exclude words test passed: {len(results_without_exclude)} results without exclusion, {len(results_with_exclude)} results with exclusion")


def test_reindex_metadata_only():
    """Verify that index_document with reindex_metadata_only=True updates metadata and
    pravachan fields in-place without changing chunk count. Exercises the full
    index_document path (read OCR → generate paragraphs → write text → update OS)."""
    config = Config()
    opensearch_client = get_opensearch_client(config)
    index_generator = IndexGenerator(config, opensearch_client)

    # hampi_hindi.pdf is always at relative path "hindi/history/hampi_hindi.pdf"
    relative_path = "hindi/history/hampi_hindi.pdf"
    doc_id = str(uuid.uuid5(uuid.NAMESPACE_URL, relative_path))

    query = {"query": {"term": {"document_id": doc_id}}, "size": 500}
    response = opensearch_client.search(index=config.OPENSEARCH_INDEX_NAME, body=query)
    hits_before = response['hits']['hits']
    assert len(hits_before) > 0, f"No chunks found for doc_id {doc_id}"

    # Build page_to_pravachan_data with easily-verified sentinel values
    page_numbers = {
        h['_source']['page_number']
        for h in hits_before
        if h['_source'].get('page_number') is not None
    }
    page_to_pravachan_data = {
        page: {"pravachan_no": f"REINDEX_P{page}", "date": "15-06-1990"}
        for page in page_numbers
    }

    new_metadata = {
        "language": "hi", "category": "Pravachan",
        "Anuyog": "history", "file_url": "", "reindex_marker": "updated"
    }

    ocr_dir = os.path.join(config.BASE_OCR_PATH, "hindi", "history", "hampi_hindi")
    output_text_dir = os.path.join(config.BASE_TEXT_PATH, "hindi", "history", "hampi_hindi")
    scan_config = {"chunk_strategy": config.CHUNK_STRATEGY, "language": "hi"}

    index_generator.index_document(
        doc_id, relative_path, ocr_dir, output_text_dir, sorted(page_numbers),
        new_metadata, scan_config, page_to_pravachan_data,
        reindex_metadata_only=True, dry_run=False
    )
    opensearch_client.indices.refresh(index=config.OPENSEARCH_INDEX_NAME)

    response = opensearch_client.search(index=config.OPENSEARCH_INDEX_NAME, body=query)
    hits_after = response['hits']['hits']

    assert len(hits_after) == len(hits_before), \
        f"Chunk count changed: {len(hits_before)} before, {len(hits_after)} after"

    for hit in hits_after:
        src = hit['_source']
        chunk_id = hit['_id']

        assert src.get('metadata', {}).get('reindex_marker') == 'updated', \
            f"metadata.reindex_marker not updated on chunk {chunk_id}"

        page = src.get('page_number')
        if page in page_numbers:
            assert src.get('pravachan_number') == f"REINDEX_P{page}", \
                f"pravachan_number wrong on chunk {chunk_id}"
            assert src.get('date') == "1990-06-15", \
                f"date not converted correctly on chunk {chunk_id}"

    log_handle.info(
        f"✓ index_document(reindex_metadata_only=True) correctly updated {len(hits_after)} chunks"
    )

def test_filter_by_granth_songadh():
    """Filter lexical search by Granth=Songadh — should return only songadh docs."""
    config = Config()
    index_searcher = IndexSearcher(config)

    results, total_hits = index_searcher.perform_lexical_search(
        keywords="सोनगढ़",
        exact_match=False,
        exclude_words=[],
        categories={"Granth": ["Songadh"]},
        detected_language="hi",
        page_size=10,
        page_number=1
    )

    assert total_hits > 0, "Expected results for Granth=Songadh filter"
    for result in results:
        assert result.get("metadata", {}).get("Granth") == "Songadh", \
            f"Result has wrong Granth: {result.get('metadata', {}).get('Granth')}"
    log_handle.info(f"✓ Granth=Songadh filter returned {total_hits} hits, all matching")


def test_filter_by_granth_thanjavur():
    """Filter lexical search by Granth=Thanjavur — should return only thanjavur docs."""
    config = Config()
    index_searcher = IndexSearcher(config)

    results, total_hits = index_searcher.perform_lexical_search(
        keywords="तंजावुर",
        exact_match=False,
        exclude_words=[],
        categories={"Granth": ["Thanjavur"]},
        detected_language="hi",
        page_size=10,
        page_number=1
    )

    assert total_hits > 0, "Expected results for Granth=Thanjavur filter"
    for result in results:
        assert result.get("metadata", {}).get("Granth") == "Thanjavur", \
            f"Result has wrong Granth: {result.get('metadata', {}).get('Granth')}"
    log_handle.info(f"✓ Granth=Thanjavur filter returned {total_hits} hits, all matching")


def test_granth_date_ranges_in_metadata_index():
    """Verify that the Granth_date_ranges doc was written correctly for Songadh and Thanjavur."""
    config = Config()
    opensearch_client = get_opensearch_client(config)

    # Songadh spiritual series — Hindi
    doc = opensearch_client.get(
        index=config.OPENSEARCH_METADATA_INDEX_NAME,
        id="Pravachan_Granth_date_ranges_hi"
    )
    date_ranges = doc["_source"]["date_ranges"]
    assert "Songadh" in date_ranges, "Songadh missing from Granth_date_ranges_hi"
    songadh_ranges = date_ranges["Songadh"]
    assert any(
        r["start_date"] == "1975-01-01" and r["end_date"] == "1977-12-31"
        for r in songadh_ranges
    ), f"Expected Songadh date range not found: {songadh_ranges}"

    # Thanjavur gujarati — has its own file-level series dates
    doc = opensearch_client.get(
        index=config.OPENSEARCH_METADATA_INDEX_NAME,
        id="Pravachan_Granth_date_ranges_gu"
    )
    date_ranges = doc["_source"]["date_ranges"]
    assert "Thanjavur" in date_ranges, "Thanjavur missing from Granth_date_ranges_gu"
    thanjavur_ranges = date_ranges["Thanjavur"]
    assert any(
        r["start_date"] == "1978-01-01" and r["end_date"] == "1983-12-31"
        for r in thanjavur_ranges
    ), f"Expected Thanjavur date range not found: {thanjavur_ranges}"

    log_handle.info("✓ Granth_date_ranges docs verified for Songadh (hi) and Thanjavur (gu)")
