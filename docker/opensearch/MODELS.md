# Bundled BGE models for OpenSearch 3.6

The production image is `swalakshya/cataloguesearch:opensearch-3.6.0-bge-1024-v1`
(`linux/amd64`). It contains CPU FP32 ONNX weights for BGE-M3 and
BGE-reranker-base, a patched ML Commons embedding translator, and the native CPU
and tokenizer libraries. Production startup requires no model/runtime downloads.

BGE-M3 uses CLS pooling and L2 normalization, with a **1,024-token input limit**.
BGE-reranker-base returns sigmoid(logits), with **512 tokens shared by query and
passage**. These caps include special tokens. Longer inputs are truncated;
chunking oversized documents is a separate indexing change. Sparse/ColBERT heads
are not included. The API/data migration and corpus re-embedding remain separate.

## Prepare artifacts

Activate the export environment, then:

```bash
python -m pip install -r requirements-model-export.txt
python scripts/prepare_opensearch_models.py
```

Export resolves model revisions, writes manifests and SHA256 hashes, and compares
short CPU ONNX predictions with PyTorch for Hindi, Gujarati and English. Packages
use opset 18 / IR 9, compatible with the bundled ONNX Runtime 1.16.3. The reranker
accepts the unused token_type_ids input required by OpenSearch's translator.
The git-ignored packages live under `models/opensearch/`. Existing manifests are
never overwritten: choose a different `--output` directory to re-export weights.

Long ONNX references are generated automatically during export. To update the
references for already-exported packages without changing their weights:

```bash
python scripts/prepare_opensearch_fixtures.py
```

Readiness verifies Hindi/Gujarati inputs below and above 512 tokens, up to 1,024,
and beyond the cap; long reranker inputs verify the separate 512-token policy.
Missing long references fail the image build before it can be deployed.

## Build and run locally

From the repository root:

```bash
docker build --platform linux/amd64 -f docker/opensearch/Dockerfile -t swalakshya/cataloguesearch:opensearch-3.6.0 .
docker compose --env-file .env.local -f docker-compose.yml -f docker-compose.models.yml build opensearch
docker compose --env-file .env.local -f docker-compose.yml -f docker-compose.models.yml up -d opensearch
```

The base build installs ICU/GCS plugins. The models build compiles the pinned
translator against the bundled OpenSearch/DJL jars, bundles weights and checks,
and downloads/loads native runtime libraries during the build. See
[patch provenance](patches/README.md). Only the ONNX dense embedding translator is
patched; all ONNX dense embedding models in this image inherit the 1,024 cap.

On startup the image seeds native libraries into the mounted data volume,
registers missing models, and deploys them. Restart checks the in-memory node
profile, reuses matching name/function/weight-checksum registrations, and reloads
models as needed. Short and long predictions must match the bundled references
before `/tmp/opensearch-models-ready` is written. Both Docker and production
Compose health checks require this marker. Fresh registration can take several
minutes; the health start period does not delay readiness when checks pass early.

Bootstrap temporarily serves packages on container loopback port 8081. It enables
URL registration and inference on the single data node. Model IDs are recorded
at `/opt/opensearch-models/model-ids.json`; they are assigned separately per
cluster. The JVM heap is separate from native model memory: budget RAM for both
models, inference buffers, indexing and JVM, then benchmark production load.

## Publish and deploy the tested image

```bash
docker push swalakshya/cataloguesearch:opensearch-3.6.0-bge-1024-v1
```

The deploy UI's OpenSearch build action builds the base first and builds/pushes
this models image using the override. API-only builds do not need model artifacts.
`docker-compose.prod.yml` references this exact final tag and waits for model
readiness. Use a new versioned tag for subsequent builds; for strict immutability,
use the registry digest returned by `docker push` in production Compose.

Copy the updated production Compose file to the production deployment directory,
then run there:

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml pull opensearch
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d opensearch
```

Existing data volumes retain registered model metadata. A fresh volume registers
both bundled models automatically. Existing paragraph vectors remain unchanged
until the separate re-embedding migration. The API still loads its original
models until that separate migration is implemented.

## Local corpus audit (2026-10-06)

The actual packaged BGE-M3 tokenizer, with truncation/padding disabled and special
tokens included, counted 465,684 paragraphs in 134,224 JSON files under
`~/cataloguesearch/text`. 169 exceeded 512 tokens (0.0363%); seven exceeded 1,024
(0.0015%); maximum 1,798; 95th percentile 326. Hindi accounted for 144 of the
169 oversized paragraphs. 1,169 comparisons against the previous Hugging Face
tokenizer had identical token IDs. These are local paragraphs, not production
query statistics. Chat's UI allows 1,000 characters; its extracted keyword
queries have no enforced token limit.

## Image validation (2026-10-06)

Image ID: `sha256:dd7dd39338a0287929f23d4c063dbc025c9d14de9216ad8c9aa832021d6f9dc5`
(local BuildKit image; this is not a registry digest).

The amd64 image was tested on a newly created empty data volume attached only to
an internal Docker network (no internet). It seeded native runtime libraries,
automatically registered and deployed both models, passed all nine embedding
and five reranker ONNX reference checks, and became healthy. References include
Hindi/Gujarati inputs of 792/800 tokens and 1,195/1,206 tokens truncated to 1,024,
plus reranker pairs of 737/749 tokens truncated to 512. Disposable test resources
were removed after validation. Six focused registration/deployment-build tests
also pass. This verifies model compatibility/bootstrap, not production throughput.

The same image then restarted the normal local container on its existing volume,
reused the original IDs (`N1DoEaEBiV8bYJIlKezN` for reranking and
`O1DqEaEBiV8bYJIl0Ozy` for embeddings), and passed all 14 checks again without
re-registration. The local service is healthy. Image publishing and production
rollout have not been performed in this validation run.
