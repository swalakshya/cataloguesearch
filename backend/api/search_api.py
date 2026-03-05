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

log_handle = logging.getLogger(__name__)

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
    get_opensearch_client(config)
    log_handle.info("OpenSearch client initialized.")

    # Load embedding model
    app.state.embedding_model = get_embedding_model_factory(config)
    log_handle.info(f"Embedding model {config.EMBEDDING_MODEL_NAME} with type {config.EMBEDDING_MODEL_TYPE} loaded.")

    # Initialize IndexSearcher (which may load the reranker)
    app.state.index_searcher = IndexSearcher(config)
    log_handle.info("IndexSearcher initialized.")

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
        # metadata structure: {"Pravachan": {"Granth_hi": [...], ...}, "Granth": {...}}
        filtered_metadata = {}
        for content_type, type_metadata in metadata.items():
            filtered_metadata[content_type] = {}
            for composite_key, values in type_metadata.items():
                # composite_key is like "Granth_hi", "Year_gu", etc.
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
        config = Config()
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

        # Filter to only return Granth, Anuyog, Year, Author fields for each content_type
        # metadata structure: {"Pravachan": {"Granth_hi": [...], ...}, "Granth": {...}}
        filtered_metadata = {}
        for content_type, type_metadata in metadata.items():
            filtered_metadata[content_type] = {}
            for composite_key, values in type_metadata.items():
                # composite_key is like "Granth_hi", "Year_gu", etc.
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

    # Extract search type configurations
    pravachan_config = search_types.get("Pravachan")
    granth_config = search_types.get("Granth")

    has_advanced_options = exact_match or (exclude_words and len(exclude_words) > 0)
    is_lexical_query = (index_searcher.is_lexical_query(keywords) or
                        has_advanced_options)

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

        if is_lexical_query:
            # For lexical queries: perform pravachan and/or granth search based on enabled flags
            pravachan_results = []
            pravachan_total_hits = 0
            granth_results = []
            granth_total_hits = 0

            if pravachan_config.get("enabled", False):
                pravachan_results, pravachan_total_hits = index_searcher.perform_pravachan_search(
                    keywords=keywords,
                    exact_match=exact_match,
                    exclude_words=exclude_words,
                    categories=categories,
                    detected_language=language,
                    page_size=pravachan_config.get("page_size", 20),
                    page_number=pravachan_config.get("page_number", 1),
                    start_year=start_year,
                    end_year=end_year
                )
                log_handle.info(f"Pravachan search returned {len(pravachan_results)} results (total: {pravachan_total_hits}).")

            if granth_config.get("enabled", False):
                granth_results, granth_total_hits = index_searcher.perform_granth_search(
                    keywords=keywords,
                    exact_match=exact_match,
                    exclude_words=exclude_words,
                    categories=categories,
                    detected_language=language,
                    page_size=granth_config.get("page_size", 20),
                    page_number=granth_config.get("page_number", 1),
                    start_year=start_year,
                    end_year=end_year
                )
                log_handle.info(f"Granth search returned {len(granth_results)} results (total: {granth_total_hits}).")

            # If no results from either search, get spelling suggestions
            if pravachan_total_hits == 0 and granth_total_hits == 0:
                suggestions = index_searcher.get_spelling_suggestions(
                    index_name=request.app.state.config.OPENSEARCH_INDEX_NAME,
                    text=keywords,
                    language=language,
                    min_score=0.6,
                    num_suggestions=3
                )
                log_handle.info(f"Suggestions: {suggestions}")

                response = SearchResponse(
                    pravachan_results=SearchTypeResults(
                        results=[],
                        total_hits=0,
                        page_size=pravachan_config.get("page_size", 20),
                        page_number=pravachan_config.get("page_number", 1)
                    ),
                    granth_results=SearchTypeResults(
                        results=[],
                        total_hits=0,
                        page_size=granth_config.get("page_size", 20),
                        page_number=granth_config.get("page_number", 1)
                    ),
                    suggestions=suggestions
                )

                # Log metrics for zero results case
                latency_ms = round((time.time() - start_time) * 1000, 2)
                escaped_query = keywords.replace(',', ';').replace('"', "'").replace('\n', ' ').replace('\r', '')
                escaped_categories = str(categories).replace(',', ';').replace('"', "'")

                log_handle.metrics(
                    f"{client_ip},{escaped_query},lexical,{exact_match},{escaped_categories},{language},"
                    f"{enable_reranking},{pravachan_config.get('page_size', 20)},{pravachan_config.get('page_number', 1)},{latency_ms},0"
                )

                log_handle.info(f"No results found for lexical query '{keywords}'. Returning {len(suggestions)} suggestions.")
                return response

            # Return structured response with both pravachan and granth results
            response = SearchResponse(
                pravachan_results=SearchTypeResults(
                    results=pravachan_results,
                    total_hits=pravachan_total_hits,
                    page_size=pravachan_config.get("page_size", 20),
                    page_number=pravachan_config.get("page_number", 1)
                ),
                granth_results=SearchTypeResults(
                    results=granth_results,
                    total_hits=granth_total_hits,
                    page_size=granth_config.get("page_size", 20),
                    page_number=granth_config.get("page_number", 1)
                ),
                suggestions=[]
            )

            # Calculate latency and log metrics
            latency_ms = round((time.time() - start_time) * 1000, 2)
            total_results = pravachan_total_hits + granth_total_hits

            # Escape query for CSV
            escaped_query = keywords.replace(',', ';').replace('"', "'").replace('\n', ' ').replace('\r', '')
            escaped_categories = str(categories).replace(',', ';').replace('"', "'")

            log_handle.metrics(
                f"{client_ip},{escaped_query},lexical,{exact_match},{escaped_categories},{language},"
                f"{enable_reranking},{pravachan_config.get('page_size', 20)},{pravachan_config.get('page_number', 1)},{latency_ms},{total_results}"
            )

            log_handle.info(f"Search response: {json_dumps(response.model_dump())}")
            return response

        else:
            # For non-lexical queries: perform vector search on pravachan and/or granth based on enabled flags
            pravachan_results = []
            pravachan_total_hits = 0
            granth_results = []
            granth_total_hits = 0

            query_embedding = embedding_model.get_embedding(keywords)
            if not query_embedding:
                log_handle.warning("Could not generate embedding for query. Vector search skipped.")
            else:
                if pravachan_config.get("enabled", False):
                    pravachan_results, pravachan_total_hits = index_searcher.perform_vector_search(
                        keywords=keywords,
                        embedding=query_embedding,
                        categories={**categories, 'category': ['Pravachan']},
                        page_size=pravachan_config.get("page_size", 20),
                        page_number=pravachan_config.get("page_number", 1),
                        language=language,
                        rerank=enable_reranking,
                        rerank_top_k=pravachan_config.get("page_size", 20),
                        start_year=start_year,
                        end_year=end_year
                    )
                    log_handle.info(f"Pravachan vector search returned {len(pravachan_results)} results (total: {pravachan_total_hits}).")

                if granth_config.get("enabled", False):
                    granth_results, granth_total_hits = index_searcher.perform_vector_search(
                        keywords=keywords,
                        embedding=query_embedding,
                        categories={**categories, 'category': ['Granth']},
                        page_size=granth_config.get("page_size", 20),
                        page_number=granth_config.get("page_number", 1),
                        language=language,
                        rerank=enable_reranking,
                        rerank_top_k=granth_config.get("page_size", 20),
                        start_year=start_year,
                        end_year=end_year
                    )
                    log_handle.info(f"Granth vector search returned {len(granth_results)} results (total: {granth_total_hits}).")

            # Use unified SearchResponse format for vector search too
            response = SearchResponse(
                pravachan_results=SearchTypeResults(
                    results=pravachan_results,
                    total_hits=pravachan_total_hits,
                    page_size=pravachan_config.get("page_size", 20),
                    page_number=pravachan_config.get("page_number", 1)
                ),
                granth_results=SearchTypeResults(
                    results=granth_results,
                    total_hits=granth_total_hits,
                    page_size=granth_config.get("page_size", 20),
                    page_number=granth_config.get("page_number", 1)
                ),
                suggestions=[]
            )

            # Calculate latency and log metrics
            latency_ms = round((time.time() - start_time) * 1000, 2)
            total_results = pravachan_total_hits + granth_total_hits

            # Escape query for CSV (replace commas with semicolons, quotes with single quotes)
            escaped_query = keywords.replace(',', ';').replace('"', "'").replace('\n', ' ').replace('\r', '')
            escaped_categories = str(categories).replace(',', ';').replace('"', "'")

            # Log metrics in CSV format: client_ip,query,search_type,exact_match,categories,language,enable_reranking,page_size,page_number,latency_ms,total_results
            log_handle.metrics(
                f"{client_ip},{escaped_query},vector,{exact_match},{escaped_categories},{language},"
                f"{enable_reranking},{pravachan_config.get('page_size', 20)},{pravachan_config.get('page_number', 1)},{latency_ms},{total_results}"
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

