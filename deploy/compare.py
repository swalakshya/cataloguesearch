"""Read-only comparison of the OpenSearch indices this machine would push to prod against what prod has now.

Both sides are asked the same questions through the OpenSearch REST API (prod through ssh + curl on the prod host).
Only the three snapshotted indices are compared. Nothing here writes.
"""
import json
import subprocess
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable, Dict, List

import requests

from deploy import settings

INDICES = ["cataloguesearch_prod", "cataloguesearch_prod_metadata", "cataloguesearch_prod_catalogue"]
MAIN_INDEX = INDICES[0]
LIST_LIMIT = 200          # rows shown per kind of difference; the totals are always exact
_TIMEOUT = 60
_PAGE = 2000

Search = Callable[[str, str, Any], Dict[str, Any]]  # (method, path, body) -> parsed JSON


def _local(method: str, path: str, body: Any = None) -> Dict[str, Any]:
    resp = requests.request(method, f"{settings.OPENSEARCH_URL}{path}", json=body, timeout=_TIMEOUT)
    resp.raise_for_status()
    return resp.json()


def _prod(method: str, path: str, body: Any = None) -> Dict[str, Any]:
    cmd = f"curl -sf -m {_TIMEOUT} -X {method} -H 'Content-Type: application/json' -d @- 'localhost:9200{path}'"
    proc = subprocess.run(["ssh", *settings.SSH_OPTS, settings.PROD_HOST, cmd],
                          input=json.dumps(body if body is not None else {}), capture_output=True, text=True,
                          timeout=_TIMEOUT + 15)
    if proc.returncode != 0:
        raise RuntimeError((proc.stderr or f"prod OpenSearch query failed (exit {proc.returncode})").strip()[:200])
    return json.loads(proc.stdout)


def _index_facts(call: Search, index: str) -> Dict[str, Any]:
    """Doc count and on-disk size, or exists=False."""
    try:
        count = call("GET", f"/{index}/_count", None)["count"]
    except (requests.HTTPError, RuntimeError):
        return {"exists": False}
    rows = call("GET", f"/_cat/indices/{index}?format=json&bytes=b&h=store.size", None)
    return {"exists": True, "docs": count, "bytes": int(rows[0]["store.size"]) if rows else 0}


def _documents(call: Search) -> Dict[str, Dict[str, Any]]:
    """document_id -> {chunks, newest, name} for the main index (one composite-aggregation pass)."""
    out: Dict[str, Dict[str, Any]] = {}
    after = None
    while True:
        comp: Dict[str, Any] = {"size": _PAGE, "sources": [{"d": {"terms": {"field": "document_id"}}}]}
        if after:
            comp["after"] = after
        res = call("POST", f"/{MAIN_INDEX}/_search", {"size": 0, "aggs": {"docs": {
            "composite": comp,
            "aggs": {"newest": {"max": {"field": "timestamp_indexed"}},
                     "name": {"terms": {"field": "original_filename", "size": 1}}}}}})
        agg = res["aggregations"]["docs"]
        for b in agg["buckets"]:
            names = b["name"]["buckets"]
            out[b["key"]["d"]] = {"chunks": b["doc_count"], "newest": b["newest"].get("value"),
                                  "name": names[0]["key"] if names else b["key"]["d"]}
        after = agg.get("after_key")
        if not after or not agg["buckets"]:
            return out


def _small_index(call: Search, index: str) -> Dict[str, str]:
    """id -> canonical JSON of _source, for the tiny metadata / catalogue indices."""
    rows: Dict[str, str] = {}
    res = call("POST", f"/{index}/_search", {"size": 10000, "sort": ["_doc"], "query": {"match_all": {}}})
    for hit in res["hits"]["hits"]:
        rows[hit["_id"]] = json.dumps(hit["_source"], sort_keys=True, ensure_ascii=False)
    return rows


def _snapshot(call: Search) -> Dict[str, Any]:
    facts = {i: _index_facts(call, i) for i in INDICES}
    snap: Dict[str, Any] = {"facts": facts, "docs": None, "small": {}}
    if facts[MAIN_INDEX]["exists"]:
        snap["docs"] = _documents(call)
    for index in INDICES[1:]:
        if facts[index]["exists"]:
            snap["small"][index] = _small_index(call, index)
    return snap


def _diff_documents(dev: Dict[str, Dict], prod: Dict[str, Dict]) -> Dict[str, Any]:
    def row(d: str, info: Dict, **extra):
        return {"document_id": d, "name": info["name"], "chunks": info["chunks"], **extra}

    missing = [row(d, dev[d]) for d in dev.keys() - prod.keys()]
    extra = [row(d, prod[d]) for d in prod.keys() - dev.keys()]
    changed = []
    for d in dev.keys() & prod.keys():
        a, b = dev[d], prod[d]
        if a["chunks"] != b["chunks"] or a["newest"] != b["newest"]:
            changed.append({**row(d, a), "prod_chunks": b["chunks"]})
    for group in (missing, extra, changed):
        group.sort(key=lambda r: (r["name"], r["document_id"]))
    return {
        "missing_on_prod": {"total": len(missing), "items": missing[:LIST_LIMIT]},
        "only_on_prod": {"total": len(extra), "items": extra[:LIST_LIMIT]},
        "changed": {"total": len(changed), "items": changed[:LIST_LIMIT]},
    }


def _diff_small(dev: Dict[str, str], prod: Dict[str, str]) -> Dict[str, Any]:
    keys = {
        "missing_on_prod": sorted(dev.keys() - prod.keys()),
        "only_on_prod": sorted(prod.keys() - dev.keys()),
        "changed": sorted(k for k in dev.keys() & prod.keys() if dev[k] != prod[k]),
    }
    return {kind: {"total": len(ids), "items": ids[:LIST_LIMIT]} for kind, ids in keys.items()}


def build_report(dev: Dict[str, Any], prod: Dict[str, Any]) -> Dict[str, Any]:
    """Turn the two snapshots into the report the page shows. Pure, so it is easy to test."""
    indices = []
    for index in INDICES:
        d, p = dev["facts"][index], prod["facts"][index]
        entry: Dict[str, Any] = {"name": index, "dev": d, "prod": p}
        if not d["exists"] or not p["exists"]:
            entry["diff"] = None
            entry["in_sync"] = not d["exists"] and not p["exists"]
        else:
            if index == MAIN_INDEX:
                entry["diff"] = _diff_documents(dev["docs"], prod["docs"])
            else:
                entry["diff"] = _diff_small(dev["small"][index], prod["small"][index])
            entry["in_sync"] = d["docs"] == p["docs"] and all(v["total"] == 0 for v in entry["diff"].values())
        indices.append(entry)
    differing = [i["name"] for i in indices if not i["in_sync"]]
    return {"in_sync": not differing, "differing": differing, "indices": indices}


def compare() -> Dict[str, Any]:
    """Compare dev and prod. Errors on either side come back as {"error": ...}, never raised."""
    with ThreadPoolExecutor(max_workers=2) as pool:
        dev_f, prod_f = pool.submit(_snapshot, _local), pool.submit(_snapshot, _prod)
        errors = {}
        results = {}
        for side, fut in (("dev", dev_f), ("prod", prod_f)):
            try:
                results[side] = fut.result()
            except Exception as exc:  # noqa: BLE001
                errors[side] = str(exc)[:200] or type(exc).__name__
    if errors:
        return {"error": "; ".join(f"{side}: {msg}" for side, msg in errors.items())}
    return build_report(results["dev"], results["prod"])
