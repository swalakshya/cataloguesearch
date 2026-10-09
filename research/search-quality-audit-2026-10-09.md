# Search quality audit — 9 October 2026

The next investment should be **better candidates and passages before reranking**, followed by a measured multilingual reranker comparison. The existing data exposes concrete retrieval and chunk-quality issues. GraphRAG is a later experiment for relationship and corpus-wide questions, rather than the first intervention for relevant passages buried below rank 40.

This is an analysis, not a production change. The inspected instance is the local OpenSearch `cataloguesearch_prod` index on version 3.3.1. Its parity with production was not independently established. The local API was also running. The production constraints supplied by the user are one OpenSearch node, 4 vCPUs, 12 GB RAM, and 15–20 seconds for current reranking. Khoj can tolerate about 50 seconds; chat should be treated separately.

Compact supporting measurements and passage IDs are in [the audit evidence](search-quality-audit-2026-10-09.json).

## What the data and running code show

The aggregation observed 545,626 chunks: 510,398 with vectors and 35,228 without. The initial index listing had 545,080, so data was changing during the audit. Counts should be read as observations, not a frozen snapshot.

| Finding | Evidence | Consequence |
|---|---|---|
| The candidate ceiling is real | Runtime configuration is `rerank_oversample=40`. Both Khoj and agent vector paths retrieve a fixed pool before reranking. Chat workflows normally request page 1, with 5–15 returned passages depending on workflow/model/language. | Increasing the displayed page size cannot rescue passages outside that pool. Repeating a similar query will often revisit it. |
| Wider retrieval exposes different evidence | For `निमित्त उपादान का संबंध`, reranking 200 vector candidates put eight passages from vector ranks greater than 40 into the reranker's top 10. Their vector ranks were 51, 53, 61, 78, 108, 121, 125, and 137. | The existing reranker can prefer passages it currently never receives. This is model-preference evidence, not a human relevance benchmark. |
| Short fragments consume candidate capacity | In that query's vector top 40, 23 chunks had fewer than 30 words. The live API's unreranked top 10 had eight such chunks, including an introductory line and a section heading. | Topic similarity can select a heading or question without its explanation. These should be expanded or demoted as standalone evidence. |
| Reranking is already useful | The live API's reranked top 10 for the same query had no chunks under 30 words and contained fuller explanations. | Removing reranking to make search faster would lose a useful stage. The remaining problem includes the material available to it. |
| Lexical retrieval brings different passages | 36 of the BM25 top 40 were absent from the vector top 40 for the same query. | Combining the two candidate lists is a useful experiment. Their difference alone does not establish that every lexical addition is relevant. |
| Hybrid search exists but is inactive locally | The API reports `search_mode=auto`. The router chooses lexical retrieval for short unpunctuated queries and vector retrieval for longer or punctuated queries. RRF is implemented as a separate mode. | The active default is routing between lexical and vector search, rather than fusing both for each query. A one-character punctuation change can change the retrieval method. |
| Verse retrieval has an intentional gap | All 35,228 records without vectors have `verse_id`; none of these verse records has a vector. | A vector-only query cannot retrieve these records. Use lexical/verse lookup and connect them to explanations; missing vectors here are not an ingestion failure. |
| Hindi filtering can admit empty Hindi evidence | 12,717 records have raw language `gu+hi` and Gujarati text only. The current `term` filter on analyzed `language` matches these records for both `hi` and `gu`. All 12,717 match Hindi filtering despite lacking Hindi text. | Hindi kNN can admit them and then pass empty text to extraction/reranking. This risk is directly verified; none appeared in the particular natural-query top 40 inspected. |
| Pagination counts are misleading | Khoj's reranked vector method returns `page_size` as its total. The pool is fixed across pages; agent vector pagination without reranking retrieves only one page's worth before slicing by the requested page. | Additional pages can be hidden or empty. Fix separately from chat evidence quality. |

The language issue can be addressed immediately by requiring the requested text field to exist. Longer term, store a canonical searchable language as a keyword and keep raw language metadata separately. Simply changing the current filter to `language.keyword=gu` would exclude `gu+hi` Gujarati content; normalize or include its known variants deliberately.

## Chunk sample

I sampled 1,000 chunks in each of six language/category strata using seeded random scoring. These percentages describe each stratum's sample; the combined 6,000 records are not a proportional corpus sample.

| Language / category | Fewer than 30 words | More than 1,000 characters |
|---|---:|---:|
| Hindi pravachans | 20.7% | 0.1% |
| Hindi granths | 15.1% | 9.1% |
| Hindi books | 8.4% | 0.2% |
| Gujarati pravachans | 9.7% | 0.8% |
| Gujarati granths | 12.3% | 14.3% |
| Mixed-language pravachans, stored in Gujarati field | 14.1% | 0.9% |

Short does not mean irrelevant: a verse or concise definition can be excellent evidence. Some inspected short records were headings, unfinished transitions, or questions detached from their answers. Classify those content roles and recover their surrounding explanation. Do not apply a blanket minimum-word filter.

Exact duplicate excess in the samples was zero in five strata and one in Hindi pravachans. This does not measure near duplicates or duplicates across strata; there is no basis here to make wholesale exact deduplication the first project.

The vector paths truncate reranker input to the first 1,000 characters. That drops some text in approximately 9% of sampled Hindi granths and 14% of sampled Gujarati granths. Use tokenizer-aware passage windows or shorter coherent chunks so an answer near the end is considered.

The loaded base reranker has a 512-token tokenizer limit and 514 position embeddings, while runtime sets `max_length=1500`. None of the sampled query-plus-1,000-character pairs exceeded 512 tokens, so I did not reproduce a length failure. Nevertheless the setting should respect the loaded model's actual supported length, especially if context expansion is added.

## Recommended sequence

### 1. Fix passage integrity and retrieval correctness

Require nonempty text in the requested language. Handle incomplete reranker output explicitly: the ONNX wrapper stops after a 40-second timeout and can return fewer scores than inputs; vector paths then sort by a score key that unscored records do not have. Larger pools would make this more likely. Return a clear fallback order or a marked partial response rather than allowing the request to fail. RRF paths also need a defined policy for unscored records.

Treat headings, question-only fragments, and short transition chunks as pointers to a parent passage. Attach the next/previous paragraph or the corresponding answer before final reranking. Add `chunk_role`, `parent_passage_id`, navigation links, language, and quality flags as measured metadata. Preserve original text and citation locations. The existing paragraph-context/navigation code provides a starting point.

Fix counts and pagination independently. Return the retrieved candidate count honestly; it is not the number of all relevant passages in the corpus. If Khoj needs stable browsing, keep the candidate set/ranked IDs stable for a search session. Native OpenSearch hybrid pagination also requires a fixed pagination depth across pages; this does not automatically paginate the application's cross-encoder results.

### 2. Widen candidate generation while bounding expensive reranking

Evaluate a pipeline such as:

`query → lexical + vector candidates → fusion + passage expansion + quality selection → bounded reranking → relevant, diverse evidence`

Retrieving 200 vectors does not imply reranking all 200. Start with vector candidate depths of 100–300 and a comparable lexical pool, measured against the current 40-candidate baseline. Fuse by rank and select a smaller reranking pool. Use source diversity after establishing relevance, rather than hard quotas that exclude the best source. Preserve rare doctrinal terms, verse numbers, spelling variants, and explicit scope in lexical queries.

The existing lexical leg uses AND across analyzed terms. Test term selection, phrase boosts, and `minimum_should_match` on natural questions rather than switching blindly to OR. Six lexical probes returned 122–371 AND matches, versus tens of thousands of OR matches: widening without relevance controls can create another noisy pool.

RRF alone is insufficient evidence of a fix. In a diagnostic fusion of the 200 vectors and 40 lexical hits, the top 80 contained only five of the current reranker's preferred top 10 from the full 200-vector run. This is a model-based coverage proxy, not human Recall@80. It shows why the candidate-selection stage itself needs evaluation.

| Product mode | Initial experiment | Budget interpretation |
|---|---|---|
| Chat | Broader cheap retrieval, then about 40 selected passages for reranking; expand only fragments needing context | Preserve a bounded workload. Measure expansion cost and end-to-end answer quality. |
| Khoj standard | About 40 selected passages with quality/context improvements | Keep the current useful reranking stage. |
| Khoj accuracy | Broader cheap retrieval, then start with 60–80 selected passages for reranking | At the supplied production rate, 80 could take roughly 30–40 seconds for reranking alone. This is an extrapolation; measure total latency against the 50-second budget. |

The local 200-candidate diagnostic took 26.4 seconds to rerank with four ONNX threads. This workstation timing does not predict production latency. At the user's current production rate, reranking 200 could take 75–100 seconds even before other work. Candidate count, token length, batching, concurrency, and queueing all matter.

Limit concurrent CPU-heavy rerank jobs and share loaded model instances. Measure p95 queue time as well as execution time so a Khoj accuracy request does not monopolize the resources needed by chat and OpenSearch. A bounded queue with explicit partial/fallback behavior is safer than relying on a timeout after starting too much work.

### 3. Benchmark multilingual reranking

The deployed model is `BAAI/bge-reranker-base`, documented for Chinese and English. Its model backbone can tokenize other scripts, but that does not establish retrieval relevance quality in Hindi or Gujarati. The existing test proves it can help; the language fit still warrants comparison.

Benchmark `bge-reranker-v2-m3`, documented as multilingual, against the current model on the same candidate sets. Do not assume an improvement for Jain terminology, Hindi, Gujarati, or production CPU latency without measurement. Switching requires a compatible ONNX model and tokenizer; editing the model-name setting alone does not replace the graph loaded from the configured ONNX directory. Avoid permanently loading both rerankers on the 12 GB production machine during an experiment.

If a suitable model cannot fit the CPU budget, evaluate a smaller multilingual or distilled first-stage scorer. Fine-tuning or distillation becomes sensible after collecting relevance labels and hard negatives such as topical headings and related-but-nonanswering paragraphs. Keep BGE-M3 embeddings initially; the current audit does not establish that a wholesale embedding replacement is necessary.

### 4. Use metadata and structural links before a full graph

The index already has extensive metadata: all chunks have a title; approximately 94% have Anuyog; pravachans have speaker information; many records have series, verse identifiers, and lecture labels. Section-name metadata exists on 114,262 records. Use explicit title/author/series/verse requests as retrieval constraints, and use uncertain inferred scope as a boost or a separate candidate branch.

Preserve passages linking `granth → gatha/verse → commentary → pravachan → surrounding explanation`. Retrieve an exact verse plus its explanatory passages together. This supplies useful relationship traversal without first extracting a general-purpose knowledge graph.

Pilot GraphRAG only if evaluation shows substantial failures on relationship questions or questions requiring coverage across the corpus, such as tracing a concept across texts or comparing treatments by different commentators. Such a graph should retain edge provenance and distinguish an author, a commentator, a speaker, and a doctrinal viewpoint. Automated extraction should not merge a qualified philosophical claim into an unconditional fact.

GraphRAG adds a candidate/summary source; it does not remove top-k limits, repair damaged OCR, or make an unsuitable reranker accurate. Its entities, relationships, communities, and summaries also add ingestion and maintenance work. For this corpus and hardware, a targeted graph pilot follows passage and hybrid improvements.

Radial search is available for the current Faiss setup and can return candidates meeting a score/distance threshold. It is useful if Khoj later needs similarity-based discovery. A similarity threshold does not measure whether a passage answers a question, and approximate radial search is not a guarantee that every relevant passage was enumerated. It is a lower priority for the user's clarified chat-evidence problem.

## How to choose a winner

Build 30–50 representative questions covering Hindi, Gujarati, exact verses/names, doctrinal distinctions, broad themes, OCR variants, and long passages. Pool candidates from the competing systems for human judgment; do not label only today's top 10. Label whether each passage directly answers, merely discusses the topic, needs context, is redundant, or is unusable. Maintain a held-out set when tuning.

Compare candidate recall against judged evidence, nDCG@10, unusable/fragment rate in the final evidence, coverage of distinct supporting sources, and p50/p95 retrieval latency and memory under representative concurrency. For chat, also assess citation support and answer completeness. Treat recall against pooled judgments as an estimate, since the corpus is not exhaustively labeled.

Run ablations: current 40; wider candidates with current reranker; hybrid candidates; passage expansion/quality selection; alternate multilingual reranker. Keep candidate sets fixed when comparing rerankers. Separate approximate-neighbor recall from semantic relevance: increasing `ef_search` can improve neighbor recall, but it cannot fix an irrelevant heading or a missing vector. In three document-vector probes, changing `ef_search` from 128 to 512 at k=200 changed only 1–7 of 200 IDs; this small diagnostic is not an exact-neighbor recall benchmark.

## Primary references

- [BGE base reranker model card](https://huggingface.co/BAAI/bge-reranker-base) and [multilingual v2-M3 model card](https://huggingface.co/BAAI/bge-reranker-v2-m3): language design and model choices.
- [OpenSearch 3.3 k-NN query](https://docs.opensearch.org/3.3/query-dsl/specialized/k-nn/index/): candidate and HNSW search parameters.
- [OpenSearch 3.3 radial search](https://docs.opensearch.org/3.3/vector-search/specialized-operations/radial-search-knn/): threshold-based vector retrieval.
- [OpenSearch 3.3 hybrid pagination](https://docs.opensearch.org/3.3/vector-search/ai-search/hybrid-search/pagination/): stable pagination depth.
- [Microsoft GraphRAG query overview](https://microsoft.github.io/graphrag/query/overview/): local, global, and DRIFT retrieval uses.

## Limits of this audit

The audit used live read-only OpenSearch queries, 6,000 sampled chunks, six lexical probes, three stored-document-vector probes, one live API query with and without reranking, and one 200-candidate offline depth experiment using cached models. Search API probes generated ordinary local telemetry. No human-labeled benchmark, production concurrency test, or alternate-reranker comparison was run. The evidence supports the order of experiments and concrete correctness fixes; it does not establish a percentage improvement in true relevance. No index, model, or runtime configuration was changed.
