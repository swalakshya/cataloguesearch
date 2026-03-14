# CatalogueSearch — Onboarding Guide

## Overview

CatalogueSearch is a search system for multilingual (Hindi/Gujarati) PDF documents, primarily targeted towards Spiritual scriptures and discourses. It processes two document types via different pipelines:

- **Discourses** — list of fairly structured PDF text files
- **Scriptures** — unstructured / semi-structured text files

See [ARCHITECTURE.md](ARCHITECTURE.md) for a full design overview.

---

## Onboarding / Setup

This section lists the prerequisites required to setup your laptop to get **cataloguesearch** up and running.

### OrbStack (Docker runtime)

This project uses [OrbStack](https://orbstack.dev/) as the Docker runtime on macOS. Install it and ensure it's running before any `docker compose` commands.

### Homebrew packages

```bash
brew install tesseract tesseract-lang poppler
```

Verify Tesseract has Hindi and Gujarati:
```bash
tesseract --list-langs    # should include hin and guj
```

### Python 3.12+

```bash
python3 --version    # must be 3.12+
```

### Indic NLP Resources

```bash
git clone https://github.com/anoopkunchukuttan/indic_nlp_resources.git /path/to/indic_nlp_resources
echo 'export INDIC_RESOURCES_PATH="/path/to/indic_nlp_resources"' >> ~/.zshrc
source ~/.zshrc
```

### API Keys

You will need the following keys. Get them from a colleague or create your own:

| Key | Where used                                      |
|-----|-------------------------------------------------|
| `GEMINI_API_KEY` | Granth crawling (LLM OCR + bookmark extraction) |
| `HF_TOKEN` | HuggingFace — downloading models for tests      |
| `RECAPTCHA_SECRET_KEY` + `REACT_APP_RECAPTCHA_SITE_KEY` | Feedback form UI                                |
| `BREVO_API_KEY` | Email delivery for feedback                     |

---

## One-Time Setup

### 1. Clone required repositories

```bash
git clone https://github.com/swalakshya/cataloguesearch
git clone https://github.com/swalakshya/cataloguesearch-configs
git clone https://github.com/swalakshya/varnmala-io
```

Set up `varnmala-io` per its own [README](https://github.com/swalakshya/varnmala-io). Place all three repos as siblings in the same parent directory.

### 2. Create environment files

**`.env.local`** (repo root) — used by `docker compose` and `discovery_cli.py`:

```bash
DOCKER_PLATFORM=linux/arm64        # linux/amd64 on Intel
OPENSEARCH_JAVA_OPTS=-Xms1g -Xmx1g
OPENSEARCH_INITIAL_ADMIN_PASSWORD=Admin@Password123!
RESTART_POLICY=no
LOG_LEVEL=VERBOSE
API_HOST=0.0.0.0
API_PORT=8000
OPENSEARCH_HOST=localhost
REACT_APP_API_BASE_URL=http://localhost:8000/api
REACT_APP_EVAL_API_BASE_URL=http://localhost:8001/api
REACT_APP_RECAPTCHA_SITE_KEY=<key>
RECAPTCHA_SECRET_KEY=<key>
BREVO_API_KEY=<key>
FEEDBACK_FROM_EMAIL=contact@swalakshya.me
FEEDBACK_TO_EMAIL=contact@swalakshya.me
GEMINI_API_KEY=<key>
BROWSER=none
```

Create a symlink inside `frontend/` so that `npm start` picks up the same file:

```bash
ln -s ../.env.local frontend/.env.local
```

**`tests/.env`** — used by the test suite:

```bash
ROOT_DIR=/path/to/cataloguesearch
TEST_BASE_DIR=${ROOT_DIR}/tests
TEST_DATA_DIR=${TEST_BASE_DIR}/data
PATH=$PATH:/opt/homebrew/bin:/opt/homebrew/sbin
INDEX_NAME="opensearch-index-pytest"
HF_TOKEN=<key>
GEMINI_API_KEY=<key>
```

### 3. Set up Python environment

```bash
cd cataloguesearch
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### 4. Build the ONNX reranker model

**Required before the first Docker build.** The API image bundles this model at build time.

```bash
cd models/
python ../scripts/convert_reranking_model.py
# produces: models/bge-reranker-base-onnx/
```

This downloads `BAAI/bge-reranker-base` from HuggingFace and converts it to ONNX. Only needs to be done once (or when the model changes).

### 5. Build Docker images

```bash
docker compose --env-file .env.local build
```

### 6. Get an OpenSearch snapshot and restore it

Ask a colleague for the `snapshots/` directory and place it at the repo root. Then:

```bash
# Start OpenSearch
docker compose --env-file .env.local up opensearch -d

# Interactive restore (walks through each step)
./scripts/restore_snapshots.sh snapshots
```

This restores three indices: `cataloguesearch_prod`, `cataloguesearch_prod_metadata`, `cataloguesearch_prod_granth`.

Verify:
```bash
curl localhost:9200/cataloguesearch_prod/_count
curl localhost:9200/cataloguesearch_prod_metadata/_count
curl localhost:9200/cataloguesearch_prod_granth/_count
```

---

## Running the Stack

```bash
docker compose --env-file .env.local up -d
```

| Service | URL |
|---------|-----|
| Frontend | http://localhost:3000 |
| Search API | http://localhost:8000 |
| OpenSearch | http://localhost:9200 |

### Running without Docker (development)

Useful when iterating on the backend or frontend without rebuilding images. OpenSearch still needs to be running via Docker.

```bash
# API server
source venv/bin/activate
uvicorn backend.api.search_api:app --env.file .env.local --host 0.0.0.0 --port 8000 --reload

# Frontend (separate terminal)
cd frontend && npm start
```

---

## Eval UI

The eval UI is a local-only tool for inspecting OCR output, paragraph generation quality, and LLM-extracted bookmarks. It runs as a separate server on port 8001.

```bash
# Start the eval server
source venv/bin/activate
uvicorn eval.api:app --host 0.0.0.0 --port 8001 --reload
```

Access it at http://localhost:3000/eval (via the frontend).

---

## Ingesting New Content

All source PDFs and their metadata live in `cataloguesearch-configs/`, organised as:

```
cataloguesearch-configs/
├── Pravachans/
│   ├── hindi/
│   │   └── <Anuyog>/<Series>/    ← PDFs go here
│   └── gujarati/
│       └── <Anuyog>/<Series>/
└── Granth/
    └── llm_extract/
        └── hindi/
            └── <Anuyog>/<Name>/  ← PDFs go here
```

Each folder in the hierarchy can have a `config.json` that contributes metadata (language, Anuyog, Granth name, Author, etc.) via inheritance. See existing entries for reference.

### Indexing a new Discourse series (Pravachan)

1. Add PDFs under the appropriate `Pravachans/<language>/<Anuyog>/<Series>/` folder
2. Add a `config.json` with any series-specific metadata (e.g. `Series`, `series_start_date`)
3. Run discovery:

```bash
source venv/bin/activate
python scripts/discovery_cli.py discover \
  --process-folder /path/to/cataloguesearch-configs/Pravachans/hindi/<Anuyog>/<Series> \
  --crawl --index --no-dry-run
```

### Indexing a new Scripture (Granth)

1. Add PDFs under `Granth/llm_extract/<language>/<Anuyog>/<Name>/`
2. Add a `config.json` with `name`, `Author`, and optionally `Teekakar`
3. Run discovery (uses Gemini LLM for OCR automatically via `scan_config.json`):

```bash
source venv/bin/activate
python scripts/discovery_cli.py discover \
  --process-folder /path/to/cataloguesearch-configs/Granth/llm_extract/hindi/<Anuyog>/<Name> \
  --crawl --index --no-dry-run
```

### Dry run first

Always do a dry run before actual indexing to catch config issues:

```bash
python scripts/discovery_cli.py discover \
  --process-folder /path/to/folder \
  --crawl --index --dry-run
```

---

## Running Tests

```bash
# Start test OpenSearch (separate instance on port 19200)
docker compose -f docker-compose.test.yml --env-file .env.local up -d

# Run tests
source venv/bin/activate
pytest
```

---

## Production Server Setup

For deploying on a fresh Ubuntu/Debian VM.

### 1. Install Docker

```bash
sudo ./scripts/install-docker.sh
newgrp docker
```

### 2. Set OpenSearch kernel parameter

Required for OpenSearch to start. Must be set on the host, not inside the container.

```bash
sudo sysctl -w vm.max_map_count=262144
echo "vm.max_map_count=262144" | sudo tee -a /etc/sysctl.conf
```

### 3. Copy files to the server

Transfer the following to the VM via `scp` or your preferred method:

- `docker-compose.prod.yml`
- `.env.prod`
- `snapshots/` — if seeding with existing data

### 4. Start the stack

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d
```

Then restore the snapshot using `./scripts/restore_snapshots.sh` as described above.

---

## LICENSE

MIT License — Copyright (c) 2025 Rajat Jain