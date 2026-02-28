import logging
import os
import pytest
from dotenv import load_dotenv
from pydantic_core.core_schema import bool_schema

from backend.crawler.bookmark_extractor.ollama import OllamaBookmarkExtractor
from backend.crawler.bookmark_extractor.gemini import GeminiBookmarkExtractor
from tests.backend.base import *
from tests.backend.common import setup

log_handle = logging.getLogger(__name__)


@pytest.fixture(scope="module")
def ollama_extractor():
    import requests as _requests
    try:
        _requests.get("http://localhost:11434/api/tags", timeout=2)
    except Exception:
        pytest.skip("Ollama not available")
    return OllamaBookmarkExtractor()


@pytest.fixture(scope="module")
def gemini_extractor():
    if not os.environ.get("GEMINI_API_KEY"):
        pytest.skip("GEMINI_API_KEY not set")
    return GeminiBookmarkExtractor()


def assert_extraction(extractor, input_string, expected_pravachan_no, expected_date):
    """
    Helper function to test bookmark extraction.

    Args:
        extractor: BookmarkExtractor instance
        input_string: The bookmark title to parse
        expected_pravachan_no: Expected pravachan number (or None)
        expected_date: Expected date in DD-MM-YYYY format (or None)
    """
    # Prepare input for the extractor
    indexed_titles = [{"index": 0, "title": input_string}]

    # Call the LLM
    result = extractor.call_llm(indexed_titles)

    # Assert the result is not None
    assert result is not None, f"LLM call failed for input: {input_string}"
    assert len(result) == 1, f"Expected 1 result, got {len(result)}"

    # Extract the result
    extracted = result[0]

    # Assert the extracted values match expected values
    assert extracted.get("pravachan_no") == expected_pravachan_no, \
        f"Expected pravachan_no={expected_pravachan_no}, got {extracted.get('pravachan_no')}"

    assert extracted.get("date") == expected_date, \
        f"Expected date={expected_date}, got {extracted.get('date')}"

    log_handle.info(f"✓ Successfully extracted: {extracted}")


@pytest.mark.parametrize("extractor_fixture", ["ollama_extractor", "gemini_extractor"])
def test_bookmark_extraction(extractor_fixture, request):
    extractor = request.getfixturevalue(extractor_fixture)

    assert_extraction(
        extractor,
        "Prav. no. 244-A on Kalash 219, Date: 07-11-1965",
        "244-A", "07-11-1965"
    )

    assert_extraction(
        extractor,
        "Pravachan Num 3412 on Dt 1945-04-12",
        "3412",
        "12-04-1945"
    )

    assert_extraction(
        extractor,
        "Pravachan 342 on Gatha 34",
        "342",
        None
    )

    assert_extraction(
        extractor,
        "Pravachan on Date 1985-03-04",
        None,
        "04-03-1985"
    )

@pytest.mark.parametrize("extractor_fixture", ["ollama_extractor", "gemini_extractor"])
def test_pdf_bookmarks(extractor_fixture, request):
    extractor = request.getfixturevalue(extractor_fixture)
    doc_ids = setup()

    hampi = doc_ids["hampi_hindi"][0]
    bookmarks = extractor.parse_bookmarks(hampi)
    expected_vals = {
        2: ("248", "23-10-1985"),
        4: ("324", "24-05-1986")
    }
    assert len(bookmarks) == len(expected_vals)
    for val in bookmarks:
        page_num = val["page"]
        assert expected_vals[page_num][0] == val['pravachan_no']
        assert expected_vals[page_num][1] == val['date']

    jaipur = doc_ids["jaipur_hindi"][0]
    bookmarks = extractor.parse_bookmarks(jaipur)
    expected_vals = {
        1: ("10", "03-05-1986"),
        5: ("12", "04-06-1987")
    }
    assert len(bookmarks) == len(expected_vals)
    for val in bookmarks:
        page_num = val["page"]
        assert expected_vals[page_num][0] == val['pravachan_no']
        assert expected_vals[page_num][1] == val['date']

    indore = doc_ids["indore_gujarati"][0]
    bookmarks = extractor.parse_bookmarks(indore)
    expected_vals = {
        2: ("28", "23-10-1982"),
        4: ("324", "24-05-1982")
    }
    assert len(bookmarks) == len(expected_vals)
    for val in bookmarks:
        page_num = val["page"]
        assert expected_vals[page_num][0] == val['pravachan_no']
        assert expected_vals[page_num][1] == val['date']