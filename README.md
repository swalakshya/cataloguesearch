# CatalogueSearch

CatalogueSearch is a search system for multilingual (Hindi/Gujarati) religious and scriptural texts. It ingests PDF documents and scripture texts, processes them through OCR and LLM-based extraction pipelines, and exposes a hybrid lexical + semantic search interface through a web UI.

The system supports two document types:

- **Pravachan** — discourse PDFs
- **Granth** — scripture texts

Search combines BM25 keyword matching, vector embeddings, and a reranking model to surface the most relevant passages. Indic transliteration allows queries typed in Roman script to match Devanagari content.

## Onboarding

See [ONBOARDING.md](ONBOARDING.md) for step-by-step instructions to have cataloguesearch working on your laptop.

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for a design overview: crawler pipelines, search API, OpenSearch indices, transliteration service, and deployment topology.

## License

MIT License — Copyright (c) 2025 Rajat Jain