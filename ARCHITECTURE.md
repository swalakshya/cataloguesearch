# CatalogueSearch — Architecture

## System Overview

CatalogueSearch has three main concerns:

1. **Crawling** — discovering PDF files, extracting text, chunking into paragraphs, generating vector embeddings, and writing to OpenSearch
2. **Serving** — a FastAPI search API that runs hybrid (lexical + vector) search with reranking
3. **Frontend** — a React UI served via nginx

A separate transliteration service ([varnmala-io](https://github.com/swalakshya/varnmala-io)) handles Romanized-to-Devanagari query conversion at search time.

---

## Components

### Crawler

The crawler is an ETL pipeline that processes two distinct document types. Each type has its own ingestion path.

#### Pravachan path (PDF → Tesseract → OpenSearch)

```
PDFs in cataloguesearch-configs/
        │
        ▼
   Discovery Module          Scans for new/changed PDFs, tracks state in SQLite
        │
        ▼
   PDF Processor             Converts PDF pages to images (Poppler/pdf2image)
        │
        ▼
   Tesseract OCR             Extracts raw text (Hindi hin / Gujarati guj)
        │
        ▼
   Paragraph Generator       Chunks text into searchable paragraphs
                             Handles headers/footers, cross-page paragraphs,
                             Q&A detection, language-specific rules
        │
        ▼
   Index Generator           Generates vector embeddings (BAAI/bge-m3),
                             writes chunks to OpenSearch
```

The **Discovery Module** maintains an SQLite database (`cataloguesearch.db`) tracking the indexing state of every document — whether it has been crawled, indexed, and when it was last modified.

The **Paragraph Generator** is the most critical component. Poor chunking degrades search quality. It handles:
- Detection and removal of headers/footers
- Paragraphs that span multiple pages
- Q&A pairs kept together in one chunk
- Stop words and section markers specific to each document type
- Language-specific normalisation (Anusvar, Halant, etc.)

Entry point: `scripts/discovery_cli.py`

#### Granth path (PDF → Gemini LLM → OpenSearch)

Granth scripture texts require accurate Devanagari extraction that Tesseract cannot reliably provide. Gemini is used for OCR instead.

```
PDFs in cataloguesearch-configs/
        │
        ▼
   LLM PDF Processor         Sends PDF pages to Gemini, outputs page_*.json files
   (Gemini)                  with extracted text per page
        │
        ▼
   LLMIndexGenerator         Creates two chunk types from page_*.json files:
                             - Verse chunks (no embeddings)
                             - Paragraph chunks (with embeddings, BAAI/bge-m3)
        │
        ▼
   OpenSearch                cataloguesearch_prod_granth
```

Entry point: `scripts/discovery_cli.py` (with `ocr_engine: llm` in scan config)

---

### Search API

FastAPI application (`backend/api/search_api.py`) running on port 8000.

- **Hybrid search** — combines BM25 (lexical) and kNN (vector) results
- **Reranking** — ONNX-optimised `BAAI/bge-reranker-base` scores and reorders results
- **Metadata filtering** — pre-filters by Granth, Anuyog, Author, etc.
- **Transliteration** — queries in Roman script are converted to Devanagari via varnmala-io before searching

The reranker runs as ONNX (not PyTorch) for significantly faster inference. The ONNX model is bundled into the Docker image at build time from `models/bge-reranker-base-onnx/`.

---

### OpenSearch

Custom Docker image (`docker/opensearch/Dockerfile`) based on `opensearchproject/opensearch:3.3.1` with two additional plugins:

- `analysis-icu` — Unicode-aware tokenisation for Indic scripts
- `repository-gcs` — GCS snapshot repository support

Three indices:

| Index | Content |
|-------|---------|
| `cataloguesearch_prod` | All document chunks — paragraphs with vector embeddings |
| `cataloguesearch_prod_metadata` | Aggregated metadata values (Granth names, Authors, etc.) for filter dropdowns |
| `cataloguesearch_prod_granth` | Granth verse and prose chunks |

The main index is tuned for Indic content: proximity search, typo tolerance, and normalisation of common Devanagari variations (शांति / शान्ति).

---

### Transliteration Service (varnmala-io)

A separate microservice ([github.com/swalakshya/varnmala-io](https://github.com/swalakshya/varnmala-io)) that converts Romanized Indic text to Devanagari. Runs on port 8500.

The API calls this service before executing a search when the query appears to be in Roman script. This lets users type queries in English letters and get meaningful Devanagari search results.

Not required for local development unless you are testing transliteration features.

---

### Frontend

React application built with Tailwind CSS, served via nginx. In production, nginx also handles SSL termination (port 443) and proxies API requests to the backend container.

A separate eval UI is available at the `/eval` route, served by a second FastAPI server on port 8001 (`eval/api.py`). It provides tooling for inspecting OCR output, paragraph generation quality, and LLM-extracted bookmarks.

---

### URL Shortener Service

A standalone FastAPI service that loads all `metadata.file_url` values from OpenSearch at startup, generates deterministic short codes, and serves redirects under `/url/{code}` (and `/url/{code}/{page}` with `#page=N`). The API uses it via `/api/agent/shorten_url`.

---

## Configuration

All runtime configuration lives in `configs/config.yaml`. This file is volume-mounted into the API container (not baked into the image), so it can be changed without a rebuild.

Key sections:

```yaml
crawler:
  base_pdf_path: ...          # path to cataloguesearch-configs/
  ocr_engine: "tesseract"     # default OCR for Pravachan
  bookmark_extractor_llm: "gemini"
  default_llm_model: "gemini-2.5-flash"

opensearch:
  index_name: cataloguesearch_prod
  metadata_index_name: cataloguesearch_prod_metadata
  granth_index_name: cataloguesearch_prod_granth

vector_embeddings:
  embedding_model: BAAI/bge-m3
  reranking_model: BAAI/bge-reranker-base
  reranker_onnx_path: "{BASE_DIR}/models/bge-reranker-base-onnx"

transliteration:
  api_url: "http://localhost:8500"
```

Values in `{CURLY_BRACES}` are replaced at startup with environment variables.

---

## Deployment

### Local development

```
docker-compose.yml
  opensearch                    (port 9200)
  cataloguesearch-api           (port 8000)
  cataloguesearch-frontend      (port 3000)
```

### Production

```
docker-compose.prod.yml
  opensearch                    (port 9200, internal)
  varnmala-io                   (port 8500, internal)
  cataloguesearch-api           (port 8000, internal)
  cataloguesearch-frontend      (ports 80 + 443, external — handles SSL)
```

The production frontend image uses `docker/frontend/nginx.conf` which includes SSL config and proxies `/api` to the API container. The local image uses `docker/frontend/nginx-local.conf` (no SSL).

---

## Data Flow for a Search Query

```
User types query
      │
      ▼
Frontend (React)
      │  POST /api/search
      ▼
Search API
      │  (if Roman script) → varnmala-io:8500 → Devanagari query
      │
      ├─ BM25 query  ──────────────┐
      ├─ kNN vector query ─────────┤→ OpenSearch → merged results
      │                            │
      ▼                            │
   Reranker (ONNX)  ←─────────────┘
      │  scored and sorted
      ▼
   Response → Frontend
```
