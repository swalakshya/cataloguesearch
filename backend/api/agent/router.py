import logging
import time
from typing import Any, Dict, List, Literal, Optional, Tuple

from fastapi import APIRouter, Body, HTTPException, Query, Request
from opensearchpy.exceptions import NotFoundError, TransportError
from pydantic import BaseModel, Field

from backend.common.opensearch import get_metadata, get_opensearch_client
from backend.search.result_ranker import ResultRanker
from backend.utils import JSONResponse

log_handle = logging.getLogger(__name__)

router = APIRouter(tags=["agent"])


class AgentSearchRequest(BaseModel):
    query: str = Field(..., description="Search text (Hindi or Gujarati)")
    language: Literal["hi", "gu"] = Field(..., description="Script language")
    content_type: List[Literal["Pravachan", "Granth", "Books"]] = Field(
        default=["Granth", "Books"], description="Filter by content categories"
    )
    anuyog: Optional[str] = Field(None, description="Anuyog classification")
    granth: Optional[str] = Field(None, description="Granth name")
    contributor: Optional[str] = Field(
        None, description="Author/Tikakaar/Bhasha Vachanika name"
    )
    year_from: Optional[int] = Field(None, description="Pravachan only")
    year_to: Optional[int] = Field(None, description="Pravachan only")
    page_size: int = Field(10, ge=1, le=50)
    page: int = Field(1, ge=1)
    rerank: bool = Field(True, description="Apply cross-encoder reranking")


class AgentNavigateRequest(BaseModel):
    chunk_id: str = Field(..., description="Starting chunk")
    direction: Literal["next", "prev", "both"] = Field("both")
    steps: int = Field(1, ge=1, le=20)


class AgentFindSimilarRequest(BaseModel):
    chunk_id: str = Field(..., description="Source chunk to find similarities for")


class AgentFilterOptionsRequest(BaseModel):
    language: Literal["hi", "gu"] = Field(..., description="Language context")
    content_type: Literal["Pravachan", "Granth", "Books"] = Field(..., description="Category")


class AgentGetPravachanRequest(BaseModel):
    granth: str = Field(..., description="Granth name")
    pravachan_number: str = Field(..., description="Pravachan number")
    language: Literal["hi", "gu"] = Field(..., description="Language")


class AgentMetadataOptionsRequest(BaseModel):
    language: Literal["hi", "gu"] = Field(..., description="Language context")
    content_type: Literal["Pravachan", "Granth", "Books"] = Field(..., description="Category")


class AgentShortenUrlRequest(BaseModel):
    long_url: str = Field(..., description="Original scan URL")


class AgentShortenUrlResponse(BaseModel):
    short_url: str


def _get_text_field(language: str) -> str:
    return "text_content_gujarati" if language == "gu" else "text_content_hindi"


def _first_value(dct: Dict[str, Any], keys: List[str]) -> Optional[Any]:
    for key in keys:
        if key in dct and dct[key] not in (None, ""):
            return dct[key]
    return None


def _chunk_from_hit(hit: Dict[str, Any], language: str) -> Dict[str, Any]:
    source = hit.get("_source", {})
    metadata = source.get("metadata", {})
    text_field = _get_text_field(language)

    # Be defensive: some hits can have `_score: null` or rerank_score missing.
    raw_score = hit.get("rerank_score", hit.get("_score", 0.0))
    try:
        score = float(raw_score) if raw_score is not None else 0.0
    except (TypeError, ValueError):
        score = 0.0

    return {
        "chunk_id": hit.get("_id") or source.get("chunk_id"),
        "text_content": source.get(text_field, ""),
        "category": metadata.get("category"),
        "granth": _first_value(metadata, ["Name"]),
        "author": _first_value(metadata, ["Author", "Tikakaar", "Teekakar", "Bhasha Vachanika"]),
        "anuyog": _first_value(metadata, ["Anuyog", "anuyog"]),
        "language": source.get("language", language),
        "date": source.get("chunk_labels", {}).get("date"),
        "pravachan_number": source.get("chunk_labels", {}).get("pravachan_number"),
        "gatha": source.get("chunk_labels", {}).get("gatha"),
        "page_number": source.get("page_number"),
        "file_url": metadata.get("file_url", ""),
        "score": score,
    }


def _build_date_range_filter(year_from: Optional[int], year_to: Optional[int]) -> Optional[Dict[str, Any]]:
    if year_from is None and year_to is None:
        return None

    search_start_date = f"{year_from}-01-01" if year_from is not None else None
    search_end_date = f"{year_to}-12-31" if year_to is not None else None

    should_conditions = []

    date_exists_and_in_range = {"bool": {"must": [{"exists": {"field": "date"}}]}}
    date_range_condition = {"range": {"date": {}}}
    if search_start_date:
        date_range_condition["range"]["date"]["gte"] = search_start_date
    if search_end_date:
        date_range_condition["range"]["date"]["lte"] = search_end_date
    date_exists_and_in_range["bool"]["must"].append(date_range_condition)
    should_conditions.append(date_exists_and_in_range)

    no_date_and_series_overlap = {
        "bool": {"must": [{"bool": {"must_not": [{"exists": {"field": "date"}}]}}]}
    }

    if search_end_date:
        no_date_and_series_overlap["bool"]["must"].append({
            "range": {"metadata.series_start_date": {"lte": search_end_date}}
        })

    if search_start_date:
        no_date_and_series_overlap["bool"]["must"].append({
            "range": {"metadata.series_end_date": {"gte": search_start_date}}
        })

    should_conditions.append(no_date_and_series_overlap)

    return {"bool": {"should": should_conditions, "minimum_should_match": 1}}


def _collect_file_urls(items: List[Dict[str, Any]]) -> List[str]:
    urls = []
    for item in items:
        url = item.get("file_url")
        if url:
            urls.append(url)
    return list(dict.fromkeys(urls))


def _apply_short_urls(items: List[Dict[str, Any]], short_map: Dict[str, str]) -> List[Dict[str, Any]]:
    """Apply short URL mapping to file_url in-place. Falls back to the original URL if not in map."""
    for item in items:
        url = item.get("file_url")
        if not url:
            item["file_url"] = ""
        else:
            item["file_url"] = short_map.get(url, url)
    return items


def _shorten_urls_with_store(store, base_url: str, urls: List[str]) -> Dict[str, str]:
    result: Dict[str, str] = {}
    for url in urls:
        code = store.get_code(url)
        if code:
            result[url] = f"{base_url.rstrip('/')}/url/{code}"
    return result


def _shorten_results(results: List[Dict[str, Any]], store, base_url: str) -> None:
    """Collect file_urls, build short_map, and apply to results in-place."""
    urls = _collect_file_urls(results)
    short_map = _shorten_urls_with_store(store, base_url, urls)
    _apply_short_urls(results, short_map)


def _extract_file_url_from_bucket(bucket: Dict[str, Any]) -> Optional[str]:
    hit = (
        bucket.get("file_url_hit", {})
        .get("hits", {})
        .get("hits", [])
    )
    if not hit:
        return None
    source = hit[0].get("_source", {})
    metadata = source.get("metadata", {})
    return metadata.get("file_url")


_ALL_CONTENT_TYPES = {"Pravachan", "Granth", "Books"}

_METADATA_OPTIONS_CACHE_TTL = 30 * 60  # 30 minutes, same as metadata_cache
# Maps (language, content_type) -> (results, expiry_timestamp)
_METADATA_OPTIONS_CACHE: Dict[Tuple[str, str], Tuple[List[Dict[str, Optional[str]]], float]] = {}


def _build_metadata_options_query(language: str, content_type: str, size: int = 1000) -> Dict[str, Any]:
    author_script = (
        "if (doc.containsKey('metadata.Author.keyword') && !doc['metadata.Author.keyword'].empty) { emit(doc['metadata.Author.keyword'].value); return; }"
        "if (doc.containsKey('metadata.Tikakaar.keyword') && !doc['metadata.Tikakaar.keyword'].empty) { emit(doc['metadata.Tikakaar.keyword'].value); return; }"
        "if (doc.containsKey('metadata.Teekakar.keyword') && !doc['metadata.Teekakar.keyword'].empty) { emit(doc['metadata.Teekakar.keyword'].value); return; }"
        "if (doc.containsKey('metadata.Bhasha Vachanika.keyword') && !doc['metadata.Bhasha Vachanika.keyword'].empty) { emit(doc['metadata.Bhasha Vachanika.keyword'].value); return; }"
    )

    return {
        "size": 0,
        "derived": {
            "author_coalesced": {
                "type": "keyword",
                "script": {"source": author_script},
            }
        },
        "query": {
            "bool": {
                "filter": [
                    {"term": {"language": language}},
                    {"term": {"metadata.category.keyword": content_type}},
                ]
            }
        },
        "aggs": {
            "granths": {
                "terms": {"field": "metadata.Name.keyword", "size": size},
                "aggs": {
                    "anuyogs": {
                        "terms": {"field": "metadata.Anuyog.keyword", "size": size, "missing": "__missing__"},
                        "aggs": {
                            "authors": {
                                "terms": {"field": "author_coalesced", "size": size, "missing": "__missing__"},
                                "aggs": {
                                    "file_url_hit": {
                                        "top_hits": {
                                            "size": 1,
                                            "_source": {"includes": ["metadata.file_url"]},
                                        }
                                    }
                                },
                            }
                        },
                    }
                },
            }
        },
    }


def _build_filters(payload: AgentSearchRequest) -> List[Dict[str, Any]]:
    filters: List[Dict[str, Any]] = []

    if set(payload.content_type) != _ALL_CONTENT_TYPES:
        filters.append({"terms": {"metadata.category.keyword": payload.content_type}})

    filters.append({"term": {"language": payload.language}})

    if payload.anuyog:
        filters.append({"term": {"metadata.Anuyog.keyword": payload.anuyog}})

    if payload.granth:
        filters.append({"term": {"metadata.Name.keyword": payload.granth}})

    if payload.contributor:
        contributor_should = []
        contributor_fields = [
            "metadata.Author.keyword",
            "metadata.Tikakaar.keyword",
            "metadata.Teekakar.keyword",
            "metadata.Bhasha Vachanika.keyword",
        ]
        for field in contributor_fields:
            contributor_should.append({"term": {field: payload.contributor}})
        filters.append({"bool": {"should": contributor_should, "minimum_should_match": 1}})

    if "Pravachan" in payload.content_type and (payload.year_from or payload.year_to):
        date_filter = _build_date_range_filter(payload.year_from, payload.year_to)
        if date_filter:
            filters.append(date_filter)

    return filters


@router.post("/search", summary="Search catalogue chunks")
async def agent_search(request: Request, payload: AgentSearchRequest = Body(...)):
    """
    Hybrid search over the Jain texts corpus.

    For short or exact-match queries (lexical mode), runs a boolean keyword search.
    For natural-language queries (semantic mode), generates a vector embedding, retrieves
    the top candidates via KNN, and optionally re-scores them with a cross-encoder reranker
    (BAAI/bge-reranker-base) before returning the top N results.

    The `contributor` filter matches across Author, Tikakaar, and Bhasha Vachanika — callers
    do not need to know which role a person holds.
    """
    try:
        log_handle.info(
            "agent_search request",
            extra={
                "language": payload.language,
                "content_type": payload.content_type,
                "page": payload.page,
                "page_size": payload.page_size,
                "rerank": payload.rerank,
                "has_anuyog": bool(payload.anuyog),
                "has_granth": bool(payload.granth),
                "has_contributor": bool(payload.contributor),
                "year_from": payload.year_from,
                "year_to": payload.year_to,
                "query_len": len(payload.query or ""),
            },
        )

        config = request.app.state.config
        index_searcher = request.app.state.index_searcher
        embedding_model = request.app.state.embedding_model
        client = get_opensearch_client(config)

        search_mode = config.SEARCH_MODE
        is_lexical = (
            index_searcher.is_lexical_query(payload.query)
            if search_mode == "auto"
            else (search_mode == "lexical")
        )
        filters = _build_filters(payload)

        text_field = _get_text_field(payload.language)
        from_ = (payload.page - 1) * payload.page_size

        log_handle.debug("agent_search mode=%s", search_mode)

        # --- RRF mode ---
        if search_mode == "rrf":
            query_embedding = embedding_model.get_embedding(payload.query)
            if not query_embedding:
                log_handle.warning("agent_search RRF produced empty embedding; returning empty results")
                return JSONResponse(content=[], status_code=200)

            oversample = config.RERANK_OVERSAMPLE

            # BM25 leg
            bm25_body = {
                "query": {
                    "bool": {
                        "must": [{"match": {text_field: {"query": payload.query, "operator": "and"}}}],
                        "filter": filters,
                    }
                }
            }
            try:
                bm25_response = client.search(
                    index=config.OPENSEARCH_INDEX_NAME,
                    body=bm25_body,
                    size=oversample,
                    from_=0,
                )
                bm25_hits = bm25_response.get("hits", {}).get("hits", [])
            except Exception:
                log_handle.warning("agent_search RRF: BM25 leg failed", exc_info=True)
                bm25_hits = []

            # kNN leg
            knn_query: Dict[str, Any] = {"vector_embedding": {"vector": query_embedding, "k": oversample}}
            if filters:
                knn_query["vector_embedding"]["filter"] = {"bool": {"filter": filters}}
            try:
                knn_response = client.search(
                    index=config.OPENSEARCH_INDEX_NAME,
                    body={"size": oversample, "query": {"knn": knn_query}},
                    size=oversample,
                    from_=0,
                )
                knn_hits = knn_response.get("hits", {}).get("hits", [])
            except Exception:
                log_handle.warning("agent_search RRF: kNN leg failed", exc_info=True)
                knn_hits = []

            # Convert to RRF-compatible dicts (document_id = chunk _id for dedup)
            def _hits_to_rrf(hits: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
                return [{"document_id": h["_id"], "score": h.get("_score") or 0.0, "_hit": h} for h in hits]

            fused = ResultRanker.rrf_rank(_hits_to_rrf(bm25_hits), _hits_to_rrf(knn_hits))
            log_handle.info("agent_search RRF bm25=%s knn=%s fused=%s", len(bm25_hits), len(knn_hits), len(fused))

            if payload.rerank and index_searcher._reranker and fused:
                sentence_pairs = [
                    [payload.query, (item["_hit"].get("_source", {}).get(text_field, ""))[:1000]]
                    for item in fused
                ]
                try:
                    rerank_scores = index_searcher._reranker.predict(
                        sentence_pairs,
                        batch_size=config.RERANK_BATCH_SIZE,
                        max_length=config.RERANK_MAX_LENGTH,
                    )
                    for item, score in zip(fused, rerank_scores):
                        item["rerank_score"] = float(score)
                    fused.sort(key=lambda x: x.get("rerank_score", 0.0), reverse=True)
                except Exception as rerank_exc:
                    log_handle.exception("agent_search RRF reranking failed; using RRF order: %s", rerank_exc)

            paginated = fused[from_:from_ + payload.page_size]
            results = [_chunk_from_hit(item["_hit"], payload.language) for item in paginated]
            _shorten_results(results, request.app.state.shortener_store, request.app.state.shortener_base_url)
            return JSONResponse(content=results, status_code=200)

        # --- Lexical mode ---
        if is_lexical:
            query_body = {
                "query": {
                    "bool": {
                        "must": [{"match": {text_field: {"query": payload.query, "operator": "and"}}}],
                        "filter": filters
                    }
                }
            }
            response = client.search(
                index=config.OPENSEARCH_INDEX_NAME,
                body=query_body,
                size=payload.page_size,
                from_=from_
            )
            hits = response.get("hits", {}).get("hits", [])
            log_handle.info("agent_search lexical hits=%s", len(hits))
            results = [_chunk_from_hit(hit, payload.language) for hit in hits]
            _shorten_results(results, request.app.state.shortener_store, request.app.state.shortener_base_url)
            return JSONResponse(content=results, status_code=200)

        # --- Vector mode ---
        query_embedding = embedding_model.get_embedding(payload.query)
        if not query_embedding:
            log_handle.warning("agent_search produced empty embedding; returning empty results")
            return JSONResponse(content=[], status_code=200)

        initial_fetch_size = config.RERANK_OVERSAMPLE if payload.rerank else payload.page_size
        knn_query = {"vector_embedding": {"vector": query_embedding, "k": initial_fetch_size}}
        if filters:
            knn_query["vector_embedding"]["filter"] = {"bool": {"filter": filters}}

        response = client.search(
            index=config.OPENSEARCH_INDEX_NAME,
            body={"size": initial_fetch_size, "query": {"knn": knn_query}},
            size=initial_fetch_size,
            from_=0
        )
        hits = response.get("hits", {}).get("hits", [])
        log_handle.info("agent_search knn initial_hits=%s rerank=%s", len(hits), payload.rerank)

        if not payload.rerank or not index_searcher._reranker or not hits:
            if payload.rerank and not index_searcher._reranker:
                log_handle.warning("agent_search rerank requested but reranker not available; returning unreranked results")
            paginated = hits[from_:from_ + payload.page_size]
            results = [_chunk_from_hit(hit, payload.language) for hit in paginated]
            _shorten_results(results, request.app.state.shortener_store, request.app.state.shortener_base_url)
            return JSONResponse(content=results, status_code=200)

        sentence_pairs = []
        for hit in hits:
            doc_text = hit.get("_source", {}).get(text_field, "")
            truncated_text = doc_text[:1000] if len(doc_text) > 1000 else doc_text
            sentence_pairs.append([payload.query, truncated_text])

        try:
            rerank_scores = index_searcher._reranker.predict(
                sentence_pairs,
                batch_size=config.RERANK_BATCH_SIZE,
                max_length=config.RERANK_MAX_LENGTH,
            )
        except Exception as rerank_exc:
            log_handle.exception("agent_search reranking failed; returning unreranked results: %s", rerank_exc)
            paginated = hits[from_:from_ + payload.page_size]
            results = [_chunk_from_hit(hit, payload.language) for hit in paginated]
            _shorten_results(results, request.app.state.shortener_store, request.app.state.shortener_base_url)
            return JSONResponse(content=results, status_code=200)
        for hit, score in zip(hits, rerank_scores):
            hit["rerank_score"] = score

        reranked_hits = sorted(hits, key=lambda x: x["rerank_score"], reverse=True)
        paginated_hits = reranked_hits[from_:from_ + payload.page_size]
        results = [_chunk_from_hit(hit, payload.language) for hit in paginated_hits]
        _shorten_results(results, request.app.state.shortener_store, request.app.state.shortener_base_url)
        return JSONResponse(content=results, status_code=200)

    except Exception as exc:
        log_handle.exception(f"Agent search failed: {exc}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {exc}")


@router.post("/navigate", summary="Navigate paragraphs around a chunk")
async def agent_navigate(request: Request, payload: AgentNavigateRequest = Body(...)):
    """
    Walk sequentially through a document by paragraph, starting from a given chunk.

    `direction="both"` with `steps=1` returns the previous, current, and next paragraphs —
    useful for reading context around a search result. `steps` can go up to 20.
    """
    try:
        log_handle.info(
            "agent_navigate request",
            extra={
                "chunk_id": payload.chunk_id,
                "direction": payload.direction,
                "steps": payload.steps,
            },
        )
        config = request.app.state.config
        client = get_opensearch_client(config)

        try:
            current_doc = client.get(index=config.OPENSEARCH_INDEX_NAME, id=payload.chunk_id)
        except NotFoundError:
            raise HTTPException(status_code=404, detail="Chunk not found")
        source = current_doc.get("_source", {})
        document_id = source.get("document_id")
        current_para_id = source.get("paragraph_id")

        if document_id is None or current_para_id is None:
            raise HTTPException(status_code=404, detail="Chunk not found or missing metadata")

        current_para_id = int(current_para_id)

        if payload.direction == "both":
            para_ids = list(range(current_para_id - payload.steps, current_para_id + payload.steps + 1))
        elif payload.direction == "next":
            para_ids = list(range(current_para_id + 1, current_para_id + payload.steps + 1))
        else:
            para_ids = list(range(current_para_id - payload.steps, current_para_id))

        if not para_ids:
            return JSONResponse(content=[], status_code=200)

        query_body = {
            "size": len(para_ids),
            "query": {
                "bool": {
                    "filter": [
                        {"term": {"document_id": document_id}},
                        {"terms": {"paragraph_id": para_ids}}
                    ]
                }
            },
            "sort": [
                {"paragraph_id": {"order": "asc"}}
            ]
        }

        response = client.search(index=config.OPENSEARCH_INDEX_NAME, body=query_body)
        hits = response.get("hits", {}).get("hits", [])
        language = source.get("language", "hi")
        log_handle.info("agent_navigate hits=%s language=%s", len(hits), language)
        results = [_chunk_from_hit(hit, language) for hit in hits]
        _shorten_results(results, request.app.state.shortener_store, request.app.state.shortener_base_url)
        return JSONResponse(content=results, status_code=200)

    except HTTPException:
        raise
    except Exception as exc:
        log_handle.exception(f"Agent navigate failed: {exc}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {exc}")


@router.post("/find_similar", summary="Find semantically similar chunks")
async def agent_find_similar(request: Request, payload: AgentFindSimilarRequest = Body(...)):
    """
    Given a chunk, find the top 10 semantically related passages across the entire corpus
    using vector KNN search on the chunk's stored embedding.
    """
    try:
        log_handle.info("agent_find_similar request", extra={"chunk_id": payload.chunk_id})
        config = request.app.state.config
        client = get_opensearch_client(config)

        try:
            source_doc = client.get(index=config.OPENSEARCH_INDEX_NAME, id=payload.chunk_id)
        except NotFoundError:
            raise HTTPException(status_code=404, detail="Chunk not found")

        source_vector = source_doc.get("_source", {}).get("vector_embedding")
        if not source_vector:
            log_handle.warning(
                "agent_find_similar: source chunk missing vector_embedding; returning empty"
            )
            return JSONResponse(content=[], status_code=200)

        # NOTE: The "bool.must: knn" shape can be expensive and, depending on OpenSearch
        # version/plugins, may create heavy hybrid query execution.
        #
        # Prefer pure knn query (like agent_search does) and keep `k` == `size` so
        # we don't over-fetch.
        k = 10
        query_body: Dict[str, Any] = {
            "size": k,
            "query": {"knn": {"vector_embedding": {"vector": source_vector, "k": k}}},
            "post_filter": {"bool": {"must_not": [{"ids": {"values": [payload.chunk_id]}}]}},
        }

        try:
            response = client.search(index=config.OPENSEARCH_INDEX_NAME, body=query_body)
        except TransportError as te:
            # Example: all shards failed / task cancelled / circuit breaker, etc.
            log_handle.exception("agent_find_similar opensearch error: %s", te)
            raise HTTPException(status_code=503, detail="OpenSearch query failed")

        hits = response.get("hits", {}).get("hits", [])
        language = source_doc.get("_source", {}).get("language", "hi")
        log_handle.info("agent_find_similar hits=%s language=%s", len(hits), language)
        results = [_chunk_from_hit(hit, language) for hit in hits]
        _shorten_results(results, request.app.state.shortener_store, request.app.state.shortener_base_url)
        return JSONResponse(content=results, status_code=200)

    except HTTPException:
        raise
    except Exception as exc:
        log_handle.exception(f"Agent find_similar failed: {exc}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/get_filter_options", summary="Get available filter values")
async def agent_get_filter_options(
    request: Request, payload: AgentFilterOptionsRequest = Body(...)
):
    """
    Return valid filter values for a given language and content type.

    Reads live from the metadata index — automatically reflects new Granths, Anuyogs,
    contributors, and date ranges as content is indexed. Call this before search when
    you need exact filter values to avoid mismatches.
    """
    try:
        log_handle.info(
            "agent_get_filter_options request",
            extra={"language": payload.language, "content_type": payload.content_type},
        )
        config = request.app.state.config
        metadata = get_metadata(config)

        lang_key = payload.language
        content_type = payload.content_type
        type_metadata = metadata.get(content_type, {})

        def values_for(key: str) -> List[str]:
            return type_metadata.get(f"{key}_{lang_key}", [])

        granths = values_for("Name")
        anuyogs = values_for("Anuyog")
        contributors = values_for("Author")

        date_ranges_raw = type_metadata.get(f"Granth_date_ranges_{lang_key}", {})
        date_ranges: Dict[str, List[Dict[str, str]]] = {}
        if isinstance(date_ranges_raw, dict):
            for granth, ranges in date_ranges_raw.items():
                date_ranges[granth] = [
                    {"start": r.get("start_date"), "end": r.get("end_date")}
                    for r in (ranges or [])
                ]

        response = {
            "granths": granths,
            "anuyogs": anuyogs,
            "contributors": contributors,
            "date_ranges": date_ranges if content_type == "Pravachan" else {},
        }
        log_handle.info(
            "agent_get_filter_options response sizes",
            extra={
                "granths": len(granths),
                "anuyogs": len(anuyogs),
                "contributors": len(contributors),
                "date_ranges_keys": len(response["date_ranges"]),
            },
        )
        return JSONResponse(content=response, status_code=200)

    except Exception as exc:
        log_handle.exception(f"Agent get_filter_options failed: {exc}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {exc}")


@router.post("/get_metadata_options", summary="Get metadata tuples (granth, author, anuyog)")
async def agent_get_metadata_options(
    request: Request, payload: AgentMetadataOptionsRequest = Body(...)
):
    """
    Return unique metadata tuples (granth, author, anuyog) for the given language and content type.

    Responses are cached in-process per (language, content_type) until app restart.
    """
    try:
        cache_key = (payload.language, payload.content_type)
        cached = _METADATA_OPTIONS_CACHE.get(cache_key)
        if cached is not None:
            cached_results, expiry = cached
            if time.time() < expiry:
                log_handle.info("agent_get_metadata_options cache hit", extra={"key": cache_key})
                return JSONResponse(content=cached_results, status_code=200)
            log_handle.info("agent_get_metadata_options cache expired", extra={"key": cache_key})

        log_handle.info(
            "agent_get_metadata_options request",
            extra={"language": payload.language, "content_type": payload.content_type},
        )
        config = request.app.state.config
        client = get_opensearch_client(config)

        query_body = _build_metadata_options_query(payload.language, payload.content_type, size=1000)
        response = client.search(index=config.OPENSEARCH_INDEX_NAME, body=query_body)
        granth_buckets = (
            response.get("aggregations", {})
            .get("granths", {})
            .get("buckets", [])
        )

        results: List[Dict[str, Optional[str]]] = []
        raw_urls: List[str] = []
        for granth_bucket in granth_buckets:
            granth = granth_bucket.get("key")
            if not granth:
                continue
            for anuyog_bucket in granth_bucket.get("anuyogs", {}).get("buckets", []):
                anuyog_key = anuyog_bucket.get("key")
                anuyog = None if anuyog_key == "__missing__" else anuyog_key
                for author_bucket in anuyog_bucket.get("authors", {}).get("buckets", []):
                    author_key = author_bucket.get("key")
                    author = None if author_key == "__missing__" else author_key
                    file_url = _extract_file_url_from_bucket(author_bucket)
                    if file_url:
                        raw_urls.append(file_url)
                    results.append({
                        "granth": granth,
                        "author": author,
                        "anuyog": anuyog,
                        "url": file_url or "",
                    })

        short_map = _shorten_urls_with_store(request.app.state.shortener_store, request.app.state.shortener_base_url, list(dict.fromkeys(raw_urls)))
        for item in results:
            if item.get("url"):
                item["url"] = short_map.get(item["url"], item["url"])

        _METADATA_OPTIONS_CACHE[cache_key] = (results, time.time() + _METADATA_OPTIONS_CACHE_TTL)
        log_handle.info("agent_get_metadata_options response size=%s", len(results))
        return JSONResponse(content=results, status_code=200)

    except Exception as exc:
        log_handle.exception(f"Agent get_metadata_options failed: {exc}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {exc}")


@router.post("/get_pravachan", summary="Fetch all chunks of a Pravachan in order")
async def agent_get_pravachan(
    request: Request, payload: AgentGetPravachanRequest = Body(...)
):
    """
    Fetch every paragraph of a specific numbered discourse (Pravachan), sorted by
    paragraph order. Useful when the full text of a discourse is needed rather than
    just the top search results.
    """
    try:
        log_handle.info(
            "agent_get_pravachan request",
            extra={
                "granth": payload.granth,
                "pravachan_number": payload.pravachan_number,
                "language": payload.language,
            },
        )
        config = request.app.state.config
        client = get_opensearch_client(config)

        query_body = {
            "size": 1000,
            "query": {
                "bool": {
                    "filter": [
                        {"term": {"metadata.category.keyword": "Pravachan"}},
                        {"term": {"metadata.Name.keyword": payload.granth}},
                        {"term": {"chunk_labels.pravachan_number": payload.pravachan_number}},
                        {"term": {"language": payload.language}}
                    ]
                }
            },
            "sort": [
                {"paragraph_id": {"order": "asc"}}
            ]
        }

        all_hits: List[Dict[str, Any]] = []
        search_after = None
        while True:
            if search_after is not None:
                query_body["search_after"] = search_after

            response = client.search(index=config.OPENSEARCH_INDEX_NAME, body=query_body)
            hits = response.get("hits", {}).get("hits", [])
            if not hits:
                break
            all_hits.extend(hits)
            log_handle.debug("agent_get_pravachan page fetched hits=%s total=%s", len(hits), len(all_hits))
            search_after = hits[-1].get("sort")
            if len(hits) < query_body["size"]:
                break

        log_handle.info("agent_get_pravachan total_hits=%s", len(all_hits))
        results = [_chunk_from_hit(hit, payload.language) for hit in all_hits]
        _shorten_results(results, request.app.state.shortener_store, request.app.state.shortener_base_url)
        return JSONResponse(content=results, status_code=200)

    except Exception as exc:
        log_handle.exception(f"Agent get_pravachan failed: {exc}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {exc}")


@router.post("/shorten_url", response_model=AgentShortenUrlResponse)
async def agent_shorten_url(request: Request, payload: AgentShortenUrlRequest = Body(...)):
    store = request.app.state.shortener_store
    base_url = request.app.state.shortener_base_url
    code = store.get_code(payload.long_url)
    if not code:
        raise HTTPException(status_code=404, detail="URL not found")
    return {"short_url": f"{base_url.rstrip('/')}/url/{code}"}
