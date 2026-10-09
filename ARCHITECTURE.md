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

Custom Docker image (`docker/opensearch/Dockerfile`) based on `opensearchproject/opensearch:3.3.1` with one additional plugin:

- `analysis-icu` — Unicode-aware tokenisation for Indic scripts

Snapshots use a local filesystem repository managed by `scripts/create_snapshots.py` and `scripts/restore_snapshots.py`.

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

### Deploy page service actions

At `/deploy`, the Service images card shares one service selection between two independent actions: **Build & Push** (selected by default) and **Pull & Restart Services**. Selecting both builds and pushes first, then pulls and recreates the selected services on the configured production host. The job stops at the first failure; a failed image pull never proceeds to restart.

Pull/restart uses the host's existing `.env.prod` and `docker-compose.prod.yml`, with `up -d --no-deps --no-build --force-recreate` so it only recreates the selected services. It uses SSH and works when local Docker is unavailable. The existing typed production confirmation lists the host and services before starting. Full deploy uses the chosen image actions followed by the existing OpenSearch snapshot/restore flow.

Manual verification: select a service and run Build & Push alone; check that only its image is built/pushed. Select Pull & Restart Services alone, confirm the listed host/services, and inspect the two job commands (pull, then up). Select both and verify the build step precedes pull/restart. Clear the action or service selection and verify the image Run button is disabled. These checks deploy to the configured host; automated tests use mocks and do not perform a deployment.


### Google Drive backups

The local `/deploy?tab=backups` tab uses the shared job runner, progress/log viewer, Copy button, and history. Its backend checks `rclone` on PATH; the tab and submission are disabled with an error if it is unavailable. **Connect Google Drive** starts a separate private `rclone authorize drive` process, opens the loopback sign-in URL, and polls authorization status. Tokens never enter job logs or API responses; a dedicated rclone config is written with mode 0600 outside Git. See [rclone authorization](https://rclone.org/commands/rclone_authorize/).

**Submit** archives `~/cataloguesearch`, captures consistent SQLite databases with the online backup API, generates fresh local OpenSearch snapshots using the existing snapshot helpers, and creates two streaming `.tar.zst` archives. The snapshot worker confirms the configured directory matches OpenSearch's bind mount before clearing/restarting; cancellation attempts to restart a stopped container. A backup uses the job lock to avoid overlapping indexing/deployment. Date names are fixed at run start in Asia/Kolkata.

The backend uploads exactly `cataloguesearch_yyyymmdd.tar.zst` and `snapshots_yyyymmdd.tar.zst` to a temporary Drive folder, verifies sizes/checksums with `rclone check`, publishes `My Drive/snapshots/yyyymmdd`, and checks the published files again. Only then does it move excess dated folders to Google Drive trash, keeping the current folder plus the most recent other date (two total). Non-date folders, files, invalid dates, and incomplete upload folders are excluded; duplicate named backup folders stop the job. Same-date reruns replace archive files after staged verification. Local archives remain for manual recovery; incomplete staging folders are retained on failures.

Settings: `BACKUP_SOURCE_DIR` (default `~/cataloguesearch`), `BACKUP_OUTPUT_DIR` (default `~/cataloguesearch-backups`, required outside the source), and `BACKUP_RCLONE_CONFIG` (default `~/.config/cataloguesearch-backup/rclone.conf`). The existing `DEPLOY_PYTHON` selects the worker interpreter and must have `zstandard` installed. Optional `RCLONE_DRIVE_CLIENT_ID` and `RCLONE_DRIVE_CLIENT_SECRET` configure your own Google OAuth client; rclone's shared client is used otherwise. The connection requires access to existing Drive files so retention can remove manually created dated folders.

Manual verification: open Backups, connect Drive and finish Google sign-in, check the retention preview, then submit. Verify both archives in today's Drive folder and that only today's folder and the latest prior dated folder remain. Inspect the job logs for upload/check/publish/check/retention steps. Simulate a missing rclone executable and verify the tab/submission error. Unit tests use temporary local files and mocked OAuth/Drive/Docker; they do not upload or delete real backups.

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

### Search effort and surrounding context

High effort (`accuracy_mode=true`) retrieves 100 candidates and always attempts bounded previous/next paragraph enrichment before vector or hybrid reranking in Khoj and chat. Low effort uses the configured candidate count (default 40) and follows the admin `context_reranking` flag. The rule is request-scoped; choosing High never changes the shared admin setting or another request. Khoj PDF exports carry the same effort option. Missing or incompatible neighbours and token limits can reduce the available context; lexical-only searches do not rerank.

### Operation timing disclosures

Khoj and each chat answer use the shared `OperationTiming` component: a muted live elapsed timer, then a collapsed completion row with operation details on click. Old messages without timing metadata show no invented duration. Khoj measures browser elapsed time from the search request through its final SSE event; that event includes request-local retrieval, context enrichment, and reranking work measured with a monotonic clock in the backend. Searcher timing scopes pass explicitly into executor threads and never modify shared configuration.

Agent search preserves its existing JSON array response and adds optional `X-Search-Timings` metadata. The chat service measures understanding, source search, and answer generation with a monotonic request-local collector, includes `timings` in completed job responses, and saves it in the existing assistant-message JSON for history (no database schema changes). Fine search timings appear nested under source search as accumulated work because parallel searches can overlap; they are not added to the wall-clock total. Chat totals describe service execution through answer completion, excluding browser transport and the decorative typing animation.

Manual verification: submit a Khoj query, watch elapsed time, expand the completed row, and compare Low/High context/reranking durations. Send a chat question, expand its timing row, refresh and reopen History to confirm the recorded timing remains. Older history entries should have no timing row. Backend and chat service processes must load these changes; Vite updates the shared frontend component automatically.
