# OpenSearch 3.6 embedding tokenizer patch

Upstream: ML Commons release `3.6.0.0`, commit
`4f7054ff02c2476e2307220c47af07e899120644`.
Source: https://github.com/opensearch-project/ml-commons/blob/4f7054ff02c2476e2307220c47af07e899120644/ml-algorithms/src/main/java/org/opensearch/ml/engine/algorithms/text_embedding/ONNXSentenceTransformerTextEmbeddingTranslator.java
SHA256: `cff07c26723d6144b3025a5b2502cb401f2c735052d714bcc513a9d7ae96baa1`.

The vendored source is unmodified and retains its upstream Apache-2.0 notice.
`build.py` verifies its checksum and the plugin release, changes only tokenizer
initialization, and compiles the class and its switch helper against the bundled
OpenSearch/DJL jars using the bundled JDK. It updates the algorithms jar in a
Docker build stage; no patching occurs on production startup.

Both DJL `modelMaxLength` and `maxLength` are set to 1024. This policy applies to
all local ONNX dense embedding models in this image. Only BGE-M3 is currently
bundled. The text-similarity translator and reranker retain their 512-token limit.
Review this patch and regenerate long references before changing versions/models.

`WarmRuntime.java` loads the same PyTorch CPU 2.5.1 pre-C++11 and DJL tokenizer
runtime versions used by ML Commons 3.6. These libraries are bundled under
`/opt/opensearch-runtime` and seeded into the mounted data volume before startup.
