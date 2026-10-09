# Search case: विकल्प और विचार में क्या अन्तर है?

Investigated on 9 October 2026 using the running local API and OpenSearch `cataloguesearch_prod`. The screenshot's Niyamsaar and Parmatma Prakash passages were reproduced exactly. This is a single-query diagnostic, not a relevance benchmark or production performance test.

## Accuracy mode is active

The user's local API logs at 10:20:48 show `accuracy_mode=False candidates=40`; at 10:23:10 they show `accuracy_mode=True candidates=100`. Both requests reranked the requested number of documents without a logged timeout. A separate read-only reproduction restricted to Hindi Pravachan confirms that 7 of the top 10 results remain the same, with three new results entering under Accuracy.

| Fragment | Standard rank | Accuracy rank | Reranker score |
|---|---:|---:|---:|
| Niyamsaar p180: जितना विकल्प रहता है… | 4 | 7 | 0.3866 |
| Parmatma Prakash p613: विकल्प को साथ लेकर… | 5 | 8 | 0.2882 |
| Samaysaar Kalash Tika p245: विकल्प हो तो ख्याल हो… | 8 | 11 | 0.1519 |

The additional candidates displace some results but do not change the scores assigned to existing passages. A larger pool does not itself teach the reranker to reject topical, non-answering fragments.

## Controlled context experiment

Read the preceding/following paragraphs through `/api/context/{id}`. For each fragment, constructed a window containing the final 350 characters of the previous paragraph, the complete current fragment, and the first 350 characters of the next paragraph. All three windows fit within the existing 1,000-character reranker input limit, retaining the target fragment. Scored these windows with the cached deployed ONNX model and the same query; used batches of four, four CPU threads, and a 512-token limit. Fragment-only scores match the live API to four decimals.

| Fragment | Fragment-only score | With surrounding context |
|---|---:|---:|
| Niyamsaar p180 | 0.3866 | 0.0011 |
| Parmatma Prakash p613 | 0.2882 | 0.0032 |
| Samaysaar Kalash Tika p245 | 0.1519 | 0.0004 |

The surrounding topics are meditation, the relation of practical/absolute viewpoints, and endurance of hardships. These windows make their limited relevance to the requested distinction more apparent. Scores are model outputs, not calibrated probabilities. Context changes input length/content; this experiment cannot establish universal improvement or justify a fixed word-count rejection rule.

## Lexical candidate experiment

A read-only BM25 query requiring both `विकल्प` and `विचार`, filtered to Hindi Pravachan, matches 849 chunks. This is an exploratory candidate source, not a proposed hard filter for all user questions.

One passage, Samaysaar Kalash Tika p219 (`ea2f78e5-b2ca-5d76-a5ea-b569b484e23f_p219_para708`), explicitly discusses different meanings of विचार, including ज्ञान and विकल्प. It is absent from the reproduced Accuracy top 20. The same reranker rates it 0.8965, above the current first result at 0.8008. This suggests an additional retrieval opportunity. Separately, some fuller passages from the lexical set still receive very low scores; hybrid retrieval alone cannot guarantee good ordering.

## Recommended next experiment

Keep the existing 100-candidate reranking budget. Fetch candidates from both vector and BM25 retrieval, deduplicate/fuse them, then select at most 100 for reranking. Add bounded neighbour context to fragments before scoring, preserving the central passage within the tokenizer/character budget. Return the central passage with an appropriate context excerpt so displayed evidence agrees with what was scored.

Compare current vector-100, hybrid-100, contextual vector-100, and contextual hybrid-100 on this query and a small labeled query set. Measure human answer relevance, top-10 fragment rate, and latency. Do not discard every short passage or require exact mention of both terms globally; short definitions and synonymous explanations can be useful. Consider another reranker only after distinguishing candidate selection from scoring failures on this evaluation set.

No application behavior, index, model, or runtime configuration was changed during this investigation. Local probe outputs are in `/tmp/khoj-example-*.ndjson`, `/tmp/khoj-example-both-terms.json`, `/tmp/khoj-example-rerank-probe.json`, and `/tmp/khoj-fragment-context*.json`.

## Implementation validation: context flag

After the user authorized implementation, added the admin `context_reranking` flag, default off, for both Khoj and chat. The implemented path was benchmarked in an isolated process against the same local index; the live API's persisted settings were not changed. The query embedding and model were loaded before timing. Both runs used 100 Hindi Pravachan candidates and four ONNX threads.

| Measurement | Flag off | Flag on |
|---|---:|---:|
| Retrieval plus reranking, excluding model/embedding startup | 14.75 s | 26.90 s |
| Niyamsaar p180 fragment rank | 7 | Outside top 20 |
| Parmatma Prakash p613 fragment rank | 8 | Outside top 20 |
| Samaysaar Kalash Tika p245 fragment rank | 11 | Outside top 20 |

With the flag on, all 100 candidates went through context enrichment; 92 retained usable neighbour excerpts after token-budget and boundary checks. One batched neighbour search fetched missing context, reusing neighbours already in the candidate pool. The deployed model's 512-token limit was enforced. The RRF central-source bulk lookup and neighbour enrichment were separately checked against five real records, all of which received context.

The complete ranking also changed: the former first result moved to fourth, while Ishtopadesh p439 moved from tenth to first. Removing these fragments is useful evidence for the intended behavior, but does not establish better overall answer relevance. Evaluate a labeled set before broad rollout. Existing reranking deadlines still apply and can leave partially scored candidate pools under production resource contention.

See `cataloguesearch-chat/service/docs/design.md`, Context Reranking, for implementation details and rollout steps. Benchmark output is in `/tmp/context-rerank-benchmark.json` and `/tmp/context-rerank-benchmark.log`.
