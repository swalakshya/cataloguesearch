"""Unit tests for ResultRanker.collate_and_rank and rrf_rank."""
import pytest

from backend.search.result_ranker import ResultRanker


def _r(doc_id, score, page_number=1):
    """Minimal result dict."""
    return {"document_id": doc_id, "page_number": page_number, "score": score, "text": "x"}


# ---------------------------------------------------------------------------
# _normalize_score
# ---------------------------------------------------------------------------

def test_normalize_score_zero_max():
    assert ResultRanker._normalize_score(5.0, 0.0) == 0.0


def test_normalize_score_normal():
    assert ResultRanker._normalize_score(3.0, 10.0) == pytest.approx(0.3)


def test_normalize_score_full():
    assert ResultRanker._normalize_score(7.0, 7.0) == pytest.approx(1.0)


# ---------------------------------------------------------------------------
# collate_and_rank
# ---------------------------------------------------------------------------

def test_collate_empty_lists():
    results, total = ResultRanker.collate_and_rank([], [], page_size=5, page_number=1)
    assert results == []
    assert total == 0


def test_collate_lexical_only_ordering():
    lex = [_r("doc1", 10.0), _r("doc2", 5.0)]
    results, total = ResultRanker.collate_and_rank(lex, [], page_size=5, page_number=1)
    assert total == 2
    assert results[0]["document_id"] == "doc1"
    assert results[1]["document_id"] == "doc2"


def test_collate_vector_only_ordering():
    vec = [_r("doc1", 8.0), _r("doc2", 4.0)]
    results, total = ResultRanker.collate_and_rank([], vec, page_size=5, page_number=1)
    assert total == 2
    assert results[0]["document_id"] == "doc1"


def test_collate_combined_score_overlap_wins():
    # docA appears in both → combined = 0.6*1.0 + 0.4*0.5 = 0.8
    # docB appears in vector only → combined = 0.6*0 + 0.4*1.0 = 0.4
    lex = [_r("docA", 10.0)]
    vec = [_r("docB", 10.0), _r("docA", 5.0)]
    results, total = ResultRanker.collate_and_rank(lex, vec, page_size=5, page_number=1)
    assert total == 2
    docA = next(r for r in results if r["document_id"] == "docA")
    docB = next(r for r in results if r["document_id"] == "docB")
    assert docA["score"] > docB["score"]


def test_collate_result_carries_lexical_and_vector_scores():
    lex = [_r("doc1", 10.0)]
    vec = [_r("doc1", 8.0)]
    results, _ = ResultRanker.collate_and_rank(lex, vec, page_size=5, page_number=1)
    r = results[0]
    assert "lexical_score" in r
    assert "vector_score" in r
    assert r["lexical_score"] == pytest.approx(10.0)
    assert r["vector_score"] == pytest.approx(8.0)


def test_collate_pagination_page2():
    lex = [_r(f"doc{i}", float(10 - i)) for i in range(6)]
    results, total = ResultRanker.collate_and_rank(lex, [], page_size=3, page_number=2)
    assert total == 6
    assert len(results) == 3


def test_collate_pagination_beyond_end():
    lex = [_r("doc1", 5.0)]
    results, total = ResultRanker.collate_and_rank(lex, [], page_size=3, page_number=2)
    assert total == 1
    assert results == []


def test_collate_all_zero_scores():
    # max_score = 0 → _normalize_score returns 0 → combined score = 0 for all
    lex = [_r("doc1", 0.0), _r("doc2", 0.0)]
    results, total = ResultRanker.collate_and_rank(lex, [], page_size=5, page_number=1)
    assert total == 2
    for r in results:
        assert r["score"] == pytest.approx(0.0)


# ---------------------------------------------------------------------------
# rrf_rank
# ---------------------------------------------------------------------------

def test_rrf_empty_both():
    assert ResultRanker.rrf_rank([], []) == []


def test_rrf_lexical_only_ordering():
    lex = [_r("doc1", 10.0), _r("doc2", 5.0)]
    ranked = ResultRanker.rrf_rank(lex, [])
    assert len(ranked) == 2
    # doc1 at rank 0 → higher RRF score than doc2 at rank 1
    assert ranked[0]["document_id"] == "doc1"


def test_rrf_vector_only_ordering():
    vec = [_r("doc1", 9.0), _r("doc2", 3.0)]
    ranked = ResultRanker.rrf_rank([], vec)
    assert len(ranked) == 2
    assert ranked[0]["document_id"] == "doc1"


def test_rrf_disjoint_both_present():
    lex = [_r("docA", 10.0)]
    vec = [_r("docB", 10.0)]
    ranked = ResultRanker.rrf_rank(lex, vec)
    assert len(ranked) == 2
    ids = {r["document_id"] for r in ranked}
    assert ids == {"docA", "docB"}


def test_rrf_overlap_scores_higher_than_single_source():
    # docA rank 0 in both → score = 1/(61) + 1/(61) = 2/61
    # docB rank 1 in lexical only → score = 1/(62)
    lex = [_r("docA", 10.0), _r("docB", 8.0)]
    vec = [_r("docA", 9.0)]
    ranked = ResultRanker.rrf_rank(lex, vec)
    assert ranked[0]["document_id"] == "docA"


def test_rrf_scores_stored_on_result():
    lex = [_r("doc1", 7.5)]
    vec = [_r("doc1", 3.2)]
    ranked = ResultRanker.rrf_rank(lex, vec)
    r = ranked[0]
    assert r["lexical_score"] == pytest.approx(7.5)
    assert r["vector_score"] == pytest.approx(3.2)
    assert r["score"] > 0


def test_rrf_missing_document_id_skipped():
    lex = [{"score": 5.0, "text": "no doc_id", "page_number": 1}]
    ranked = ResultRanker.rrf_rank(lex, [])
    assert ranked == []


def test_rrf_custom_k_higher_score():
    # Smaller k → higher RRF contribution for same rank position
    lex = [_r("doc1", 5.0)]
    r_k60 = ResultRanker.rrf_rank(lex, [], k=60)
    r_k10 = ResultRanker.rrf_rank(lex, [], k=10)
    assert r_k10[0]["score"] > r_k60[0]["score"]


def test_rrf_rrf_score_formula():
    # doc at rank 0 in lexical only, k=60 → score = 1/(60+0+1) = 1/61
    lex = [_r("doc1", 5.0)]
    ranked = ResultRanker.rrf_rank(lex, [], k=60)
    assert ranked[0]["score"] == pytest.approx(1.0 / 61)
