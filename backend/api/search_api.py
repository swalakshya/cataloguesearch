import asyncio
import json
import logging
import os
import sys
import time
from contextlib import asynccontextmanager
from typing import Any, Dict, List, Optional

from fastapi import Body, FastAPI, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from fastapi.middleware.cors import CORSMiddleware

from backend.common.embedding_models import get_embedding_model_factory
from backend.common.opensearch import get_opensearch_client, get_metadata
from backend.common.catalogue import get_catalogue
from backend.config import Config
from backend.search.index_searcher import IndexSearcher
from backend.utils import json_dumps, JSONResponse, log_memory_usage
from utils.logger import setup_logging, VERBOSE_LEVEL_NUM, METRICS_LEVEL_NUM, set_query_id, get_query_id
from backend.api.feedback_api import router as feedback_router
from backend.api.agent.router import router as agent_router
from backend.api.agent.app import agent_app
from backend.api.url.router import router as url_router
from backend.api.admin.admin_api import router as admin_router
from backend.api.admin.analytics import router as analytics_router
from backend.api.admin.metrics_store import MetricsStore, normalize_language
from backend.shortener.core import ShortenerStore
from backend.shortener.opensearch_loader import fetch_file_urls

log_handle = logging.getLogger(__name__)

# Metadata filter fields that are valid per category.
# Prevents cross-category filters (e.g. a Granth filter) from zeroing out Books results.
_CATEGORY_FILTER_FIELDS: Dict[str, set] = {
    # "Name" is deliberately absent here: a Granth/Book title picked for Pravachan
    # filtering goes through "_pravachan_groups" (which carries granth/series/volume
    # scoped to Pravachan only) so it doesn't also narrow Granth/Books results — see
    # PravachanFilter.handleApply in the frontend.
    "Pravachan": {"Anuyog", "Series", "volume", "pravachan_number", "_pravachan_groups"},
    "Granth":    {"Name", "Anuyog", "Author"},
    "Books":     {"Name", "Author"},
}

def _filter_categories_for(cat: str, categories: Dict[str, List[str]]) -> Dict[str, List[str]]:
    """Return only the category-filter entries that are valid for the given category."""
    allowed = _CATEGORY_FILTER_FIELDS.get(cat, set(categories.keys()))
    return {k: v for k, v in categories.items() if k in allowed}

@asynccontextmanager
async def lifespan(app: FastAPI):
    logs_dir = os.environ.get("LOGS_DIR", "logs")
    log_level_str = os.environ.get("LOG_LEVEL", "VERBOSE").upper()
    console_level = logging.INFO if log_level_str == "INFO" else VERBOSE_LEVEL_NUM
    setup_logging(
        logs_dir=logs_dir, console_level=console_level,
        file_level=VERBOSE_LEVEL_NUM,
        console_only=False)
    log_handle.info("Logging setup complete.")

    config_path = os.environ.get("CONFIG_PATH", "configs/config.yaml")
    config = Config(config_path)
    overrides_path = os.path.join(os.path.dirname(config_path), "overrides.json")
    config.load_overrides(overrides_path)
    app.state.overrides_path = overrides_path
    app.state.config = config
    log_handle.info("Configuration loaded.")

    client = get_opensearch_client(config)
    log_handle.info("OpenSearch client initialized.")

    app.state.embedding_model = get_embedding_model_factory(config)
    log_handle.info(f"Embedding model {config.EMBEDDING_MODEL_NAME} with type {config.EMBEDDING_MODEL_TYPE} loaded.")

    app.state.index_searcher = IndexSearcher(config)
    log_handle.info("IndexSearcher initialized.")

    shortener_base_url = os.environ.get("SHORTENER_BASE_URL", "https://swalakshya.me")
    shortener_store = ShortenerStore(base_len=int(os.environ.get("SHORT_CODE_LEN", "7")))
    try:
        urls = fetch_file_urls(client, index_name=config.OPENSEARCH_INDEX_NAME)
        shortener_store.load(urls)
        log_handle.info("ShortenerStore loaded with %s URLs.", len(urls))
    except Exception as exc:
        log_handle.exception("Failed to load ShortenerStore, using empty store: %s", exc)
    app.state.shortener_store = shortener_store
    app.state.shortener_base_url = shortener_base_url

    db_path = config.METRICS_DB_PATH or os.path.join(logs_dir, "metrics.db")
    app.state.metrics_store = MetricsStore(db_path)
    log_handle.info("MetricsStore initialised at %s", db_path)

    agent_app.state.config = config
    agent_app.state.index_searcher = app.state.index_searcher
    agent_app.state.embedding_model = app.state.embedding_model
    agent_app.state.shortener_store = shortener_store
    agent_app.state.shortener_base_url = shortener_base_url
    agent_app.state.metrics_store = app.state.metrics_store

    app.state.metadata_cache = {
        "data": None,
        "timestamp": 0,
        "ttl": 1800
    }
    try:
        log_handle.info("Populating metadata cache at startup...")
        metadata = get_metadata(config)
        filtered_metadata = {}
        for content_type, type_metadata in metadata.items():
            if content_type not in config.ACTIVE_CATEGORIES:
                continue
            filtered_metadata[content_type] = {}
            for composite_key, values in type_metadata.items():
                parts = composite_key.rsplit('_', 1)
                if len(parts) == 2:
                    field_name = parts[0]
                    _always_include = {"pravachan_series_cascade"}
                    if field_name in _always_include or field_name in config.FILTERED_METADATA_FIELDS:
                        filtered_metadata[content_type][composite_key] = values
        app.state.metadata_cache["data"] = filtered_metadata
        app.state.metadata_cache["timestamp"] = time.time()
        log_handle.info(f"Metadata cache populated with {json_dumps(metadata)}")
    except Exception as e:
        log_handle.exception(f"Failed to populate metadata cache at startup: {e}")

    app.state.catalogue_cache = {
        "data": None,
        "timestamp": 0,
        "ttl": 1800
    }
    try:
        log_handle.info("Populating content catalogue cache at startup...")
        app.state.catalogue_cache["data"] = get_catalogue(config, client)
        app.state.catalogue_cache["timestamp"] = time.time()
        log_handle.info(
            f"Catalogue cache populated with {len(app.state.catalogue_cache['data'])} rows")
    except Exception as e:
        log_handle.exception(f"Failed to populate catalogue cache at startup: {e}")

    log_memory_usage()
    yield


# --- FastAPI Application Setup ---
app = FastAPI(
    title="Catalogue Search API",
    description="API for searching through catalogue documents and serving the frontend.",
    version="1.0.0",
    lifespan=lifespan,
)

# --- CORS Middleware ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Include Routers ---
app.include_router(feedback_router, prefix="/api")
app.include_router(agent_router, prefix="/api/agent")
app.include_router(url_router)
app.include_router(admin_router, prefix="/api")
app.include_router(analytics_router, prefix="/api")

# --- Mount Agent sub-app (public OpenAPI surface) ---
app.mount("/agent", agent_app)


@app.get("/api/metadata", response_model=Dict[str, List[str]])
async def get_metadata_api(request: Request):
    """
    Returns metadata about the indexed documents.
    Uses in-memory cache with 30-minute TTL, computes from OpenSearch if cache is expired.
    """
    try:
        current_time = time.time()
        cache = request.app.state.metadata_cache

        # Check if cache is valid
        if (cache["data"] is not None and
            current_time - cache["timestamp"] < cache["ttl"]):
            log_handle.info("Retrieving metadata from in-memory cache")
            return JSONResponse(content=cache["data"], status_code=200)

        # Cache is expired or empty, fetch from OpenSearch
        log_handle.info("Cache expired or empty, fetching metadata from OpenSearch")
        metadata = get_metadata(request.app.state.config)
        log_handle.info(f"Raw metadata from get_metadata: {json_dumps(metadata)}")

        # Filter to only return Name, Anuyog, Author fields for each content_type
        # metadata structure: {"Pravachan": {"Name_hi": [...], ...}, "Granth": {...}}
        filtered_metadata = {}
        for content_type, type_metadata in metadata.items():
            if content_type not in request.app.state.config.ACTIVE_CATEGORIES:
                continue
            filtered_metadata[content_type] = {}
            for composite_key, values in type_metadata.items():
                # composite_key is like "Name_hi", "Anuyog_gu", etc.
                # Extract the field name (before the last underscore)
                parts = composite_key.rsplit('_', 1)
                if len(parts) == 2:
                    field_name = parts[0]
                    log_handle.info(f"Checking field {field_name} against filtered fields: {request.app.state.config.FILTERED_METADATA_FIELDS}")
                    # Always pass through cascade fields; otherwise check the allowlist
                    _always_include = {"pravachan_series_cascade"}
                    if field_name in _always_include or field_name in request.app.state.config.FILTERED_METADATA_FIELDS:
                        filtered_metadata[content_type][composite_key] = values
                        log_handle.info(f"Including {composite_key} with {len(values)} values")
                    else:
                        log_handle.info(f"Excluding {field_name} - not in filtered fields")

        # Update cache with filtered data
        cache["data"] = filtered_metadata
        cache["timestamp"] = current_time

        log_handle.info(f"Filtered metadata retrieved and cached: {len(filtered_metadata)} content types found")
        return JSONResponse(content=filtered_metadata, status_code=200)
    except Exception as e:
        log_handle.exception(f"Error retrieving metadata: {e}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {e}")

@app.get("/api/catalogue", response_model=List[Dict[str, Any]])
async def get_catalogue_api(request: Request):
    """
    Returns the content catalogue: one row per (category, language, Granth, Series)
    that has a curated `count` in cataloguesearch-configs. Backs the /search-index
    page. Uses the same in-memory cache pattern as /api/metadata.
    """
    try:
        current_time = time.time()
        cache = request.app.state.catalogue_cache

        if (cache["data"] is not None and
            current_time - cache["timestamp"] < cache["ttl"]):
            log_handle.info("Retrieving catalogue from in-memory cache")
            return JSONResponse(content=cache["data"], status_code=200)

        log_handle.info("Cache expired or empty, fetching catalogue from OpenSearch")
        rows = get_catalogue(request.app.state.config)

        cache["data"] = rows
        cache["timestamp"] = current_time

        log_handle.info(f"Catalogue retrieved and cached: {len(rows)} rows")
        return JSONResponse(content=rows, status_code=200)
    except Exception as e:
        log_handle.exception(f"Error retrieving catalogue: {e}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {e}")

@app.post("/api/cache/invalidate")
async def invalidate_cache(request: Request):
    """
    Invalidates the metadata and catalogue caches by clearing cached data.
    """
    try:
        cache = request.app.state.metadata_cache
        cache["data"] = None
        cache["timestamp"] = 0

        catalogue_cache = request.app.state.catalogue_cache
        catalogue_cache["data"] = None
        catalogue_cache["timestamp"] = 0

        log_handle.info("Metadata and catalogue caches invalidated successfully")
        return {"message": "Cache invalidated successfully", "status": "success"}
    except Exception as e:
        log_handle.exception(f"Error invalidating cache: {e}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {e}")

@app.get("/api/config")
async def get_app_config(request: Request):
    """
    Returns runtime configuration for the frontend, including debug mode flag
    and the list of active search categories.
    """
    config = request.app.state.config
    return JSONResponse(content={
        "app_name": config.APP_NAME,
        "debug_mode": config.DEBUG_MODE,
        "active_categories": config.ACTIVE_CATEGORIES,
        "page_size_pravachan": config.PAGE_SIZE_PRAVACHAN,
        "page_size_granth": config.PAGE_SIZE_GRANTH,
        "page_size_books": config.PAGE_SIZE_BOOKS,
        "enable_reranking": config.ENABLE_RERANKING,
        "effective_mode": config.SEARCH_MODE,
    }, status_code=200)

class SearchRequest(BaseModel):
    """
    Pydantic model for the search request payload.
    """
    query: str = Field(..., example="Bangalore city history")
    language: str = Field(..., description="Language of the query.", example="hindi")
    text_search: bool = Field(False, description="Force keyword/BM25 search instead of semantic (vector) search.")
    exact_match: bool = Field(False, description="Use exact phrase matching instead of regular match.")
    exclude_words: List[str] = Field([], description="List of words to exclude from search results.")
    categories: Dict[str, List[str]] = Field({}, example={"author": ["John Doe"], "category": ["Pravachan"]})
    start_year: int | None = Field(None, description="Start year for date range filter (e.g., 1985).", example=1985)
    end_year: int | None = Field(None, description="End year for date range filter (e.g., 1987).", example=1987)

    # Search types configuration
    search_types: Dict[str, Dict[str, Any]] = Field(
        default={
            "Pravachan": {
                "enabled": True,
                "page_size": 20,
                "page_number": 1
            },
            "Granth": {
                "enabled": True,
                "page_size": 20,
                "page_number": 1
            }
        },
        description="Configuration for each search type",
        example={
            "Pravachan": {"enabled": True, "page_size": 20, "page_number": 1},
            "Granth": {"enabled": True, "page_size": 10, "page_number": 1}
        }
    )

    enable_reranking: bool = Field(True, description="Enable re-ranking for better relevance.")
    query_id: Optional[str] = Field(None, description="Optional caller-supplied ID for correlating client and server timings.")

class SearchTypeResults(BaseModel):
    """Results for a specific search type (Pravachan or Granth)."""
    results: List[Dict[str, Any]] = Field(default_factory=list)
    total_hits: int = Field(0)
    page_size: int = Field(20)
    page_number: int = Field(1)

class SearchResponse(BaseModel):
    """
    Unified response model for both lexical and vector searches.
    """
    pravachan_results: SearchTypeResults = Field(default_factory=SearchTypeResults)
    granth_results: SearchTypeResults = Field(default_factory=SearchTypeResults)
    books_results: SearchTypeResults = Field(default_factory=SearchTypeResults)
    suggestions: List[str] = Field(default_factory=list, description="Spelling suggestions when no results found")

@app.post("/api/search")
async def search(request: Request, request_data: SearchRequest = Body(...)):
    """
    Handles search requests to the OpenSearch index.
    Streams results per category using Server-Sent Events so the frontend can
    display each category's results as soon as they are ready.
    """
    index_searcher = request.app.state.index_searcher
    embedding_model = request.app.state.embedding_model

    keywords = request_data.query
    text_search = request_data.text_search
    exact_match = request_data.exact_match
    exclude_words = request_data.exclude_words
    categories = request_data.categories
    search_types = request_data.search_types
    enable_reranking = request_data.enable_reranking
    language = request_data.language
    start_year = request_data.start_year
    end_year = request_data.end_year
    query_id = request_data.query_id
    set_query_id(query_id or '')

    config = request.app.state.config
    active_categories = config.ACTIVE_CATEGORIES
    all_search_cats = list(
        dict.fromkeys(
            active_categories +
            [c for c, cfg in search_types.items() if cfg.get("enabled", False)]
        )
    )

    has_advanced_options = exact_match or (exclude_words and len(exclude_words) > 0)
    effective_mode = "lexical" if text_search else config.SEARCH_MODE
    if effective_mode == "lexical":
        is_lexical_query = True
    elif effective_mode == "vector":
        is_lexical_query = False
    elif effective_mode == "rrf":
        is_lexical_query = None
    else:  # "auto"
        is_lexical_query = (index_searcher.is_lexical_query(keywords) or has_advanced_options)

    rerank_oversample = config.RERANK_OVERSAMPLE
    start_time = time.time()
    client_ip = (
        request.headers.get("x-real-ip") or
        request.headers.get("x-forwarded-for", "").split(",")[0].strip() or
        (getattr(request.client, 'host', 'unknown') if request.client else 'unknown')
    )
    query_source = request.headers.get("x-query-source", "unknown")

    log_handle.info(f"Received search request: query_id={query_id}, keywords='{keywords}', "
                    f"exact_match={exact_match}, exclude_words={exclude_words}, "
                    f"categories={categories}, search_types={search_types}, "
                    f"language={language}, enable_reranking={enable_reranking}")

    ttfb_ms = None

    async def _generate():
        nonlocal ttfb_ms
        loop = asyncio.get_running_loop()
        category_results = {}

        # --- Embedding (for rrf / vector modes, and auto mode routed to vector) ---
        query_embedding = None
        needs_embedding = effective_mode in ("rrf", "vector") or (effective_mode == "auto" and not is_lexical_query)
        if needs_embedding:
            try:
                query_embedding = await loop.run_in_executor(
                    None, lambda: embedding_model.get_embedding(keywords)
                )
            except Exception as emb_err:
                log_handle.error(f"Embedding generation failed: {emb_err}")
            if not query_embedding:
                log_handle.warning("Could not generate embedding. All categories skipped.")
                for cat in all_search_cats:
                    cfg = search_types.get(cat, {})
                    event = json.dumps({
                        "type": "category", "category": cat,
                        "results": [], "total_hits": 0,
                        "page_size": cfg.get("page_size", 20),
                        "page_number": cfg.get("page_number", 1),
                    }, ensure_ascii=False)
                    yield f"data: {event}\n\n"
                    category_results[cat] = ([], 0)
                yield f"data: {json.dumps({'type': 'done', 'suggestions': []}, ensure_ascii=False)}\n\n"
                return

        # --- Per-category search (sequential, streamed) ---
        for cat in all_search_cats:
            cat_config = search_types.get(cat, {})
            if not cat_config.get("enabled", False):
                results, hits = [], 0
            else:
                try:
                    if effective_mode == "rrf":
                        results, hits = await loop.run_in_executor(
                            None,
                            lambda c=cat, cfg=cat_config: index_searcher.perform_rrf_search(
                                category=c,
                                keywords=keywords,
                                exact_match=exact_match,
                                exclude_words=exclude_words,
                                categories=_filter_categories_for(c, categories),
                                embedding=query_embedding,
                                detected_language=language,
                                page_size=cfg.get("page_size", 20),
                                page_number=cfg.get("page_number", 1),
                                oversample=rerank_oversample,
                                rerank=enable_reranking,
                                start_year=start_year,
                                end_year=end_year,
                            )
                        )
                        log_handle.info(f"{cat} RRF search returned {len(results)} results (total: {hits}).")
                    elif is_lexical_query:
                        results, hits = await loop.run_in_executor(
                            None,
                            lambda c=cat, cfg=cat_config: index_searcher.perform_category_search(
                                category=c,
                                keywords=keywords,
                                exact_match=exact_match,
                                exclude_words=exclude_words,
                                categories=_filter_categories_for(c, categories),
                                detected_language=language,
                                page_size=cfg.get("page_size", 20),
                                page_number=cfg.get("page_number", 1),
                                start_year=start_year,
                                end_year=end_year,
                            )
                        )
                        log_handle.info(f"{cat} lexical search returned {len(results)} results (total: {hits}).")
                    else:
                        results, hits = await loop.run_in_executor(
                            None,
                            lambda c=cat, cfg=cat_config: index_searcher.perform_vector_search(
                                keywords=keywords,
                                embedding=query_embedding,
                                categories={**_filter_categories_for(c, categories), 'category': [c]},
                                page_size=cfg.get("page_size", 20),
                                page_number=cfg.get("page_number", 1),
                                language=language,
                                rerank=enable_reranking,
                                rerank_top_k=rerank_oversample,
                                start_year=start_year,
                                end_year=end_year,
                            )
                        )
                        log_handle.info(f"{cat} vector search returned {len(results)} results (total: {hits}).")
                except Exception as cat_err:
                    log_handle.error(f"Error searching category {cat}: {cat_err}")
                    results, hits = [], 0

            category_results[cat] = (results, hits)
            event = json.dumps({
                "type": "category", "category": cat,
                "results": results, "total_hits": hits,
                "page_size": cat_config.get("page_size", 20),
                "page_number": cat_config.get("page_number", 1),
            }, ensure_ascii=False)
            yield f"data: {event}\n\n"
            if ttfb_ms is None:
                ttfb_ms = round((time.time() - start_time) * 1000, 2)

        # --- Suggestions + metrics + done event ---
        total_hits = sum(h for _, h in category_results.values())
        suggestions = []
        if is_lexical_query and total_hits == 0:
            try:
                suggestions = await loop.run_in_executor(
                    None,
                    lambda: index_searcher.get_spelling_suggestions(
                        index_name=config.OPENSEARCH_INDEX_NAME,
                        text=keywords,
                        language=language,
                        min_score=0.6,
                        num_suggestions=3,
                    )
                )
                log_handle.info(f"No results for '{keywords}'. Suggestions: {suggestions}")
            except Exception as sug_err:
                log_handle.error(f"Spelling suggestions failed: {sug_err}")

        latency_ms = round((time.time() - start_time) * 1000, 2)
        search_type = effective_mode if effective_mode in ("lexical", "vector", "rrf") else ("lexical" if is_lexical_query else "vector")
        pravachan_cfg = search_types.get("Pravachan", {})
        request.app.state.metrics_store.insert({
            "created_at": int(start_time * 1000),
            "source": query_source,
            "query_id": get_query_id() or None,
            "chat_request_id": None,
            "query": keywords,
            "search_mode": search_type,
            "reranked": int(enable_reranking),
            "language": normalize_language(language),
            "categories": str(categories),
            "page_size": pravachan_cfg.get("page_size", 20),
            "page": pravachan_cfg.get("page_number", 1),
            "latency_ms": latency_ms,
            "ttfb_ms": ttfb_ms,
            "total_hits": total_hits,
        })
        log_handle.info(f"Search complete: query_id={query_id}, search_type={search_type}, total_hits={total_hits}, latency={latency_ms}ms")

        yield f"data: {json.dumps({'type': 'done', 'suggestions': suggestions}, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        _generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )

@app.get("/api/similar-documents/{doc_id}", response_model=Dict[str, Any])
async def get_similar_documents(request: Request, doc_id: str, language: str = Query("hi", enum=["hi", "gu", "en"])):
    """
    Finds and returns documents that are semantically similar to the given document ID.
    """
    try:
        index_searcher = request.app.state.index_searcher
        log_handle.info(f"Received request for similar documents to doc_id: {doc_id}")

        similar_docs, total_similar = index_searcher.find_similar_by_id(
            doc_id=doc_id,
            language=language,
            size=10
        )

        response = {
            "total_results": total_similar,
            "results": similar_docs
        }

        log_handle.info(f"Found {total_similar} similar documents for doc_id: {doc_id}")
        return JSONResponse(content=response, status_code=200)

    except Exception as e:
        log_handle.exception(f"An error occurred while finding similar documents: {e}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {e}")

@app.get("/api/chunk/{chunk_id}", response_model=Dict[str, Any])
async def get_chunk(request: Request, chunk_id: str, language: str = Query("hi", enum=["hi", "gu", "en"])):
    """
    Fetches a single chunk by its chunk_id. Returns only the current chunk with no neighbours.
    """
    try:
        config = request.app.state.config
        client = get_opensearch_client(config)
        log_handle.info(f"Received request for chunk_id: {chunk_id}")
        try:
            doc = client.get(index=config.OPENSEARCH_INDEX_NAME, id=chunk_id)
        except Exception:
            raise HTTPException(status_code=404, detail="Chunk not found")
        source = doc.get("_source", {})
        metadata = source.get("metadata", {})
        chunk_labels = source.get("chunk_labels", {})
        text_field = "text_content_hindi" if language != "gu" else "text_content_gujarati"
        author = (
            metadata.get("Author")
            or metadata.get("Tikakaar")
            or metadata.get("Teekakar")
            or metadata.get("Bhasha Vachanika")
            or ""
        )
        result = {
            "chunk_id": chunk_id,
            "text_content": source.get(text_field, ""),
            "page_number": source.get("page_number"),
            "language": source.get("language", language),
            "granth": metadata.get("Name", ""),
            "category": metadata.get("category", ""),
            "series": metadata.get("Series", ""),
            "volume": metadata.get("volume"),
            "author": author,
            "gatha": chunk_labels.get("gatha"),
            "shlok": chunk_labels.get("shlok"),
            "kalash": chunk_labels.get("kalash"),
            "doha": chunk_labels.get("doha"),
            "kavya": chunk_labels.get("kavya"),
            "sutra": chunk_labels.get("sutra"),
        }
        return JSONResponse(content=result, status_code=200)
    except HTTPException:
        raise
    except Exception as e:
        log_handle.exception(f"An error occurred while fetching chunk: {e}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {e}")


@app.get("/api/context/{chunk_id}", response_model=Dict[str, Any])
async def get_context(request: Request, chunk_id: str, language: str = Query("hi", enum=["hi", "gu", "en"])):
    """
    Fetches the context (previous, current, next paragraph) for a given chunk_id.
    """
    try:
        index_searcher = request.app.state.index_searcher
        log_handle.info(f"Received request for context for chunk_id: {chunk_id}")
        context_data = index_searcher.get_paragraph_context(chunk_id=chunk_id, language=language)
        if not context_data.get("current"):
            raise HTTPException(status_code=404, detail="Context not found for the given ID.")
        return JSONResponse(content=context_data, status_code=200)
    except Exception as e:
        log_handle.exception(f"An error occurred while fetching context: {e}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {e}")

