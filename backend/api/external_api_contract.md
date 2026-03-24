API Server Contract for CatalogueSearch

## Background

CatalogueSearch indexes two authoritative sources of Jain scriptures:

    Mool Agam (Granth) — Original scriptures written by Jain Saints and Scholars

    Pravachan — Discourses by Shri Kanji Swami

## Data Reference

|               |                              Pravachan                             |                                       Granth                                      |   |   |
|:-------------:|:------------------------------------------------------------------:|:---------------------------------------------------------------------------------:|---|---|
| Count         | 253,786                                                            | 10,338                                                                            |   |   |
| Languages     | Hindi (hi), Gujarati (gu)                                          | Hindi                                                                             |   |   |
| Unique fields | date, pravachan_number, Series, series_start_date, series_end_date | gatha, shlok, kalash, Author, Tikakaar, Bhasha Vachanika, verse_type, sub_section |   |   |
| Anuyog        | Dravyanuyog, Charananuyog                                          | Dravyanuyog, Charananuyog                                                         |   |   |

Chunk ID structure: {uuid}_p{page}_para{paragraph_id} — paragraph_id is a sequential integer within each document, enabling sequential navigation via +1 / -1.

Metadata index: cataloguesearch_prod_metadata — pre-aggregated filter options (Granths, Anuyogs, date ranges, contributors) per language and content type. Updated automatically as new content is indexed.

## API Endpoints

Five business endpoints -

### 1. search

The main entry point. Performs keyword or semantic search with filters. Reranking is applied automatically for semantic queries (fetches top 40 via KNN, re-scores with BAAI/bge-reranker-base, returns top N).

Inputs:

|     Field    |                Type               |  Default |                                           Description                                          |
|:------------:|:---------------------------------:|:--------:|:----------------------------------------------------------------------------------------------:|
| query        | str                               | required | Search text (Hindi or Gujarati)                                                                |
| language     | "hi" \| "gu"                      | required | Script language                                                                                |
| content_type | list of "Pravachan" \| "Granth" \| "Books" | ["Granth", "Books"] | Filter by content categories (pass one or more values) |
| anuyog       | str                               | optional | e.g. "Dravyanuyog", "Charananuyog"                                                             |
| granth       | str                               | optional | e.g. "Samaysaar", "Niyamsaar"                                                                  |
| contributor  | str                               | optional | Matches against Author, Tikakaar, or Bhasha Vachanika — agent does not need to know which role |
| year_from    | int                               | optional | Pravachan only — filter by discourse year                                                      |
| year_to      | int                               | optional | Pravachan only                                                                                 |
| page_size    | int                               | 10       | Max 50                                                                                         |
| page         | int                               | 1        | Pagination                                                                                     |
| rerank       | bool                              | true     | Apply cross-encoder reranking on semantic queries                                              |

The contributor field fans out as an OR query across all three contributor roles internally:

bool.filter.should:
  - term: metadata.Author.keyword = contributor
  - term: metadata.Tikakaar.keyword = contributor
  - term: metadata.Bhasha Vachanika.keyword = contributor
minimum_should_match: 1

This means an agent receiving "find content by Pandit Jaychand Chhabbra" does not need to know whether that person is an Author, Tikakaar, or Bhasha Vachanika.

Returns: Ordered list of chunks, each with:
chunk_id, text_content, category, granth, anuyog, language, date, pravachan_number, gatha, page_number, file_url, score

### 2. navigate

Walk sequentially through a document by paragraph. direction="both" with steps=1 returns the previous + current + next paragraphs (subsumes the need for a separate get_context tool).

Inputs:
|   Field   |            Type            |  Default |              Description             |
|:---------:|:--------------------------:|:--------:|:------------------------------------:|
| chunk_id  | str                        | required | Starting chunk                       |
| direction | "next" \| "prev" \| "both" | "both"   | Navigation direction                 |
| steps     | int                        | 1        | How many paragraphs to walk (max 20) |

Returns: Ordered list of chunks.

### 3. find_similar

Given a chunk, find semantically related passages across all scriptures and discourses using vector KNN search.

Inputs:
| Field    | Type | Description                           |
|----------|------|---------------------------------------|
| chunk_id | str  | Source chunk to find similarities for |

Returns: Top 10 semantically similar chunks (from any Granth or Pravachan), each with full metadata.

### 4. get_filter_options

Returns available filter values before calling search. Reads live from the metadata index — automatically reflects new Granths, Anuyogs, contributors, and languages as content is indexed. No code changes needed.

Inputs:
|     Field    |           Type          |    Description   |
|:------------:|:-----------------------:|:----------------:|
| language     | "hi" \| "gu"            | Language context |
| content_type | "Pravachan" \| "Granth" \| "Books" | Category         |

Returns:

    granths — list of scripture names
    anuyogs — list of Anuyog classifications
    contributors — unified deduplicated list of all names across Author, Tikakaar, and Bhasha Vachanika
    date_ranges — { GranthName: [{start, end}] } (Pravachan only)

### 5. get_pravachan

Fetch all chunks of a specific numbered discourse in order. Useful when an agent wants to read an entire Pravachan rather than just search results.

Inputs:
|       Field      |     Type     |    Description   |
|:----------------:|:------------:|:----------------:|
| granth           | str          | e.g. "Samaysaar" |
| pravachan_number | str          | e.g. "93"        |
| language         | "hi" \| "gu" | Language         |

Returns: All ordered chunks of that Pravachan.
Future-Proofing

The server requires zero code changes as new content is added:

    New Granths → automatically appear in get_filter_options, searchable immediately

    New Anuyogs → filter values are strings, not hardcoded enums

    New Authors, Tikaakaars, Bhasha Vachanika names → merged into contributors automatically

    New Pravachan series → picked up automatically by date/series filters

    New languages → flow through all tools without changes

The only scenario requiring a design change would be a fundamentally new structural type of content (e.g., audio with timestamps instead of paragraph_id-based paragraphs).

What is NOT exposed

    No write operations

    No raw OpenSearch passthrough

    No vector embedding endpoint (agents use find_similar instead)

    cataloguesearch_prod_granth index (deprecated)
