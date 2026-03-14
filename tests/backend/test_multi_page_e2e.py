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
import uuid

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
    1: 1, 2: 2, 3: 2, 4: 3, 5: 3,
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
            "start_page":      1,
            "end_page":        _BANGALORE_PDF_PAGES,
            "book_start_side": "left",
        },
        "songadh_hindi": {
            "start_page":      1,
            "end_page":        _SONGADH_PDF_PAGES,
            "book_start_side": "right",
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

    def test_songadh_mapping_has_5_entries(self, songadh_mapping):
        """
        book_start_side="right": the left half of PDF page 1 is not a book page,
        so 3 PDF pages yield only 5 logical pages (not 6).
        """
        assert len(songadh_mapping) == 5

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
        """
        With book_start_side="right", logical page 1 is alone (no sibling on PDF page 1).
        Pairs (2,3) and (4,5) must each map to the same PDF page.
        """
        assert songadh_mapping["2"] == songadh_mapping["3"]
        assert songadh_mapping["4"] == songadh_mapping["5"]

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
        """At least 3 of 5 logical pages must have indexed chunks."""
        indexed_pages = {doc["_source"]["page_number"] for doc in songadh_chunks}
        assert len(indexed_pages) >= 3, (
            f"Only {len(indexed_pages)} logical pages indexed; expected ≥3. "
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
        """
        With book_start_side="right", sibling pairs are (2,3) and (4,5).
        Logical page 1 has no sibling (it is the sole page on PDF page 1).
        """
        page_to_pdf = {}
        for doc in songadh_chunks:
            src = doc["_source"]
            page_to_pdf[src["page_number"]] = src["pdf_page_number"]

        verified_pairs = 0
        for pair in [(2, 3), (4, 5)]:
            a, b = pair
            if a in page_to_pdf and b in page_to_pdf:
                assert page_to_pdf[a] == page_to_pdf[b], (
                    f"Sibling logical pages {a} and {b} have different pdf_page_number: "
                    f"{page_to_pdf[a]} vs {page_to_pdf[b]}"
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
        """All songadh chunks must have logical page_number in 1..5."""
        chunks = _docs_for(opensearch_client, config.OPENSEARCH_INDEX_NAME, _SONGADH_DOC_ID)
        assert len(chunks) > 0
        for doc in chunks:
            assert 1 <= doc["_source"]["page_number"] <= 5

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


# ── module globals set by `side_bounds_setup` fixture ─────────────────────────
_SEC_A_DOC_ID = None
_SEC_B_DOC_ID = None

# ── module globals set by `shared_page_setup` fixture ─────────────────────────
_SHARED_SEC_A_DOC_ID = None
_SHARED_SEC_B_DOC_ID = None

# ── module globals set by `book_start_anchor_setup` fixture ───────────────────
_ANCHOR_DOC_ID = None


# ═══════════════════════════════════════════════════════════════════════════════
# TestSubSectionSideBounds
# ═══════════════════════════════════════════════════════════════════════════════

class TestSubSectionSideBounds:
    """
    Verify start_side/end_side sub-section bounds work correctly.

    Layout (bangalore_hindi.pdf, 4 PDF pages, first_page_side="left"):
      PDF page 1 → logical pages 1 (left), 2 (right)
      PDF page 2 → logical pages 3 (left), 4 (right)  ← logical page 4 is the gap
      PDF page 3 → logical pages 5 (left), 6 (right)
      PDF page 4 → logical pages 7 (left), 8 (right)

    Sec A: PDF pages 1–2, end_side="left"  → logical pages [1, 2, 3]
    Gap:   logical page 4 (right of PDF page 2) — OCR file exists, not indexed
    Sec B: PDF pages 3–4, end_side="right" → logical pages [5, 6, 7, 8]
    """

    @pytest.fixture(scope="class")
    def side_bounds_setup(self, config, opensearch_client):
        global _SEC_A_DOC_ID, _SEC_B_DOC_ID

        all_indices = [config.OPENSEARCH_INDEX_NAME, config.OPENSEARCH_METADATA_INDEX_NAME]
        for idx in all_indices:
            opensearch_client.indices.delete(index=idx, ignore=[400, 404])
        create_indices_if_not_exists(config, opensearch_client)

        base_dir = tempfile.mkdtemp(prefix="side_bounds_")
        pdf_dir  = os.path.join(base_dir, "data", "pdfs")
        ocr_dir  = os.path.join(base_dir, "data", "ocr")
        text_dir = os.path.join(base_dir, "data", "texts")
        db_path  = os.path.join(base_dir, "crawl_state.db")

        os.makedirs(pdf_dir)
        os.makedirs(ocr_dir)
        os.makedirs(text_dir)

        shutil.copy(_BANGALORE_PDF, os.path.join(pdf_dir, "bangalore_hindi.pdf"))

        write_config_file(os.path.join(pdf_dir, "config.json"),
                          {"language": "hi", "category": "Pravachan"})

        write_config_file(os.path.join(pdf_dir, "scan_config.json"), {
            "default": {
                "chunk_strategy":   "advanced",
                "multi_page":       True,
                "ignore_bookmarks": True,
                "language":         "hi",
                "psm":              6,
            },
            "bangalore_hindi": {
                "start_page":      1,
                "end_page":        _BANGALORE_PDF_PAGES,
                "book_start_side": "left",
                "sub_sections": [
                    {
                        "field":      "half",
                        "name":       "Sec A",
                        "start_page": 1,
                        "start_side": "left",
                        "end_page":   2,
                        "end_side":   "left",   # logical pages 1, 2, 3 (excludes page 4)
                    },
                    {
                        "field":      "half",
                        "name":       "Sec B",
                        "start_page": 3,
                        "start_side": "left",
                        "end_page":   4,
                        "end_side":   "right",  # logical pages 5, 6, 7, 8
                    },
                ],
            },
        })

        # Compute sub-section doc IDs exactly as discovery.py does
        relative_path = "bangalore_hindi.pdf"
        _SEC_A_DOC_ID = str(uuid.uuid5(uuid.NAMESPACE_URL, f"{relative_path}#half:Sec A"))
        _SEC_B_DOC_ID = str(uuid.uuid5(uuid.NAMESPACE_URL, f"{relative_path}#half:Sec B"))

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
            discovery.crawl(process=True, index=True)
            opensearch_client.indices.refresh(index=config.OPENSEARCH_INDEX_NAME)

            yield {"ocr_dir": os.path.join(ocr_dir, "bangalore_hindi")}

        finally:
            crawler.update(orig)
            shutil.rmtree(base_dir, ignore_errors=True)
            for idx in all_indices:
                opensearch_client.indices.delete(index=idx, ignore=[400, 404])

    # ── OCR file assertions ────────────────────────────────────────────────────

    def test_all_logical_ocr_files_exist(self, side_bounds_setup):
        """OCR runs on all 4 PDF pages → all 8 logical page files must exist."""
        ocr_dir = side_bounds_setup["ocr_dir"]
        for lp in range(1, 9):
            path = os.path.join(ocr_dir, f"page_{lp:04d}.json")
            assert os.path.exists(path), f"Missing OCR file: page_{lp:04d}.json"

    def test_gap_ocr_file_exists(self, side_bounds_setup):
        """
        Logical page 4 (right side of PDF page 2) is OCR-processed but not indexed
        by either sub-section — its OCR file must exist in the shared OCR dir.
        """
        ocr_dir = side_bounds_setup["ocr_dir"]
        assert os.path.exists(os.path.join(ocr_dir, "page_0004.json"))

    # ── page_mapping.json assertions ──────────────────────────────────────────

    def test_page_mapping_exists(self, side_bounds_setup):
        ocr_dir = side_bounds_setup["ocr_dir"]
        assert os.path.exists(os.path.join(ocr_dir, "page_mapping.json"))

    def test_page_mapping_has_8_entries(self, side_bounds_setup):
        """All 8 logical pages — including the gap — are in the mapping."""
        ocr_dir = side_bounds_setup["ocr_dir"]
        with open(os.path.join(ocr_dir, "page_mapping.json")) as fh:
            mapping = json.load(fh)
        assert len(mapping) == 8

    def test_page_mapping_sec_a_pages(self, side_bounds_setup):
        """Logical pages 1, 2 → PDF page 1; logical page 3 → PDF page 2."""
        ocr_dir = side_bounds_setup["ocr_dir"]
        with open(os.path.join(ocr_dir, "page_mapping.json")) as fh:
            mapping = json.load(fh)
        assert mapping["1"] == 1
        assert mapping["2"] == 1
        assert mapping["3"] == 2

    def test_page_mapping_gap_page(self, side_bounds_setup):
        """Logical page 4 (the gap) maps to PDF page 2."""
        ocr_dir = side_bounds_setup["ocr_dir"]
        with open(os.path.join(ocr_dir, "page_mapping.json")) as fh:
            mapping = json.load(fh)
        assert mapping["4"] == 2

    def test_page_mapping_sec_b_pages(self, side_bounds_setup):
        """Logical pages 5, 6 → PDF page 3; logical pages 7, 8 → PDF page 4."""
        ocr_dir = side_bounds_setup["ocr_dir"]
        with open(os.path.join(ocr_dir, "page_mapping.json")) as fh:
            mapping = json.load(fh)
        assert mapping["5"] == 3
        assert mapping["6"] == 3
        assert mapping["7"] == 4
        assert mapping["8"] == 4

    # ── OpenSearch indexing assertions ────────────────────────────────────────

    # Expected logical→PDF page mappings per sub-section
    _SEC_A_PAGE_MAP = {"1": 1, "2": 1, "3": 2}
    _SEC_B_PAGE_MAP = {"5": 3, "6": 3, "7": 4, "8": 4}

    @pytest.fixture(scope="class")
    def sec_a_chunks(self, side_bounds_setup, config, opensearch_client):
        return _docs_for(opensearch_client, config.OPENSEARCH_INDEX_NAME, _SEC_A_DOC_ID)

    @pytest.fixture(scope="class")
    def sec_b_chunks(self, side_bounds_setup, config, opensearch_client):
        return _docs_for(opensearch_client, config.OPENSEARCH_INDEX_NAME, _SEC_B_DOC_ID)

    def test_sec_a_has_indexed_chunks(self, sec_a_chunks):
        assert len(sec_a_chunks) > 0, "Sec A has no indexed chunks"

    def test_sec_b_has_indexed_chunks(self, sec_b_chunks):
        assert len(sec_b_chunks) > 0, "Sec B has no indexed chunks"

    def test_sec_a_page_numbers_in_range(self, sec_a_chunks):
        """Sec A may only contain logical pages 1, 2, 3."""
        for doc in sec_a_chunks:
            pn = doc["_source"]["page_number"]
            assert pn in (1, 2, 3), f"Sec A chunk has unexpected page_number={pn}"

    def test_sec_b_page_numbers_in_range(self, sec_b_chunks):
        """Sec B may only contain logical pages 5, 6, 7, 8."""
        for doc in sec_b_chunks:
            pn = doc["_source"]["page_number"]
            assert pn in (5, 6, 7, 8), f"Sec B chunk has unexpected page_number={pn}"

    def test_gap_page_not_in_sec_a(self, sec_a_chunks):
        """Logical page 4 (the gap) must not appear in Sec A."""
        pages = [doc["_source"]["page_number"] for doc in sec_a_chunks]
        assert 4 not in pages, "Gap page 4 was incorrectly indexed under Sec A"

    def test_gap_page_not_in_sec_b(self, sec_b_chunks):
        """Logical pages 1–4 must not appear in Sec B."""
        for doc in sec_b_chunks:
            pn = doc["_source"]["page_number"]
            assert pn >= 5, f"Sec B chunk has page_number={pn} (expected ≥5)"

    def test_sec_a_pdf_page_numbers_correct(self, sec_a_chunks):
        """Each Sec A chunk's pdf_page_number must match the page_mapping."""
        for doc in sec_a_chunks:
            src = doc["_source"]
            pn = src["page_number"]
            expected_pdf = self._SEC_A_PAGE_MAP[str(pn)]
            assert src["pdf_page_number"] == expected_pdf, (
                f"Sec A logical page {pn}: expected pdf_page_number={expected_pdf}, "
                f"got {src['pdf_page_number']}"
            )

    def test_sec_b_pdf_page_numbers_correct(self, sec_b_chunks):
        """Each Sec B chunk's pdf_page_number must match the page_mapping."""
        for doc in sec_b_chunks:
            src = doc["_source"]
            pn = src["page_number"]
            expected_pdf = self._SEC_B_PAGE_MAP[str(pn)]
            assert src["pdf_page_number"] == expected_pdf, (
                f"Sec B logical page {pn}: expected pdf_page_number={expected_pdf}, "
                f"got {src['pdf_page_number']}"
            )

    def test_sec_a_sub_section_name(self, sec_a_chunks):
        """All Sec A chunks must have sub_section.name == 'Sec A'."""
        for doc in sec_a_chunks:
            name = doc["_source"]["metadata"]["sub_section"]["name"]
            assert name == "Sec A", f"Expected sub_section.name='Sec A', got '{name}'"

    def test_sec_b_sub_section_name(self, sec_b_chunks):
        """All Sec B chunks must have sub_section.name == 'Sec B'."""
        for doc in sec_b_chunks:
            name = doc["_source"]["metadata"]["sub_section"]["name"]
            assert name == "Sec B", f"Expected sub_section.name='Sec B', got '{name}'"


# ═══════════════════════════════════════════════════════════════════════════════
# TestSharedPageBoundary
# ═══════════════════════════════════════════════════════════════════════════════

class TestSharedPageBoundary:
    """
    Verify start_side/end_side trim fires correctly when two sub-sections share a PDF page.

    Uses songadh_hindi.pdf (3 PDF pages, book_start_side="right"):
      With book_start_side="right", spreads after the first read left-to-right
      (left=lower page number, right=higher):
        PDF page 1 → logical 1 only (right; left of PDF 1 is not a book page)
        PDF page 2 → logical 2 (left), 3 (right)  ← shared
        PDF page 3 → logical 4 (left), 5 (right)

    Sec A: PDF pages 1–2, end_side="left"    → logical [1, 2]
    Sec B: PDF pages 2–3, start_side="right" → logical [3, 4, 5]
      • end trim:   PDF page 2, end_lp=left=2   → excludes right=3 from Sec A
      • start trim: PDF page 2, start_lp=right=3 → excludes left=2 from Sec B

    Logical page 2 → Sec A only.
    Logical page 3 → Sec B only.
    Both map to PDF page 2 in page_mapping.json.
    """

    # Expected logical→PDF page mappings (5 entries: page 1 alone, pairs 2-3 and 4-5)
    _SONGADH_SHARED_PAGE_MAP = {
        "1": 1,
        "2": 2, "3": 2,   # shared PDF page
        "4": 3, "5": 3,
    }
    _SHARED_SEC_A_PAGE_MAP = {"1": 1, "2": 2}
    _SHARED_SEC_B_PAGE_MAP = {"3": 2, "4": 3, "5": 3}

    @pytest.fixture(scope="class")
    def shared_page_setup(self, config, opensearch_client):
        global _SHARED_SEC_A_DOC_ID, _SHARED_SEC_B_DOC_ID

        all_indices = [config.OPENSEARCH_INDEX_NAME, config.OPENSEARCH_METADATA_INDEX_NAME]
        for idx in all_indices:
            opensearch_client.indices.delete(index=idx, ignore=[400, 404])
        create_indices_if_not_exists(config, opensearch_client)

        base_dir = tempfile.mkdtemp(prefix="shared_page_")
        pdf_dir  = os.path.join(base_dir, "data", "pdfs")
        ocr_dir  = os.path.join(base_dir, "data", "ocr")
        text_dir = os.path.join(base_dir, "data", "texts")
        db_path  = os.path.join(base_dir, "crawl_state.db")

        os.makedirs(pdf_dir)
        os.makedirs(ocr_dir)
        os.makedirs(text_dir)

        shutil.copy(_SONGADH_PDF, os.path.join(pdf_dir, "songadh_hindi.pdf"))

        write_config_file(os.path.join(pdf_dir, "config.json"),
                          {"language": "hi", "category": "Pravachan"})

        write_config_file(os.path.join(pdf_dir, "scan_config.json"), {
            "default": {
                "chunk_strategy":   "advanced",
                "multi_page":       True,
                "ignore_bookmarks": True,
                "language":         "hi",
                "psm":              6,
            },
            "songadh_hindi": {
                "start_page":      1,
                "end_page":        _SONGADH_PDF_PAGES,
                "book_start_side": "right",
                "sub_sections": [
                    {
                        "field":      "half",
                        "name":       "Sec A",
                        "start_page": 1,
                        "start_side": "right",
                        "end_page":   2,
                        "end_side":   "left",   # left of page 2 = logical 2 (last in Sec A)
                    },
                    {
                        "field":      "half",
                        "name":       "Sec B",
                        "start_page": 2,
                        "start_side": "right",  # right of page 2 = logical 3 (first in Sec B)
                        "end_page":   3,
                        "end_side":   "right",  # logical pages 3, 4, 5
                    },
                ],
            },
        })

        # Compute sub-section doc IDs exactly as discovery.py does
        relative_path = "songadh_hindi.pdf"
        _SHARED_SEC_A_DOC_ID = str(uuid.uuid5(uuid.NAMESPACE_URL, f"{relative_path}#half:Sec A"))
        _SHARED_SEC_B_DOC_ID = str(uuid.uuid5(uuid.NAMESPACE_URL, f"{relative_path}#half:Sec B"))

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
            discovery.crawl(process=True, index=True)
            opensearch_client.indices.refresh(index=config.OPENSEARCH_INDEX_NAME)

            yield {"ocr_dir": os.path.join(ocr_dir, "songadh_hindi")}

        finally:
            crawler.update(orig)
            shutil.rmtree(base_dir, ignore_errors=True)
            for idx in all_indices:
                opensearch_client.indices.delete(index=idx, ignore=[400, 404])

    # ── OCR file assertions ────────────────────────────────────────────────────

    def test_all_logical_ocr_files_exist(self, shared_page_setup):
        """5 logical page files must exist: pages 1–5 (PDF page 1 gives only 1 page)."""
        ocr_dir = shared_page_setup["ocr_dir"]
        for lp in range(1, 6):
            path = os.path.join(ocr_dir, f"page_{lp:04d}.json")
            assert os.path.exists(path), f"Missing OCR file: page_{lp:04d}.json"
        assert not os.path.exists(os.path.join(ocr_dir, "page_0006.json"))

    # ── page_mapping.json assertions ──────────────────────────────────────────

    def test_page_mapping_has_5_entries(self, shared_page_setup):
        ocr_dir = shared_page_setup["ocr_dir"]
        with open(os.path.join(ocr_dir, "page_mapping.json")) as fh:
            mapping = json.load(fh)
        assert len(mapping) == 5

    def test_page_mapping_shared_page(self, shared_page_setup):
        """Logical pages 2 and 3 both map to PDF page 2 (the shared page)."""
        ocr_dir = shared_page_setup["ocr_dir"]
        with open(os.path.join(ocr_dir, "page_mapping.json")) as fh:
            mapping = json.load(fh)
        assert mapping["2"] == 2
        assert mapping["3"] == 2

    def test_page_mapping_exact(self, shared_page_setup):
        ocr_dir = shared_page_setup["ocr_dir"]
        with open(os.path.join(ocr_dir, "page_mapping.json")) as fh:
            mapping = json.load(fh)
        assert mapping == self._SONGADH_SHARED_PAGE_MAP

    # ── OpenSearch indexing assertions ────────────────────────────────────────

    @pytest.fixture(scope="class")
    def shared_sec_a_chunks(self, shared_page_setup, config, opensearch_client):
        return _docs_for(opensearch_client, config.OPENSEARCH_INDEX_NAME, _SHARED_SEC_A_DOC_ID)

    @pytest.fixture(scope="class")
    def shared_sec_b_chunks(self, shared_page_setup, config, opensearch_client):
        return _docs_for(opensearch_client, config.OPENSEARCH_INDEX_NAME, _SHARED_SEC_B_DOC_ID)

    def test_sec_a_has_indexed_chunks(self, shared_sec_a_chunks):
        assert len(shared_sec_a_chunks) > 0, "Shared Sec A has no indexed chunks"

    def test_sec_b_has_indexed_chunks(self, shared_sec_b_chunks):
        assert len(shared_sec_b_chunks) > 0, "Shared Sec B has no indexed chunks"

    def test_sec_a_page_numbers_in_range(self, shared_sec_a_chunks):
        """Sec A may only contain logical pages 1, 2."""
        for doc in shared_sec_a_chunks:
            pn = doc["_source"]["page_number"]
            assert pn in (1, 2), f"Sec A chunk has unexpected page_number={pn}"

    def test_sec_b_page_numbers_in_range(self, shared_sec_b_chunks):
        """Sec B may only contain logical pages 3, 4, 5."""
        for doc in shared_sec_b_chunks:
            pn = doc["_source"]["page_number"]
            assert pn in (3, 4, 5), f"Sec B chunk has unexpected page_number={pn}"

    def test_shared_page_boundary_sec_a(self, shared_sec_a_chunks):
        """Logical page 2 (left of PDF page 2) must be in Sec A.
        Logical page 3 (right of PDF page 2) must NOT leak into Sec A."""
        pages = [doc["_source"]["page_number"] for doc in shared_sec_a_chunks]
        assert 3 not in pages, "Logical page 3 (right of PDF page 2) leaked into Sec A"

    def test_shared_page_boundary_sec_b(self, shared_sec_b_chunks):
        """Logical page 3 (right of PDF page 2) must be in Sec B.
        Logical page 2 (left of PDF page 2) must NOT leak into Sec B."""
        pages = [doc["_source"]["page_number"] for doc in shared_sec_b_chunks]
        assert 2 not in pages, (
            "Logical page 2 (left of PDF page 2) leaked into Sec B — "
            "start_side trim did not fire correctly"
        )

    def test_sec_a_pdf_page_numbers_correct(self, shared_sec_a_chunks):
        for doc in shared_sec_a_chunks:
            src = doc["_source"]
            pn = src["page_number"]
            expected_pdf = self._SHARED_SEC_A_PAGE_MAP[str(pn)]
            assert src["pdf_page_number"] == expected_pdf, (
                f"Sec A logical page {pn}: expected pdf_page_number={expected_pdf}, "
                f"got {src['pdf_page_number']}"
            )

    def test_sec_b_pdf_page_numbers_correct(self, shared_sec_b_chunks):
        for doc in shared_sec_b_chunks:
            src = doc["_source"]
            pn = src["page_number"]
            expected_pdf = self._SHARED_SEC_B_PAGE_MAP[str(pn)]
            assert src["pdf_page_number"] == expected_pdf, (
                f"Sec B logical page {pn}: expected pdf_page_number={expected_pdf}, "
                f"got {src['pdf_page_number']}"
            )


# ═══════════════════════════════════════════════════════════════════════════════
# TestBookStartAnchor
# ═══════════════════════════════════════════════════════════════════════════════

class TestBookStartAnchor:
    """
    Verify that book_start_page anchors logical page 1 to the first PDF page of the book.

    Uses bangalore_hindi.pdf with start_page=3 so the book content starts at PDF page 3:
      book_start_page = 3  →  base = (pdf_page - 3) * 2 + 1
      PDF page 3 → logical pages 1 (left), 2 (right)
      PDF page 4 → logical pages 3 (left), 4 (right)

    Key invariant: logical page 1 must map to PDF page 3, NOT page 5.
    The old formula (pdf_page - 1) * 2 + 1 would give PDF page 3 → logical 5.
    """

    # Expected page_mapping with book_start_page=3
    _ANCHOR_PAGE_MAP = {"1": 3, "2": 3, "3": 4, "4": 4}

    @pytest.fixture(scope="class")
    def book_start_anchor_setup(self, config, opensearch_client):
        global _ANCHOR_DOC_ID

        all_indices = [config.OPENSEARCH_INDEX_NAME, config.OPENSEARCH_METADATA_INDEX_NAME]
        for idx in all_indices:
            opensearch_client.indices.delete(index=idx, ignore=[400, 404])
        create_indices_if_not_exists(config, opensearch_client)

        base_dir = tempfile.mkdtemp(prefix="book_anchor_")
        pdf_dir  = os.path.join(base_dir, "data", "pdfs")
        ocr_dir  = os.path.join(base_dir, "data", "ocr")
        text_dir = os.path.join(base_dir, "data", "texts")
        db_path  = os.path.join(base_dir, "crawl_state.db")

        os.makedirs(pdf_dir)
        os.makedirs(ocr_dir)
        os.makedirs(text_dir)

        shutil.copy(_BANGALORE_PDF, os.path.join(pdf_dir, "bangalore_hindi.pdf"))

        write_config_file(os.path.join(pdf_dir, "config.json"),
                          {"language": "hi", "category": "Pravachan"})

        # book_start_page=3: logical page 1 is anchored to PDF page 3.
        # start_page=3, end_page=4: OCR range — only PDF pages 3–4 are processed.
        write_config_file(os.path.join(pdf_dir, "scan_config.json"), {
            "default": {
                "chunk_strategy":   "advanced",
                "multi_page":       True,
                "ignore_bookmarks": True,
                "language":         "hi",
                "psm":              6,
            },
            "bangalore_hindi": {
                "book_start_page": 3,
                "book_start_side": "left",
                "start_page":      3,
                "end_page":        4,
            },
        })

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
            discovery.crawl(process=True, index=True)
            opensearch_client.indices.refresh(index=config.OPENSEARCH_INDEX_NAME)

            all_hits = opensearch_client.search(
                index=config.OPENSEARCH_INDEX_NAME,
                body={"size": 500, "query": {"match_all": {}}},
            )["hits"]["hits"]

            for hit in all_hits:
                if "bangalore_hindi" in hit["_source"].get("original_filename", ""):
                    _ANCHOR_DOC_ID = hit["_source"]["document_id"]
                    break

            yield {"ocr_dir": os.path.join(ocr_dir, "bangalore_hindi")}

        finally:
            crawler.update(orig)
            shutil.rmtree(base_dir, ignore_errors=True)
            for idx in all_indices:
                opensearch_client.indices.delete(index=idx, ignore=[400, 404])

    # ── OCR file assertions ────────────────────────────────────────────────────

    def test_ocr_files_start_at_logical_page_1(self, book_start_anchor_setup):
        """PDF pages 3–4 produce logical pages 1–4; files page_0001..page_0004 must exist."""
        ocr_dir = book_start_anchor_setup["ocr_dir"]
        for lp in range(1, 5):
            path = os.path.join(ocr_dir, f"page_{lp:04d}.json")
            assert os.path.exists(path), f"Missing OCR file: page_{lp:04d}.json"

    def test_no_high_logical_page_ocr_files(self, book_start_anchor_setup):
        """With start_page=3, logical pages 5+ must not exist (old formula would produce them)."""
        ocr_dir = book_start_anchor_setup["ocr_dir"]
        for lp in range(5, 9):
            path = os.path.join(ocr_dir, f"page_{lp:04d}.json")
            assert not os.path.exists(path), (
                f"Unexpected OCR file page_{lp:04d}.json — "
                "old (pdf_page-1)*2+1 formula may still be in use"
            )

    # ── page_mapping.json assertions ──────────────────────────────────────────

    def test_page_mapping_has_4_entries(self, book_start_anchor_setup):
        ocr_dir = book_start_anchor_setup["ocr_dir"]
        with open(os.path.join(ocr_dir, "page_mapping.json")) as fh:
            mapping = json.load(fh)
        assert len(mapping) == 4

    def test_page_mapping_exact(self, book_start_anchor_setup):
        """Logical page 1 must map to PDF page 3, not page 5."""
        ocr_dir = book_start_anchor_setup["ocr_dir"]
        with open(os.path.join(ocr_dir, "page_mapping.json")) as fh:
            mapping = json.load(fh)
        assert mapping == self._ANCHOR_PAGE_MAP, (
            f"page_mapping mismatch.\n"
            f"Expected: {self._ANCHOR_PAGE_MAP}\n"
            f"Got:      {mapping}\n"
            "If logical page 1 maps to PDF page 1, the book_start_page anchor is broken."
        )

    def test_logical_page_1_maps_to_pdf_page_3(self, book_start_anchor_setup):
        """Explicit check: logical page 1 → PDF page 3 (the book_start_page)."""
        ocr_dir = book_start_anchor_setup["ocr_dir"]
        with open(os.path.join(ocr_dir, "page_mapping.json")) as fh:
            mapping = json.load(fh)
        assert mapping["1"] == 3, (
            f"Logical page 1 should map to PDF page 3 (book_start_page), "
            f"got {mapping.get('1')}"
        )

    # ── OpenSearch indexing assertions ─────────────────────────────────────────

    @pytest.fixture(scope="class")
    def anchor_chunks(self, book_start_anchor_setup, config, opensearch_client):
        return _docs_for(opensearch_client, config.OPENSEARCH_INDEX_NAME, _ANCHOR_DOC_ID)

    def test_anchor_chunks_are_indexed(self, anchor_chunks):
        assert len(anchor_chunks) > 0, "No chunks indexed for book_start_anchor doc"

    def test_anchor_page_numbers_in_range(self, anchor_chunks):
        """All chunks must have page_number in [1, 4] — not [5, 8]."""
        for doc in anchor_chunks:
            pn = doc["_source"]["page_number"]
            assert 1 <= pn <= 4, (
                f"Chunk has page_number={pn}; expected 1–4. "
                "book_start_page anchor may be broken."
            )

    def test_anchor_pdf_page_numbers_in_range(self, anchor_chunks):
        """All chunks must have pdf_page_number in {3, 4}."""
        for doc in anchor_chunks:
            ppn = doc["_source"]["pdf_page_number"]
            assert ppn in (3, 4), (
                f"Chunk has pdf_page_number={ppn}; expected 3 or 4."
            )

    def test_anchor_pdf_page_numbers_match_mapping(self, anchor_chunks):
        """Each chunk's pdf_page_number must match the expected page_mapping."""
        for doc in anchor_chunks:
            src = doc["_source"]
            pn = src["page_number"]
            expected_pdf = self._ANCHOR_PAGE_MAP[str(pn)]
            assert src["pdf_page_number"] == expected_pdf, (
                f"Logical page {pn}: expected pdf_page_number={expected_pdf}, "
                f"got {src['pdf_page_number']}"
            )
