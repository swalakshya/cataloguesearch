"""
End-to-end integration tests for MultiPagePDFProcessor.

PDFs (in tests/data/multi_page_pdf/):
  bangalore_hindi.pdf  – 4 PDF pages, first_page_side="left"  → 8 logical pages
  songadh_hindi.pdf    – 3 PDF pages, first_page_side="right" → 6 logical pages

Both use chunk_strategy="advanced" (Tesseract OCR) with multi_page=True.

Expected page_mapping:
  bangalore_hindi: {"1":1, "2":1, "3":2, "4":2, "5":3, "6":3, "7":4, "8":4}
  songadh_hindi:   {"1":1, "2":1, "3":2, "4":2, "5":3, "6":3}

Logical page 3 for both docs comes from PDF page 2 → pdf_page_number must be 2.
"""

import json
import os
import shutil
import tempfile

import fitz
import pytest

from backend.common.opensearch import create_indices_if_not_exists, get_opensearch_client
from backend.config import Config
from backend.crawler.discovery import Discovery
from backend.crawler.index_generator import IndexGenerator
from backend.crawler.index_state import IndexState
from tests.backend.base import *  # brings in module-scoped autouse `initialise` fixture
from tests.backend.common import write_config_file

# ── paths ──────────────────────────────────────────────────────────────────────
_DATA_DIR     = os.path.join(os.path.dirname(__file__), "../data/multi_page_pdf")
_BANGALORE_PDF = os.path.join(_DATA_DIR, "bangalore_hindi.pdf")
_SONGADH_PDF   = os.path.join(_DATA_DIR, "songadh_hindi.pdf")

_BANGALORE_PDF_PAGES = 4
_SONGADH_PDF_PAGES   = 3

# Expected page_mapping: logical → PDF page number
_BANGALORE_PAGE_MAP = {str(k): v for k, v in {
    1: 1, 2: 1, 3: 2, 4: 2, 5: 3, 6: 3, 7: 4, 8: 4,
}.items()}
_SONGADH_PAGE_MAP = {str(k): v for k, v in {
    1: 1, 2: 1, 3: 2, 4: 2, 5: 3, 6: 3,
}.items()}

# ── module globals set by `indexed` fixture ────────────────────────────────────
_BANGALORE_DOC_ID    = None
_SONGADH_DOC_ID      = None
_BANGALORE_PAGE3_PHRASE = None
_SONGADH_PAGE3_PHRASE   = None


# ── helpers ────────────────────────────────────────────────────────────────────

def _phrase_from_chunks(hits: list, doc_id: str, page_num: int) -> str | None:
    """
    Extract a searchable phrase from indexed chunks for the given doc/page.

    Picks the chunk on the target page with the most words, then returns
    6 words from the middle — long enough to be specific, short enough to
    survive minor OCR variation.
    """
    candidates = [
        h["_source"].get("text_content_hindi", "")
        for h in hits
        if h["_source"].get("document_id") == doc_id
        and h["_source"].get("page_number") == page_num
    ]
    if not candidates:
        return None
    best = max(candidates, key=lambda t: len(t.split()))
    words = best.split()
    if len(words) < 4:
        return best
    mid = len(words) // 2
    return " ".join(words[mid : mid + 6])


def _raw_query(opensearch_client, index_name, query, size=500):
    response = opensearch_client.search(
        index=index_name,
        body={"size": size, "query": query},
    )
    return response["hits"]["hits"]


def _docs_for(opensearch_client, index_name, doc_id):
    return _raw_query(
        opensearch_client, index_name,
        {"term": {"document_id": doc_id}},
    )


# ── module-scoped fixtures ─────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def config(initialise):
    return Config()


@pytest.fixture(scope="module")
def opensearch_client(config):
    return get_opensearch_client(config)


@pytest.fixture(scope="module")
def indexed(config, opensearch_client):
    """
    Process (Tesseract OCR) and index both multi-page PDFs via Discovery.crawl().

    Temp layout:
        <base>/data/pdfs/
            bangalore_hindi.pdf
            songadh_hindi.pdf
            config.json          (language=hi, category=Pravachan)
            scan_config.json     (chunk_strategy=advanced, multi_page=True, per-file sides)
        <base>/data/ocr/         (populated by Tesseract during crawl)
        <base>/data/texts/
        <base>/crawl_state.db

    Module globals _BANGALORE_DOC_ID, _SONGADH_DOC_ID, and page-3 phrases are set
    after indexing so all test assertions can reference them without knowing UUIDs.
    """
    global _BANGALORE_DOC_ID, _SONGADH_DOC_ID
    global _BANGALORE_PAGE3_PHRASE, _SONGADH_PAGE3_PHRASE

    all_indices = [config.OPENSEARCH_INDEX_NAME, config.OPENSEARCH_METADATA_INDEX_NAME]

    # ── clean slate ────────────────────────────────────────────────────────────
    for idx in all_indices:
        opensearch_client.indices.delete(index=idx, ignore=[400, 404])
    create_indices_if_not_exists(config, opensearch_client)

    # ── temp directory layout ──────────────────────────────────────────────────
    base_dir = tempfile.mkdtemp(prefix="multi_page_e2e_")
    pdf_dir  = os.path.join(base_dir, "data", "pdfs")
    ocr_dir  = os.path.join(base_dir, "data", "ocr")
    text_dir = os.path.join(base_dir, "data", "texts")
    db_path  = os.path.join(base_dir, "crawl_state.db")

    os.makedirs(pdf_dir)
    os.makedirs(ocr_dir)
    os.makedirs(text_dir)

    # ── copy PDFs into temp pdf_dir ────────────────────────────────────────────
    bangalore_path = os.path.join(pdf_dir, "bangalore_hindi.pdf")
    songadh_path   = os.path.join(pdf_dir, "songadh_hindi.pdf")
    shutil.copy(_BANGALORE_PDF, bangalore_path)
    shutil.copy(_SONGADH_PDF,   songadh_path)

    # ── config.json ────────────────────────────────────────────────────────────
    write_config_file(os.path.join(pdf_dir, "config.json"),
                      {"language": "hi", "category": "Pravachan"})

    # ── scan_config.json ───────────────────────────────────────────────────────
    write_config_file(os.path.join(pdf_dir, "scan_config.json"), {
        "default": {
            "chunk_strategy":  "advanced",
            "multi_page":      True,
            "ignore_bookmarks": True,
            "language":        "hi",
            "psm":             6,
        },
        "bangalore_hindi": {
            "start_page":     1,
            "end_page":       _BANGALORE_PDF_PAGES,
            "first_page_side": "left",
        },
        "songadh_hindi": {
            "start_page":     1,
            "end_page":       _SONGADH_PDF_PAGES,
            "first_page_side": "right",
        },
    })

    # ── redirect config to temp dirs ───────────────────────────────────────────
    crawler = config.settings()["crawler"]
    orig = {k: crawler[k] for k in
            ("base_pdf_path", "base_text_path", "base_ocr_path", "sqlite_db_path")}
    crawler["base_pdf_path"]  = pdf_dir
    crawler["base_text_path"] = text_dir
    crawler["base_ocr_path"]  = ocr_dir
    crawler["sqlite_db_path"] = db_path

    try:
        discovery = Discovery(
            config,
            IndexGenerator(config, opensearch_client),
            IndexState(config.SQLITE_DB_PATH),
        )
        # process=True: run real Tesseract OCR on the halves of each PDF page
        # index=True:   index the resulting logical-page chunks into OpenSearch
        discovery.crawl(process=True, index=True)

        opensearch_client.indices.refresh(index=config.OPENSEARCH_INDEX_NAME)

        # ── discover doc IDs from indexed chunks ───────────────────────────────
        all_hits = opensearch_client.search(
            index=config.OPENSEARCH_INDEX_NAME,
            body={"size": 500, "query": {"match_all": {}}},
        )["hits"]["hits"]

        for hit in all_hits:
            src      = hit["_source"]
            filename = src.get("original_filename", "")
            if "bangalore_hindi" in filename and _BANGALORE_DOC_ID is None:
                _BANGALORE_DOC_ID = src["document_id"]
            elif "songadh_hindi" in filename and _SONGADH_DOC_ID is None:
                _SONGADH_DOC_ID = src["document_id"]

        # ── extract searchable phrases from indexed page-3 chunks ─────────────
        # Reading from OpenSearch guarantees the phrase survived paragraph
        # generation — unlike reading raw OCR lines which may be filtered.
        bangalore_ocr_dir = os.path.join(ocr_dir, "bangalore_hindi")
        songadh_ocr_dir   = os.path.join(ocr_dir, "songadh_hindi")
        _BANGALORE_PAGE3_PHRASE = _phrase_from_chunks(all_hits, _BANGALORE_DOC_ID, 3)
        _SONGADH_PAGE3_PHRASE   = _phrase_from_chunks(all_hits, _SONGADH_DOC_ID, 3)

        yield {
            "bangalore_ocr_dir": bangalore_ocr_dir,
            "songadh_ocr_dir":   songadh_ocr_dir,
        }

    finally:
        crawler.update(orig)
        shutil.rmtree(base_dir, ignore_errors=True)
        for idx in all_indices:
            opensearch_client.indices.delete(index=idx, ignore=[400, 404])


# ═══════════════════════════════════════════════════════════════════════════════
# TestPageMappingStructure
# ═══════════════════════════════════════════════════════════════════════════════

class TestPageMappingStructure:
    """Verify that page_mapping.json is written with correct structure."""

    @pytest.fixture(scope="class")
    def bangalore_mapping(self, indexed):
        path = os.path.join(indexed["bangalore_ocr_dir"], "page_mapping.json")
        with open(path) as fh:
            return json.load(fh)

    @pytest.fixture(scope="class")
    def songadh_mapping(self, indexed):
        path = os.path.join(indexed["songadh_ocr_dir"], "page_mapping.json")
        with open(path) as fh:
            return json.load(fh)

    def test_bangalore_page_mapping_exists(self, indexed):
        path = os.path.join(indexed["bangalore_ocr_dir"], "page_mapping.json")
        assert os.path.exists(path)

    def test_songadh_page_mapping_exists(self, indexed):
        path = os.path.join(indexed["songadh_ocr_dir"], "page_mapping.json")
        assert os.path.exists(path)

    def test_bangalore_mapping_has_even_key_count(self, bangalore_mapping):
        """Each PDF page contributes exactly two logical pages."""
        assert len(bangalore_mapping) % 2 == 0

    def test_songadh_mapping_has_even_key_count(self, songadh_mapping):
        assert len(songadh_mapping) % 2 == 0

    def test_bangalore_mapping_consecutive_logical_pages(self, bangalore_mapping):
        """Logical page keys form a gapless sequence starting at 1."""
        keys = sorted(int(k) for k in bangalore_mapping)
        assert keys == list(range(1, len(keys) + 1))

    def test_songadh_mapping_consecutive_logical_pages(self, songadh_mapping):
        keys = sorted(int(k) for k in songadh_mapping)
        assert keys == list(range(1, len(keys) + 1))

    def test_bangalore_pairs_share_pdf_page(self, bangalore_mapping):
        """Every consecutive pair of logical pages maps to the same PDF page."""
        keys = sorted(int(k) for k in bangalore_mapping)
        for i in range(0, len(keys), 2):
            a, b = str(keys[i]), str(keys[i + 1])
            assert bangalore_mapping[a] == bangalore_mapping[b], (
                f"Logical pages {a} and {b} should map to the same PDF page"
            )

    def test_songadh_pairs_share_pdf_page(self, songadh_mapping):
        keys = sorted(int(k) for k in songadh_mapping)
        for i in range(0, len(keys), 2):
            a, b = str(keys[i]), str(keys[i + 1])
            assert songadh_mapping[a] == songadh_mapping[b]

    def test_bangalore_pdf_page_numbers_are_non_decreasing(self, bangalore_mapping):
        """PDF page numbers in order of logical page: 1,1,2,2,3,3,4,4."""
        keys = sorted(int(k) for k in bangalore_mapping)
        pdf_pages = [bangalore_mapping[str(k)] for k in keys]
        assert pdf_pages == sorted(pdf_pages)

    def test_songadh_pdf_page_numbers_are_non_decreasing(self, songadh_mapping):
        keys = sorted(int(k) for k in songadh_mapping)
        pdf_pages = [songadh_mapping[str(k)] for k in keys]
        assert pdf_pages == sorted(pdf_pages)

    def test_bangalore_exact_mapping(self, bangalore_mapping):
        assert bangalore_mapping == _BANGALORE_PAGE_MAP

    def test_songadh_exact_mapping(self, songadh_mapping):
        assert songadh_mapping == _SONGADH_PAGE_MAP


# ═══════════════════════════════════════════════════════════════════════════════
# TestPdfPageNumberField
# ═══════════════════════════════════════════════════════════════════════════════

class TestPdfPageNumberField:
    """Verify pdf_page_number is stored correctly on every indexed chunk."""

    @pytest.fixture(scope="class")
    def bangalore_chunks(self, indexed, config, opensearch_client):
        return _docs_for(opensearch_client, config.OPENSEARCH_INDEX_NAME, _BANGALORE_DOC_ID)

    @pytest.fixture(scope="class")
    def songadh_chunks(self, indexed, config, opensearch_client):
        return _docs_for(opensearch_client, config.OPENSEARCH_INDEX_NAME, _SONGADH_DOC_ID)

    def test_bangalore_chunks_are_indexed(self, bangalore_chunks):
        assert len(bangalore_chunks) > 0

    def test_songadh_chunks_are_indexed(self, songadh_chunks):
        assert len(songadh_chunks) > 0

    def test_bangalore_all_chunks_have_pdf_page_number(self, bangalore_chunks):
        for doc in bangalore_chunks:
            assert "pdf_page_number" in doc["_source"], (
                f"Chunk {doc['_id']} is missing pdf_page_number"
            )

    def test_songadh_all_chunks_have_pdf_page_number(self, songadh_chunks):
        for doc in songadh_chunks:
            assert "pdf_page_number" in doc["_source"]

    def test_bangalore_pdf_page_number_matches_mapping(self, bangalore_chunks):
        for doc in bangalore_chunks:
            src = doc["_source"]
            logical      = src["page_number"]
            expected_pdf = _BANGALORE_PAGE_MAP.get(str(logical))
            assert src["pdf_page_number"] == expected_pdf, (
                f"Logical page {logical}: expected pdf_page_number={expected_pdf}, "
                f"got {src['pdf_page_number']}"
            )

    def test_songadh_pdf_page_number_matches_mapping(self, songadh_chunks):
        for doc in songadh_chunks:
            src = doc["_source"]
            logical      = src["page_number"]
            expected_pdf = _SONGADH_PAGE_MAP.get(str(logical))
            assert src["pdf_page_number"] == expected_pdf

    def test_most_bangalore_logical_pages_are_indexed(self, bangalore_chunks):
        """At least 6 of 8 logical pages must have indexed chunks.
        A blank half-page on the first or last physical page is acceptable,
        but if most halves are missing the split is broken."""
        indexed_pages = {doc["_source"]["page_number"] for doc in bangalore_chunks}
        assert len(indexed_pages) >= 6, (
            f"Only {len(indexed_pages)} logical pages indexed; expected ≥6. "
            f"Indexed: {sorted(indexed_pages)}"
        )

    def test_most_songadh_logical_pages_are_indexed(self, songadh_chunks):
        """At least 4 of 6 logical pages must have indexed chunks."""
        indexed_pages = {doc["_source"]["page_number"] for doc in songadh_chunks}
        assert len(indexed_pages) >= 4, (
            f"Only {len(indexed_pages)} logical pages indexed; expected ≥4. "
            f"Indexed: {sorted(indexed_pages)}"
        )

    def test_bangalore_sibling_pages_share_pdf_page_number(self, bangalore_chunks):
        """
        For every pair of sibling logical pages (1&2, 3&4, …) that are BOTH indexed,
        they must share the same pdf_page_number — they came from the same physical PDF page.
        At least half the pairs must be present (to catch a silent split failure).
        """
        page_to_pdf = {}
        for doc in bangalore_chunks:
            src = doc["_source"]
            page_to_pdf[src["page_number"]] = src["pdf_page_number"]

        verified_pairs = 0
        for odd in range(1, 9, 2):
            even = odd + 1
            if odd in page_to_pdf and even in page_to_pdf:
                assert page_to_pdf[odd] == page_to_pdf[even], (
                    f"Sibling logical pages {odd} and {even} have different pdf_page_number: "
                    f"{page_to_pdf[odd]} vs {page_to_pdf[even]}"
                )
                verified_pairs += 1

        assert verified_pairs >= 2, (
            f"Only {verified_pairs} complete sibling pair(s) were indexed — "
            "cannot confirm the split is working correctly"
        )

    def test_songadh_sibling_pages_share_pdf_page_number(self, songadh_chunks):
        """Same sibling invariant for songadh (3 PDF pages → pairs 1&2, 3&4, 5&6)."""
        page_to_pdf = {}
        for doc in songadh_chunks:
            src = doc["_source"]
            page_to_pdf[src["page_number"]] = src["pdf_page_number"]

        verified_pairs = 0
        for odd in range(1, 7, 2):
            even = odd + 1
            if odd in page_to_pdf and even in page_to_pdf:
                assert page_to_pdf[odd] == page_to_pdf[even], (
                    f"Sibling logical pages {odd} and {even} have different pdf_page_number: "
                    f"{page_to_pdf[odd]} vs {page_to_pdf[even]}"
                )
                verified_pairs += 1

        assert verified_pairs >= 1, (
            f"No complete sibling pair was indexed for songadh — "
            "cannot confirm the split is working correctly"
        )

    def test_later_logical_pages_have_larger_pdf_page(self, bangalore_chunks):
        """Logical pages 5-8 must come from PDF pages 3-4."""
        late = [
            doc["_source"] for doc in bangalore_chunks
            if doc["_source"]["page_number"] >= 5
        ]
        assert late, "No chunks found for logical pages 5-8 — split may have failed"
        for src in late:
            assert src["pdf_page_number"] >= 3, (
                f"Logical page {src['page_number']} should have pdf_page_number >= 3, "
                f"got {src['pdf_page_number']}"
            )


# ═══════════════════════════════════════════════════════════════════════════════
# TestSearchResultsPageNumbers
# ═══════════════════════════════════════════════════════════════════════════════

class TestSearchResultsPageNumbers:
    """Verify page_number and pdf_page_number are correct in search results."""

    def test_bangalore_page_numbers_in_valid_range(self, indexed, config, opensearch_client):
        """All bangalore chunks must have logical page_number in 1..8."""
        chunks = _docs_for(opensearch_client, config.OPENSEARCH_INDEX_NAME, _BANGALORE_DOC_ID)
        assert len(chunks) > 0
        for doc in chunks:
            assert 1 <= doc["_source"]["page_number"] <= 8

    def test_songadh_page_numbers_in_valid_range(self, indexed, config, opensearch_client):
        """All songadh chunks must have logical page_number in 1..6."""
        chunks = _docs_for(opensearch_client, config.OPENSEARCH_INDEX_NAME, _SONGADH_DOC_ID)
        assert len(chunks) > 0
        for doc in chunks:
            assert 1 <= doc["_source"]["page_number"] <= 6

    def test_two_docs_have_distinct_document_ids(self, indexed):
        assert _BANGALORE_DOC_ID is not None
        assert _SONGADH_DOC_ID is not None
        assert _BANGALORE_DOC_ID != _SONGADH_DOC_ID

    def test_bangalore_page3_phrase_has_correct_page_numbers(self, indexed, config, opensearch_client):
        """
        A phrase from bangalore logical page 3 (left half of PDF page 2) must return
        at least one hit with page_number=3 and pdf_page_number=2.
        Exactly one of the two docs may contain this phrase (cross-doc isolation).
        """
        assert _BANGALORE_PAGE3_PHRASE is not None, (
            "No usable phrase found on bangalore logical page 3 — "
            "OCR may have produced no text"
        )
        hits = _raw_query(opensearch_client, config.OPENSEARCH_INDEX_NAME, {
            "bool": {
                "must": [
                    {"term":         {"document_id": _BANGALORE_DOC_ID}},
                    {"match_phrase": {"text_content_hindi": _BANGALORE_PAGE3_PHRASE}},
                ]
            }
        })
        assert len(hits) >= 1
        page3_hits = [h for h in hits if h["_source"]["page_number"] == 3]
        assert len(page3_hits) >= 1, (
            f"Expected at least one hit on logical page 3 but got: "
            f"{[h['_source']['page_number'] for h in hits]}"
        )
        for h in page3_hits:
            assert h["_source"]["pdf_page_number"] == 2, (
                f"Logical page 3 of bangalore must have pdf_page_number=2 "
                f"(comes from PDF page 2), got {h['_source']['pdf_page_number']}"
            )

    def test_songadh_page3_phrase_has_correct_page_numbers(self, indexed, config, opensearch_client):
        """
        A phrase from songadh logical page 3 (right half of PDF page 2) must return
        at least one hit with page_number=3 and pdf_page_number=2.
        """
        assert _SONGADH_PAGE3_PHRASE is not None, (
            "No usable phrase found on songadh logical page 3"
        )
        hits = _raw_query(opensearch_client, config.OPENSEARCH_INDEX_NAME, {
            "bool": {
                "must": [
                    {"term":         {"document_id": _SONGADH_DOC_ID}},
                    {"match_phrase": {"text_content_hindi": _SONGADH_PAGE3_PHRASE}},
                ]
            }
        })
        assert len(hits) >= 1
        page3_hits = [h for h in hits if h["_source"]["page_number"] == 3]
        assert len(page3_hits) >= 1
        for h in page3_hits:
            assert h["_source"]["pdf_page_number"] == 2

    def test_bangalore_page3_phrase_absent_from_songadh(self, indexed, config, opensearch_client):
        """Phrase extracted from bangalore page 3 must not appear in the songadh document."""
        assert _BANGALORE_PAGE3_PHRASE is not None
        hits = _raw_query(opensearch_client, config.OPENSEARCH_INDEX_NAME, {
            "bool": {
                "must": [
                    {"term":         {"document_id": _SONGADH_DOC_ID}},
                    {"match_phrase": {"text_content_hindi": _BANGALORE_PAGE3_PHRASE}},
                ]
            }
        })
        assert len(hits) == 0, (
            f"Phrase '{_BANGALORE_PAGE3_PHRASE}' from bangalore page 3 "
            f"should not appear in songadh document"
        )

    def test_songadh_page3_phrase_absent_from_bangalore(self, indexed, config, opensearch_client):
        """Phrase extracted from songadh page 3 must not appear in the bangalore document."""
        assert _SONGADH_PAGE3_PHRASE is not None
        hits = _raw_query(opensearch_client, config.OPENSEARCH_INDEX_NAME, {
            "bool": {
                "must": [
                    {"term":         {"document_id": _BANGALORE_DOC_ID}},
                    {"match_phrase": {"text_content_hindi": _SONGADH_PAGE3_PHRASE}},
                ]
            }
        })
        assert len(hits) == 0, (
            f"Phrase '{_SONGADH_PAGE3_PHRASE}' from songadh page 3 "
            f"should not appear in bangalore document"
        )
