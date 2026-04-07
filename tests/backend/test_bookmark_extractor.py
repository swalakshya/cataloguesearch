import logging
import os
import pytest
from concurrent.futures import ThreadPoolExecutor, as_completed

from backend.crawler.bookmark_extractor.factory import create_bookmark_extractor_by_name
from tests.backend.base import *
from tests.backend.common import setup

log_handle = logging.getLogger(__name__)


@pytest.fixture(scope="module")
def ollama_extractor(ensure_ollama):
    return create_bookmark_extractor_by_name("ollama")


@pytest.fixture(scope="module")
def gemini_extractor():
    """Returns the Gemini extractor, or None if GEMINI_API_KEY is not set."""
    if not os.environ.get("GEMINI_API_KEY"):
        return None
    return create_bookmark_extractor_by_name("gemini")


# ---------------------------------------------------------------------------
# Core test logic (extractor-agnostic, safe to run from threads)
# ---------------------------------------------------------------------------

def _run_bookmark_extraction(extractor):
    """
    Tests call_llm with batches that exactly match what build_index caches for
    hampi_hindi.pdf and jaipur_hindi.pdf — so Ollama gets instant cache hits
    while Gemini runs independently (separate cache key by extractor type).
    """
    extractor_name = type(extractor.real_extractor).__name__ if hasattr(extractor, 'real_extractor') else type(extractor).__name__

    # Matches hampi_hindi.pdf bookmarks added by common.py:setup()
    batch_hampi = [
        {"index": 0, "title": "prav number 248, 1985-10-23"},
        {"index": 1, "title": "Prav 324. Date 24-05-1986"},
    ]
    result = extractor.call_llm(batch_hampi)
    assert result is not None, f"[{extractor_name}] LLM call failed for hampi batch"
    assert len(result) == 2, f"[{extractor_name}] Expected 2 results, got {len(result)}"
    assert result[0].get("pravachan_no") == "248", f"[{extractor_name}] hampi[0] pravachan_no: expected '248', got {result[0].get('pravachan_no')}"
    assert result[0].get("date") == "23-10-1985", f"[{extractor_name}] hampi[0] date: expected '23-10-1985', got {result[0].get('date')}"
    assert result[1].get("pravachan_no") == "324", f"[{extractor_name}] hampi[1] pravachan_no: expected '324', got {result[1].get('pravachan_no')}"
    assert result[1].get("date") == "24-05-1986", f"[{extractor_name}] hampi[1] date: expected '24-05-1986', got {result[1].get('date')}"
    log_handle.info("✓ [%s] hampi batch extraction passed", extractor_name)

    # Matches jaipur_hindi.pdf bookmarks added by common.py:setup()
    batch_jaipur = [
        {"index": 0, "title": "Pravachan Num 10 on Date 03-05-1986"},
        {"index": 1, "title": "Pravachan Num 12 on Date 04-06-1987"},
    ]
    result = extractor.call_llm(batch_jaipur)
    assert result is not None, f"[{extractor_name}] LLM call failed for jaipur batch"
    assert len(result) == 2, f"[{extractor_name}] Expected 2 results, got {len(result)}"
    assert result[0].get("pravachan_no") == "10", f"[{extractor_name}] jaipur[0] pravachan_no: expected '10', got {result[0].get('pravachan_no')}"
    assert result[0].get("date") == "03-05-1986", f"[{extractor_name}] jaipur[0] date: expected '03-05-1986', got {result[0].get('date')}"
    assert result[1].get("pravachan_no") == "12", f"[{extractor_name}] jaipur[1] pravachan_no: expected '12', got {result[1].get('pravachan_no')}"
    assert result[1].get("date") == "04-06-1987", f"[{extractor_name}] jaipur[1] date: expected '04-06-1987', got {result[1].get('date')}"
    log_handle.info("✓ [%s] jaipur batch extraction passed", extractor_name)


def _run_granth_extraction(extractor):
    """
    Tests call_llm with granth-style bookmarks (gatha, kalash, shlok, doha, sutra).
    Verifies the new fields are extracted and normalised correctly.
    """
    extractor_name = type(extractor.real_extractor).__name__ if hasattr(extractor, 'real_extractor') else type(extractor).__name__

    batch = [
        {"index": 0, "title": "Gatha 65 & 66"},
        {"index": 1, "title": "Kalash 219"},
        {"index": 2, "title": "sHLOK 2-14-15"},
        {"index": 3, "title": "Doha 3,4"},
        {"index": 4, "title": "Sutra 7"},
    ]
    result = extractor.call_llm(batch)
    assert result is not None, f"[{extractor_name}] LLM call failed for granth batch"
    assert len(result) == 5, f"[{extractor_name}] Expected 5 results, got {len(result)}"

    by_index = {item["index"]: item for item in result}
    assert by_index[0].get("gatha") == "65-66", f"[{extractor_name}] index 0 gatha: expected '65-66', got {by_index[0].get('gatha')}"
    assert by_index[1].get("kalash") == "219", f"[{extractor_name}] index 1 kalash: expected '219', got {by_index[1].get('kalash')}"
    assert by_index[2].get("shlok") == "2-14-15", f"[{extractor_name}] index 2 shlok: expected '2-14-15', got {by_index[2].get('shlok')}"
    assert by_index[3].get("doha") == "3-4", f"[{extractor_name}] index 3 doha: expected '3-4', got {by_index[3].get('doha')}"
    assert by_index[4].get("sutra") == "7", f"[{extractor_name}] index 4 sutra: expected '7', got {by_index[4].get('sutra')}"
    log_handle.info("✓ [%s] granth batch extraction passed", extractor_name)


def _run_pdf_bookmarks_test(extractor, doc_ids):
    """
    Tests parse_bookmarks on real PDFs. Ollama gets cache hits from build_index;
    Gemini runs independently.
    """
    extractor_name = type(extractor.real_extractor).__name__ if hasattr(extractor, 'real_extractor') else type(extractor).__name__

    hampi = doc_ids["hampi_hindi"][0]
    bookmarks = extractor.parse_bookmarks(hampi)
    expected_hampi = {
        2: ("248", "23-10-1985"),
        4: ("324", "24-05-1986"),
    }
    assert len(bookmarks) == len(expected_hampi), f"[{extractor_name}] hampi: expected {len(expected_hampi)} bookmarks, got {len(bookmarks)}"
    for val in bookmarks:
        page_num = val["page"]
        assert expected_hampi[page_num][0] == val['pravachan_no'], f"[{extractor_name}] hampi p{page_num} pravachan_no"
        assert expected_hampi[page_num][1] == val['date'], f"[{extractor_name}] hampi p{page_num} date"
    log_handle.info("✓ [%s] hampi_hindi pdf bookmarks passed", extractor_name)

    jaipur = doc_ids["jaipur_hindi"][0]
    bookmarks = extractor.parse_bookmarks(jaipur)
    expected_jaipur = {
        1: ("10", "03-05-1986"),
        5: ("12", "04-06-1987"),
    }
    assert len(bookmarks) == len(expected_jaipur), f"[{extractor_name}] jaipur: expected {len(expected_jaipur)} bookmarks, got {len(bookmarks)}"
    for val in bookmarks:
        page_num = val["page"]
        assert expected_jaipur[page_num][0] == val['pravachan_no'], f"[{extractor_name}] jaipur p{page_num} pravachan_no"
        assert expected_jaipur[page_num][1] == val['date'], f"[{extractor_name}] jaipur p{page_num} date"
    log_handle.info("✓ [%s] jaipur_hindi pdf bookmarks passed", extractor_name)

    indore = doc_ids["indore_gujarati"][0]
    bookmarks = extractor.parse_bookmarks(indore)
    expected_indore = {
        2: ("28", "23-10-1982"),
        4: ("324", "24-05-1982"),
    }
    assert len(bookmarks) == len(expected_indore), f"[{extractor_name}] indore: expected {len(expected_indore)} bookmarks, got {len(bookmarks)}"
    for val in bookmarks:
        page_num = val["page"]
        assert expected_indore[page_num][0] == val['pravachan_no'], f"[{extractor_name}] indore p{page_num} pravachan_no"
        assert expected_indore[page_num][1] == val['date'], f"[{extractor_name}] indore p{page_num} date"
    log_handle.info("✓ [%s] indore_gujarati pdf bookmarks passed", extractor_name)


def _run_parallel(tasks):
    """
    Run tasks in parallel. Each task is a tuple of (fn, *args).
    Re-raises the first exception encountered.
    """
    if not tasks:
        return
    with ThreadPoolExecutor(max_workers=len(tasks)) as executor:
        futures = [executor.submit(task[0], *task[1:]) for task in tasks]
        for future in as_completed(futures):
            future.result()  # re-raises any AssertionError or exception from the thread


# ---------------------------------------------------------------------------
# Tests — both extractors run in parallel per test
# ---------------------------------------------------------------------------

def test_bookmark_extraction(ollama_extractor, gemini_extractor):
    """
    Tests call_llm parsing using real PDF bookmark strings.

    Ollama: gets cache hits from build_index (same batches, same extractor type key).
    Gemini: runs independently (separate cache key), making real API calls.
    Both run in parallel to minimise wall time.
    """
    extractors = [e for e in [ollama_extractor, gemini_extractor] if e is not None]
    tasks = []
    for ex in extractors:
        tasks.append((_run_bookmark_extraction, ex))
        tasks.append((_run_granth_extraction, ex))
    _run_parallel(tasks)


def test_pdf_bookmarks(ollama_extractor, gemini_extractor):
    """
    Tests parse_bookmarks on real PDF files.

    Ollama: gets cache hits from build_index.
    Gemini: runs independently, making real API calls.
    Both run in parallel to minimise wall time.
    """
    doc_ids = setup()
    extractors = [e for e in [ollama_extractor, gemini_extractor] if e is not None]
    _run_parallel([(_run_pdf_bookmarks_test, ex, doc_ids) for ex in extractors])
