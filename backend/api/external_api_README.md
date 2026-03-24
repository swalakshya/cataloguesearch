# External API

This document describes the external API endpoints exposed by the CatalogueSearch API server.

**Base URL**
- Local Docker: `http://localhost:8000`
- VM / domain: `http://<your-domain>`

All endpoints are mounted under:
- `/api/external`

## Endpoints

### 1) Search
`POST /api/external/search`

Request body:
```json
{
  "query": "सम्यक् दर्शन",
  "language": "hi",
  "content_type": ["Granth", "Books"],
  "anuyog": "Dravyanuyog",
  "granth": "Samaysaar",
  "contributor": "Pandit Jaychand Chhabbra",
  "year_from": 1985,
  "year_to": 1987,
  "page_size": 10,
  "page": 1,
  "rerank": true
}
```

Response: list of chunks.

### 2) Navigate
`POST /api/external/navigate`

```json
{
  "chunk_id": "uuid_p12_para3",
  "direction": "both",
  "steps": 1
}
```

Response: ordered list of chunks around the given paragraph.

### 3) Find Similar
`POST /api/external/find_similar`

```json
{
  "chunk_id": "uuid_p12_para3"
}
```

Response: list of semantically similar chunks.

### 4) Get Filter Options
`POST /api/external/get_filter_options`

```json
{
  "language": "hi",
  "content_type": "Pravachan"
}
```

Response:
```json
{
  "granths": ["Samaysaar"],
  "anuyogs": ["Dravyanuyog"],
  "contributors": ["Author Name"],
  "date_ranges": {
    "Samaysaar": [{"start": "1985-01-01", "end": "1987-12-31"}]
  }
}
```

### 5) Get Pravachan
`POST /api/external/get_pravachan`

```json
{
  "granth": "Samaysaar",
  "pravachan_number": "93",
  "language": "hi"
}
```

Response: ordered list of all chunks in the Pravachan.

## Client Access (any HTTP-capable client)

### cURL
```bash
curl -s http://localhost:8000/api/external/search \
  -H 'Content-Type: application/json' \
  -d '{"query":"कर्म","language":"hi","content_type":["Granth","Books"],"page_size":10,"page":1,"rerank":true}'
```

### Python (requests)
```python
import requests

base_url = "http://localhost:8000"
resp = requests.post(
    f"{base_url}/api/external/search",
    json={
        "query": "कर्म",
        "language": "hi",
        "content_type": ["Granth", "Books"],
        "page_size": 10,
        "page": 1,
        "rerank": True,
    },
)
print(resp.json())
```

### LangChain (HTTP tool)
Use the OpenAPI spec at:
- `docs/tools/external_api_openapi.yaml`
- `docs/tools/external_api_openapi.json`

### Gemini / Custom Agents
Any LLM agent that can call HTTP endpoints can use the JSON schema above. Point it to:
`/api/external/*` and pass JSON payloads.
