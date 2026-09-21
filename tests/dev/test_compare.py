"""Dev-vs-prod OpenSearch comparison: the report logic, and that a failing side never raises."""
import pytest

from deploy import compare
from deploy.compare import INDICES, MAIN_INDEX

META, CAT = INDICES[1], INDICES[2]


def doc(chunks, newest=1, name="Book"):
    return {"chunks": chunks, "newest": newest, "name": name}


def side(docs, meta=None, cat=None, exists=True):
    small = {META: meta if meta is not None else {"a": "1"}, CAT: cat if cat is not None else {"x": "1"}}
    facts = {MAIN_INDEX: {"exists": exists, "docs": sum(d["chunks"] for d in docs.values()), "bytes": 1},
             META: {"exists": True, "docs": len(small[META]), "bytes": 1},
             CAT: {"exists": True, "docs": len(small[CAT]), "bytes": 1}}
    return {"facts": facts, "docs": docs, "small": small}


def report(dev, prod):
    return {i["name"]: i for i in compare.build_report(dev, prod)["indices"]}, compare.build_report(dev, prod)


def test_identical_sides_are_in_sync():
    same = {"d1": doc(10), "d2": doc(5)}
    _, r = report(side(same), side(dict(same)))
    assert r["in_sync"] and r["differing"] == []


def test_a_file_only_indexed_on_dev_is_missing_on_prod():
    idx, r = report(side({"d1": doc(10), "d2": doc(5, name="New book")}), side({"d1": doc(10)}))
    assert not r["in_sync"] and r["differing"] == [MAIN_INDEX]
    missing = idx[MAIN_INDEX]["diff"]["missing_on_prod"]
    assert missing["total"] == 1 and missing["items"][0]["name"] == "New book"


def test_a_file_only_on_prod_is_reported_separately():
    idx, _ = report(side({"d1": doc(10)}), side({"d1": doc(10), "old": doc(3)}))
    diff = idx[MAIN_INDEX]["diff"]
    assert diff["only_on_prod"]["total"] == 1 and diff["missing_on_prod"]["total"] == 0


def test_a_reindexed_file_is_changed_even_with_the_same_chunk_count():
    idx, r = report(side({"d1": doc(10, newest=2)}), side({"d1": doc(10, newest=1)}))
    assert idx[MAIN_INDEX]["diff"]["changed"]["total"] == 1 and not r["in_sync"]


def test_chunk_count_change_shows_the_prod_count():
    idx, _ = report(side({"d1": doc(12)}), side({"d1": doc(10)}))
    item = idx[MAIN_INDEX]["diff"]["changed"]["items"][0]
    assert (item["chunks"], item["prod_chunks"]) == (12, 10)


def test_small_index_content_change_is_caught():
    idx, r = report(side({"d1": doc(1)}, cat={"x": "new"}), side({"d1": doc(1)}, cat={"x": "old", "y": "1"}))
    diff = idx[CAT]["diff"]
    assert (diff["changed"]["total"], diff["only_on_prod"]["total"]) == (1, 1) and r["differing"] == [CAT]


def test_index_missing_on_one_side_is_a_difference_not_a_crash():
    dev = side({"d1": doc(1)})
    prod = side({}, exists=False)
    prod["facts"][MAIN_INDEX] = {"exists": False}
    prod["docs"] = None
    idx, r = report(dev, prod)
    assert idx[MAIN_INDEX]["diff"] is None and not r["in_sync"]


def test_long_lists_are_capped_but_the_total_is_exact(monkeypatch):
    monkeypatch.setattr(compare, "LIST_LIMIT", 3)
    dev = {f"d{i}": doc(1, name=f"b{i}") for i in range(10)}
    idx, _ = report(side(dev), side({}))
    missing = idx[MAIN_INDEX]["diff"]["missing_on_prod"]
    assert missing["total"] == 10 and len(missing["items"]) == 3


@pytest.mark.parametrize("broken", ["dev", "prod"])
def test_an_unreachable_side_returns_an_error(monkeypatch, broken):
    good = side({"d1": doc(1)})

    def snap(call):
        if call is (compare._local if broken == "dev" else compare._prod):
            raise RuntimeError("connection refused")
        return good
    monkeypatch.setattr(compare, "_snapshot", snap)
    assert broken in compare.compare()["error"]
