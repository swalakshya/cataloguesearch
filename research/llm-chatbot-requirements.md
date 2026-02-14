# LLM Chatbot Requirements

## Overview

Build a RAG-based chatbot that answers questions using the OpenSearch index, exposing both a frontend and a reusable API for third-party integrations.

---

## Architecture Flow

```
User Query
    │
    ▼
┌─────────────────────────────────────────┐
│  1. Query Interpretation (LLM)          │
│     • Parse natural language            │
│     • Determine relevant metadata       │
│       fields for filtering              │
└─────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────┐
│  2. Hybrid Retrieval (OpenSearch)       │
│     • Lexical search (BM25/keyword)     │
│     • Vector search (semantic)          │
└─────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────┐
│  3. Re-ranking & Context Expansion (LLM)│
│     • Collate results from both search  │
│     • Evaluate relevance                │
│     • Fetch surrounding paragraphs if   │
│       context is insufficient           │
│       (via search_api.py APIs)          │
└─────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────┐
│  4. Response Generation (LLM)           │
│     • Strictly grounded in retrieved    │
│       content                           │
│     • Conversational formatting only    │
│     • NO external knowledge added       │
└─────────────────────────────────────────┘
    │
    ▼
  Response
```

---

## Core Requirements

### 1. Data Source
- **OpenSearch index** as defined in `opensearch-config.yaml`
- Documents stored as **individual paragraphs** (one paragraph per document)
- Documents have **various metadata fields** that can be used for filtering

### 2. Query Understanding
- LLM interprets user's natural language query
- LLM determines which **metadata fields** to use for filtering/searching
- LLM must be aware of the available metadata schema

### 3. Search & Retrieval
- **Hybrid search** combining:
  - Lexical search (BM25/keyword matching)
  - Vector search (semantic embeddings)
- Query executed against OpenSearch with LLM-determined filters

### 4. Re-ranking & Context Expansion
- LLM **collates results** from lexical and vector search
- LLM **evaluates and selects** the most relevant paragraphs
- When paragraph context is insufficient, **fetch surrounding paragraphs** (up/down context)
- Reuse existing APIs in `search_api.py` for context expansion

### 5. Response Grounding
- Responses **strictly based on OpenSearch results only**
- LLM adds **conversational formatting** (making responses readable/natural)
- **No hallucination** — LLM must NOT add information from its own knowledge
- If answer isn't in retrieved documents, acknowledge that rather than fabricate

### 6. Conversation History
- Persist **last 5-10 conversation exchanges** for follow-up context
- Storage is **browser session scoped only** (sessionStorage or equivalent)
- **No user/session management** — anonymous, tab-based sessions
- When browser tab closes → session ends → history is cleared

### 7. LLM Provider
- **Cloud APIs**: OpenAI and Google (Gemini)
- **Cost controls** required — limits on queries/tokens per day
- Provider usage TBD:
  - Redundancy/fallback?
  - User choice?
  - Different models for different steps? (e.g., cheaper for query interpretation, stronger for response generation)

### 8. Code Organization
- **No changes to existing code**
- New frontend components and APIs in a new **`llm` folder**
- Keeps chatbot feature modular and isolated

### 9. API Server
- Expose chatbot functionality as an **API**
- Enable third parties to build their own chatbot interfaces
- API-first design — own frontend also uses this API

---

## Explicit Non-Goals

- User authentication / login
- Persistent session management across browser sessions
- LLM answering from its own knowledge
- Modifying existing codebase

---

## Key Files to Reference

| File | Purpose |
|------|---------|
| `opensearch-config.yaml` | OpenSearch index configuration and metadata schema |
| `search_api.py` | Existing search APIs including context expansion (up/down paragraphs) |

---

## Open Questions

1. **LLM provider strategy**: Use both OpenAI and Gemini for redundancy, choice, or different purposes?
2. **Cost limits**: Specific limits for queries/tokens per day?
3. **Metadata fields**: Which fields should LLM be aware of for filtering?
4. **Rate limiting**: Per-user limits, global limits, or both?

---

## Related Documents

- `research/conversational-search-architecture.md` — Earlier detailed technical architecture (some overlap, some differences)