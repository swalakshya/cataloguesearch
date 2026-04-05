import logging
import os
import sys
import time
from typing import Any, Dict, List

from fastapi import Body, FastAPI, HTTPException, Query, Request
from pydantic import BaseModel, Field
from fastapi.middleware.cors import CORSMiddleware

from backend.common.embedding_models import get_embedding_model_factory
from backend.common.opensearch import get_opensearch_client, get_metadata
from backend.config import Config
from backend.search.index_searcher import IndexSearcher
from backend.utils import json_dumps, JSONResponse, log_memory_usage
from utils.logger import setup_logging, VERBOSE_LEVEL_NUM, METRICS_LEVEL_NUM
from backend.api.feedback_api import router as feedback_router
from backend.api.agent.router import router as agent_router
from backend.api.agent.app import agent_app
from backend.api.url.router import router as url_router
from backend.url_shortener.core import ShortenerStore
from backend.url_shortener.opensearch_loader import fetch_file_urls

log_handle = logging.getLogger(__name__)

# Metadata filter fields that are valid per category.
# Prevents cross-category filters (e.g. a Granth filter) from zeroing out Books results.
_CATEGORY_FILTER_FIELDS: Dict[str, set] = {
    "Pravachan": {"Name", "Anuyog"},
    "Granth":    {"Name", "Anuyog", "Author"},
    "Books":     {"Name", "Author"},
}

def _filter_categories_for(cat: str, categories: Dict[str, List[str]]) -> Dict[str, List[str]]:
    """Return only the category-filter entries that are valid for the given category."""
    allowed = _CATEGORY_FILTER_FIELDS.get(cat, set(categories.keys()))
    return {k: v for k, v in categories.items() if k in allowed}

# --- FastAPI Application Setup ---
app = FastAPI(
    title="Catalogue Search API",
    description="API for searching through catalogue documents and serving the frontend.",
    version="1.0.0"
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

# --- Mount Agent sub-app (public OpenAPI surface) ---
app.mount("/agent", agent_app)

@app.on_event("startup")
async def initialize():
    """
    Initializes the config and other expensive objects once at startup.
    Stores them in the application state.
    """
    # Setup logging
    logs_dir = os.environ.get("LOGS_DIR", "logs")
    setup_logging(
        logs_dir=logs_dir, console_level=VERBOSE_LEVEL_NUM,
        file_level=VERBOSE_LEVEL_NUM,
        console_only=False)
    log_handle.info("Logging setup complete.")

    # Load configuration
    config_path = os.environ.get("CONFIG_PATH", "configs/config.yaml")
    config = Config(config_path)
    app.state.config = config
    log_handle.info("Configuration loaded.")

    # Initialize OpenSearch client (the client itself is managed by opensearch.py module)
    client = get_opensearch_client(config)
    log_handle.info("OpenSearch client initialized.")

    # Load embedding model
    app.state.embedding_model = get_embedding_model_factory(config)
    log_handle.info(f"Embedding model {config.EMBEDDING_MODEL_NAME} with type {config.EMBEDDING_MODEL_TYPE} loaded.")

    # Initialize IndexSearcher (which may load the reranker)
    app.state.index_searcher = IndexSearcher(config)
    log_handle.info("IndexSearcher initialized.")

    # Load URL shortener store
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

    # Propagate shared state to the agent sub-app so request.app.state works there too
    agent_app.state.config = config
    agent_app.state.index_searcher = app.state.index_searcher
    agent_app.state.embedding_model = app.state.embedding_model
    agent_app.state.shortener_store = shortener_store
    agent_app.state.shortener_base_url = shortener_base_url

    # Initialize and populate metadata cache
    app.state.metadata_cache = {
        "data": None,
        "timestamp": 0,
        "ttl": 1800  # 30 minutes cache TTL
    }
    try:
        log_handle.info("Populating metadata cache at startup...")
        metadata = get_metadata(config)
        # Filter metadata for each content_type
        # metadata structure: {"Pravachan": {"Name_hi": [...], ...}, "Granth": {...}}
        filtered_metadata = {}
        for content_type, type_metadata in metadata.items():
            if content_type not in config.ACTIVE_CATEGORIES:
                continue
            filtered_metadata[content_type] = {}
            for composite_key, values in type_metadata.items():
                # composite_key is like "Name_hi", "Anuyog_gu", etc.
                # Extract the field name (before the last underscore)
                parts = composite_key.rsplit('_', 1)
                if len(parts) == 2:
                    field_name = parts[0]
                    # Only include if field is in the filtered list
                    if field_name in config.FILTERED_METADATA_FIELDS:
                        filtered_metadata[content_type][composite_key] = values
        app.state.metadata_cache["data"] = filtered_metadata
        app.state.metadata_cache["timestamp"] = time.time()
        log_handle.info(f"Metadata cache populated with {json_dumps(metadata)}")
    except Exception as e:
        log_handle.exception(f"Failed to populate metadata cache at startup: {e}")

    # Log memory usage after initialization
    log_memory_usage()

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
                    # Only include if field is in the filtered list
                    if field_name in request.app.state.config.FILTERED_METADATA_FIELDS:
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

@app.post("/api/cache/invalidate")
async def invalidate_cache(request: Request):
    """
    Invalidates the metadata cache by clearing cached data.
    """
    try:
        cache = request.app.state.metadata_cache
        cache["data"] = None
        cache["timestamp"] = 0
        
        log_handle.info("Metadata cache invalidated successfully")
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
        "debug_mode": config.DEBUG_MODE,
        "active_categories": config.ACTIVE_CATEGORIES
    }, status_code=200)

class SearchRequest(BaseModel):
    """
    Pydantic model for the search request payload.
    """
    query: str = Field(..., example="Bangalore city history")
    language: str = Field(..., description="Language of the query.", example="hindi")
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

@app.post("/api/search", response_model=SearchResponse)
async def search(request: Request, request_data: SearchRequest = Body(...)):
    """
    Handles search requests to the OpenSearch index.
    Performs lexical and vector searches, collates results, and returns paginated output.
    """
    index_searcher = request.app.state.index_searcher
    embedding_model = request.app.state.embedding_model

    keywords = request_data.query
    exact_match = request_data.exact_match
    exclude_words = request_data.exclude_words
    categories = request_data.categories
    search_types = request_data.search_types
    enable_reranking = request_data.enable_reranking
    language = request_data.language
    start_year = request_data.start_year
    end_year = request_data.end_year

    active_categories = request.app.state.config.ACTIVE_CATEGORIES
    has_advanced_options = exact_match or (exclude_words and len(exclude_words) > 0)
    is_lexical_query = (index_searcher.is_lexical_query(keywords) or has_advanced_options)

    try:
        # Start timing for metrics
        start_time = time.time()

        # Get client IP - check X-Forwarded-For and X-Real-IP headers first (for nginx proxy)
        client_ip = (
            request.headers.get("x-real-ip") or
            request.headers.get("x-forwarded-for", "").split(",")[0].strip() or
            getattr(request.client, 'host', 'unknown') if request.client else 'unknown'
        )

        log_handle.info(f"Received search request: keywords='{keywords}', "
                        f"exact_match={exact_match}, exclude_words={exclude_words}, "
                        f"categories={categories}, search_types={search_types}, "
                        f"language={language}, enable_reranking={enable_reranking}")

        # Collect results per active category
        category_results = {}  # cat -> (results, total_hits)

        if is_lexical_query:
            for cat in active_categories:
                cat_config = search_types.get(cat, {})
                if not cat_config.get("enabled", False):
                    category_results[cat] = ([], 0)
                    continue
                results, hits = index_searcher.perform_category_search(
                    category=cat,
                    keywords=keywords,
                    exact_match=exact_match,
                    exclude_words=exclude_words,
                    categories=_filter_categories_for(cat, categories),
                    detected_language=language,
                    page_size=cat_config.get("page_size", 20),
                    page_number=cat_config.get("page_number", 1),
                    start_year=start_year,
                    end_year=end_year
                )
                log_handle.info(f"{cat} search returned {len(results)} results (total: {hits}).")
                category_results[cat] = (results, hits)
        else:
            query_embedding = embedding_model.get_embedding(keywords)
            if not query_embedding:
                log_handle.warning("Could not generate embedding for query. Vector search skipped.")
                for cat in active_categories:
                    category_results[cat] = ([], 0)
            else:
                for cat in active_categories:
                    cat_config = search_types.get(cat, {})
                    if not cat_config.get("enabled", False):
                        category_results[cat] = ([], 0)
                        continue
                    results, hits = index_searcher.perform_vector_search(
                        keywords=keywords,
                        embedding=query_embedding,
                        categories={**_filter_categories_for(cat, categories), 'category': [cat]},
                        page_size=cat_config.get("page_size", 20),
                        page_number=cat_config.get("page_number", 1),
                        language=language,
                        rerank=enable_reranking,
                        rerank_top_k=cat_config.get("page_size", 20),
                        start_year=start_year,
                        end_year=end_year
                    )
                    log_handle.info(f"{cat} vector search returned {len(results)} results (total: {hits}).")
                    category_results[cat] = (results, hits)

        def _make_type_results(cat):
            r, h = category_results.get(cat, ([], 0))
            cfg = search_types.get(cat, {})
            return SearchTypeResults(
                results=r, total_hits=h,
                page_size=cfg.get("page_size", 20),
                page_number=cfg.get("page_number", 1)
            )

        # Get spelling suggestions if lexical query returned no results
        total_hits = sum(h for _, h in category_results.values())
        suggestions = []
        if is_lexical_query and total_hits == 0:
            suggestions = index_searcher.get_spelling_suggestions(
                index_name=request.app.state.config.OPENSEARCH_INDEX_NAME,
                text=keywords,
                language=language,
                min_score=0.6,
                num_suggestions=3
            )
            log_handle.info(f"No results found for lexical query '{keywords}'. Suggestions: {suggestions}")

        response = SearchResponse(
            pravachan_results=_make_type_results("Pravachan"),
            granth_results=_make_type_results("Granth"),
            books_results=_make_type_results("Books"),
            suggestions=suggestions
        )

        # Calculate latency and log metrics
        latency_ms = round((time.time() - start_time) * 1000, 2)
        search_type = "lexical" if is_lexical_query else "vector"
        escaped_query = keywords.replace(',', ';').replace('"', "'").replace('\n', ' ').replace('\r', '')
        escaped_categories = str(categories).replace(',', ';').replace('"', "'")
        pravachan_cfg = search_types.get("Pravachan", {})
        log_handle.metrics(
            f"{client_ip},{escaped_query},{search_type},{exact_match},{escaped_categories},{language},"
            f"{enable_reranking},{pravachan_cfg.get('page_size', 20)},{pravachan_cfg.get('page_number', 1)},{latency_ms},{total_hits}"
        )

        log_handle.info(f"Search response: {json_dumps(response.model_dump())}")
        return response

    except Exception as e:
        log_handle.exception(f"An error occurred during search request processing: {e}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {e}")

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

