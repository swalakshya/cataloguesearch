"""Batched, bounded neighbour context for request-local reranking candidates."""
import logging
from collections import defaultdict

from backend.common.language import text_field_for_language, normalize_language

log = logging.getLogger(__name__)
NEIGHBOUR_CHARS = 350
MODEL_TOKEN_LIMIT = 512  # The deployed bge-reranker-base graph supports 512 tokens.


def context_token_limit(tokenizer, configured_limit):
    return max(8, min(int(configured_limit), int(tokenizer.model_max_length), MODEL_TOKEN_LIMIT))


def _trim(text, fits, tail=False):
    """Trim characters rather than decoding token IDs, preserving source text."""
    if fits(text):
        return text
    low, high = 0, len(text)
    while low < high:
        mid = (low + high + 1) // 2
        part = text[-mid:] if tail and mid else text[:mid]
        if fits(part):
            low = mid
        else:
            high = mid - 1
    return text[-low:] if tail and low else text[:low]


def _key(hit):
    source = hit.get("_source", {})
    try:
        para = int(source["paragraph_id"])
        doc = source["document_id"]
        return (doc, para) if doc else None
    except (KeyError, TypeError, ValueError):
        return None


def _compatible(central, neighbour, field):
    c, n = central.get("_source", {}), neighbour.get("_source", {})
    if c.get("document_id") != n.get("document_id") or not str(n.get(field) or "").strip():
        return False
    for section, keys in [("chunk_labels", ("pravachan_number", "date")),
                          ("metadata", ("Name", "category", "sub_section"))]:
        cm, nm = c.get(section) or {}, n.get(section) or {}
        for key in keys:
            if cm.get(key) is not None and nm.get(key) is not None and cm[key] != nm[key]:
                return False
    return True


def _fields(field):
    return ["document_id", "paragraph_id", "original_filename", "page_number", "pdf_page_number",
            "language", "metadata", "chunk_labels", field]


def enrich_hits(hits, client, index, language, query, tokenizer, configured_limit):
    """Use one neighbour search; reuse candidates already in the retrieved pool."""
    language = normalize_language(language)
    field = text_field_for_language(language)
    limit = context_token_limit(tokenizer, configured_limit)
    query = _trim(query, lambda text: len(tokenizer.encode(text, add_special_tokens=False)) <= min(128, limit // 4))
    budget = limit - len(tokenizer.encode(query, add_special_tokens=False)) - tokenizer.num_special_tokens_to_add(pair=True)
    by_key = {_key(h): h for h in hits if _key(h)}
    wanted = set()
    for key in by_key:
        doc, para = key
        wanted.update((doc, n) for n in (para - 1, para + 1) if n >= 0 and (doc, n) not in by_key)
    if wanted:
        grouped = defaultdict(list)
        for doc, para in sorted(wanted):
            grouped[doc].append(para)
        body = {"size": len(wanted), "timeout": "5s", "_source": _fields(field), "query": {"bool": {
            "filter": [{"exists": {"field": field}}, {"term": {"language": language}},
                       {"bool": {"minimum_should_match": 1, "should": [
                           {"bool": {"filter": [{"term": {"document_id": doc}},
                                                 {"terms": {"paragraph_id": paras}}]}}
                           for doc, paras in grouped.items()]}}]}}}
        try:
            response = client.search(index=index, body=body, request_timeout=8)
            if response.get("timed_out") or response.get("_shards", {}).get("failed", 0):
                log.warning("Context lookup returned partial results; missing neighbours use central text")
            for h in response.get("hits", {}).get("hits", []):
                if _key(h) in wanted:
                    by_key[_key(h)] = h
        except Exception:
            log.warning("Context lookup failed; using available candidate context", exc_info=True)
    output = []
    with_context = 0
    for hit in hits:
        item = dict(hit)
        centre = str(hit.get("_source", {}).get(field) or "")[:1000]
        centre = _trim(centre, lambda text: len(tokenizer.encode(text, add_special_tokens=False)) <= budget)
        key = _key(hit)
        neighbours = {}
        if key:
            for direction, para in [("previous", key[1] - 1), ("next", key[1] + 1)]:
                neighbour = by_key.get((key[0], para))
                if neighbour and _compatible(hit, neighbour, field):
                    neighbours[direction] = neighbour
        before = str(neighbours.get("previous", {}).get("_source", {}).get(field) or "")[-NEIGHBOUR_CHARS:]
        after = str(neighbours.get("next", {}).get("_source", {}).get(field) or "")[:NEIGHBOUR_CHARS]

        def window(n):
            return "\n".join(t for t in [before[-n:] if n else "", centre, after[:n]] if t)

        # Trim neighbours first; keep the central passage's token budget intact.
        low, high = 0, NEIGHBOUR_CHARS
        while low < high:
            mid = (low + high + 1) // 2
            if len(tokenizer.encode(window(mid), add_special_tokens=False)) <= budget:
                low = mid
            else:
                high = mid - 1
        item["_rerank_query"] = query
        item["_rerank_text"] = window(low)
        context = {}
        for direction, excerpt in [("previous", before[-low:] if low else ""), ("next", after[:low])]:
            if excerpt:
                neighbour = neighbours[direction]
                context[direction] = dict(neighbour, _source=dict(neighbour["_source"], **{field: excerpt}))
        if context:
            item["_rerank_context"] = context
            with_context += 1
        output.append(item)
    log.info("Context reranking: candidates=%s expanded=%s neighbour_lookups=%s token_limit=%s",
             len(hits), with_context, int(bool(wanted)), limit)
    return output


def enrich_results(results, client, index, language, query, tokenizer, configured_limit):
    """RRF results no longer have original sources: recover them with one mget."""
    field = text_field_for_language(language)
    try:
        response = client.mget(index=index, body={"docs": [
            {"_id": r["document_id"], "_source": _fields(field)} for r in results]}, request_timeout=8)
        sources = {d["_id"]: d for d in response.get("docs", []) if d.get("found")}
    except Exception:
        log.warning("Context central-source lookup failed; using RRF snippets", exc_info=True)
        sources = {}
    hits = [sources.get(r["document_id"], {"_id": r["document_id"], "_source": {field: r.get("content_snippet", "")}})
            for r in results]
    expanded = enrich_hits(hits, client, index, language, query, tokenizer, configured_limit)
    return [dict(r, **{k: v for k, v in h.items() if k.startswith("_rerank_")}) for r, h in zip(results, expanded)]
