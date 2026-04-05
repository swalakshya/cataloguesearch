# URL Shortener Service

## Overview
The URL shortener is a standalone FastAPI service that preloads all known scan URLs
from OpenSearch at startup and serves deterministic short links. It runs alongside
CatalogueSearch services and provides bulk shortening for the agent API, plus redirect
endpoints for end users.

## Endpoints
- `GET /health`
  - Returns `{ "status": "ok" }`.

- `POST /shorten`
  - Bulk shorten request.
  - Request:
    ```json
    { "long_urls": ["https://...", "https://..."] }
    ```
  - Response:
    ```json
    { "short_urls": { "https://...": "https://swalakshya.me/url/abc123" } }
    ```
  - URLs not found are omitted from `short_urls`.

- `GET /url/{code}`
  - 302 redirect to the original long URL.

- `GET /url/{code}/{page}`
  - 302 redirect to the original URL with `#page={page}` appended.

## Agent API Integration
All agent endpoints that include `file_url` return short URLs instead of long URLs.
If a URL is unknown to the shortener, the agent response includes `"file_url": ""`.

## Internals (How It Works)
- On startup, the service queries OpenSearch for distinct `metadata.file_url` values
  (currently `cataloguesearch_prod`).
- It builds two in-memory maps:
  - `long_url -> code`
  - `code -> long_url`
- Short codes are deterministic: `base62(sha256(url))[:N]`.
- If a collision occurs, the code length is extended up to `N+4` to resolve it.
- No persistence: maps are rebuilt on each startup.

## Configuration
- `SHORTENER_BASE_URL` (default `https://swalakshya.me`)
- `SHORT_CODE_LEN` (default `7`)
- `SHORTENER_API_URL` (used by agent API, default `http://url-shortener:8100`)

## Run Locally
The service runs in Docker Compose as `url-shortener` on port `8100`.

Example calls:

```bash
curl -s http://localhost:8100/health
```

```bash
curl -s -X POST http://localhost:8100/shorten \
  -H "Content-Type: application/json" \
  -d '{"long_urls": ["https://example.com/a.pdf"]}'
```

## Tests
Run shortener tests in Docker:

```bash
docker run --rm --platform linux/amd64 \
  -v "$PWD":/app -w /app \
  --entrypoint python3 swalakshya/cataloguesearch:api \
  -m pytest tests/shortener -v --confcutdir=tests/shortener
```
