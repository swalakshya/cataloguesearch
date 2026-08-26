# Gemini Batch OCR: `LLMPDFOfflineProcessor`

## Problem Summary

`LLMPDFProcessor` (`backend/crawler/llm_pdf_processor.py`) calls Gemini's
synchronous `generate_content` once per page, throttled through a
`ThreadPoolExecutor` (default 10 workers) to respect the free-tier ~10 RPM
limit. This works, but:

- **Cost**: synchronous calls are billed at full price. Gemini's Batch API
  bills the same models at 50% of the synchronous price.
- **Throughput**: worker count is capped by RPM limits, not by cost or
  infrastructure — batch jobs run outside that per-minute quota, so large
  backfills would likely finish faster in wall-clock time despite the batch
  SLA (results "within 24h", usually much sooner).

OCR is a bulk, non-interactive workload (nobody is waiting on a single page's
result), which is exactly the shape Batch mode is built for.

Goal: add an offline/batch-mode processor that is a drop-in alternative to
`LLMPDFProcessor`, without disrupting the existing synchronous path (kept for
small/ad-hoc single-PDF runs) or anything downstream of OCR output
(`page_NNNN.json` files, `IndexState`, paragraph generation).

## Non-goals

- Not moving to Vertex AI / GCS. Current setup uses the Gemini *Developer*
  API (`genai.Client(api_key=...)` from `GEMINI_API_KEY`), not a GCP project.
  Vertex AI Batch prediction uses GCS buckets for input/output, but that
  requires provisioning a GCP project + service account — a heavier ops lift
  than what exists today, for no benefit here. The Developer API's own batch
  mode needs neither: small batches submit inline requests and get results
  back embedded in the job object; larger batches upload a JSONL through
  Gemini's own File API (`client.files.upload`) and download a result file
  the same way — Google-managed storage, not a bucket the project owns.
- Not building a separate submit/collect CLI. The existing crawl/index
  command is already rerun-driven and resume-safe (`process_pdf` only
  reprocesses pages missing `page_NNNN.json`); batch mode should ride that
  same rerun loop rather than adding new operational surface.

## Design

### 1. New processor: `backend/crawler/llm_pdf_offline_processor.py`

`LLMPDFOfflineProcessor(PDFProcessor)` — same public shape as
`LLMPDFProcessor` (`process_pdf(pdf_file, scan_config, pages_list)`,
`get_output_file_extension`, `read_paragraphs`), so `MultiPagePDFProcessor`,
`GranthParagraphGenerator`, and everything else downstream is unaware of
which concrete class produced `page_NNNN.json`.

Internally, `process_pdf` becomes two-phase, keyed off state recorded in
`IndexState` (see below) rather than off the presence of output files alone,
since "no output file yet" is now ambiguous between "not started" and
"batch job in flight":

**Phase A — submit** (no batch job recorded for this document):
1. Compute `missing_pages` exactly as today (pages without
   `page_NNNN.json`).
2. Render each missing page to an image (`self._get_image`, reused from
   `PDFProcessor`), build one Gemini batch request per page (same `PROMPT`,
   same `response_mime_type="application/json"` config as today), keyed by
   page number.
3. Submit via `client.batches.create(...)` — inline requests if the payload
   is small enough, otherwise upload a JSONL via `client.files.upload()`
   first and reference that file.
4. Record `{batch_job_name, status: "pending", submitted_at, page_numbers}`
   against the document in `IndexState`.
5. Return `False` — same convention `LLMPDFProcessor` already uses for
   `failed_pages`: crawl continues, `IndexState`'s checksum fields are not
   updated, safe/expected to rerun later.

**Phase B — collect** (a batch job is already recorded for this document):
1. Poll `batch_job_name`'s status.
2. Still running → return `False` again (no-op; unchanged from Phase A's
   contract).
3. `SUCCEEDED` → download/parse results, write `page_NNNN.json` per page
   exactly as `_write_output_to_file` does today, clear the recorded batch
   job state, return `True` (or `False` if some pages came back
   failed/empty — see fallback below).
4. `FAILED`/`EXPIRED` → clear the recorded state and fall back to Phase A's
   submit on the next call (retry as a fresh batch).

Net effect: the *same* crawl/index command the user already runs today
double as both "submit" and "check status" depending on what's recorded —
no new script, no manual link-checking. A cron or manual periodic rerun is
enough to eventually drain pending batches.

### 2. Fallback model handling

`LLMPDFProcessor` retries a failed page in-line against
`SECONDARY_LLM_MODEL`. A batch is one model per job, so this can't be
inline. Instead: after a Phase B collect, any pages Gemini returned as
failed (or that fail JSON parsing) are bundled into a second, smaller batch
job against `SECONDARY_LLM_MODEL`, tracked the same way (a
`fallback_batch_job_name` alongside the primary one, or simply resubmitted
through the same single-job-per-document slot once the primary is fully
drained). Only pages still failing after the fallback batch are left
missing, surfaced the same way `failed_pages` is surfaced today.

### 3. `IndexState` schema

Add columns to `indexed_files_state` (or a small side table if preferred,
to avoid widening the main table further):

```sql
batch_job_name   TEXT   -- Gemini batch job resource name, NULL if none pending
batch_status     TEXT   -- "pending" | "succeeded" | "failed", NULL if none pending
batch_submitted_at TEXT
```

New `IndexState` methods, following the existing style
(`get_state`/`update_state`/etc. in `backend/crawler/index_state.py`):

- `get_batch_job(document_id) -> dict | None`
- `set_batch_job(document_id, batch_job_name, status, submitted_at)`
- `clear_batch_job(document_id)`
- `list_pending_batch_jobs() -> list[dict]` — for the Eval UI view below.

This reuses the same DB the crawler already touches per document, so no new
storage system, no separate state file, and it survives process restarts
the same way the rest of the crawl state does.

### 4. Switch: `ocr_engine=llm` chooses offline vs. online

No argparse CLI exists in this codebase — everything flows through
`scan_config`/`config.yaml` (see `backend/crawler/pdf_factory.py`,
`backend/common/scan_config.py`). Follow that existing override pattern:

- New config key `llm_mode`, default `"batch"`, alternate value `"online"`.
- Config default in `configs/config.yaml` under the same `crawler:` block
  that holds `default_llm_model`/`llm_workers`; exposed via
  `backend/config.py` the same way (`config.LLM_MODE`).
- Per-file override supported the same way `ocr_engine`/`llm_model` are
  already overridden per-file in `scan_config.py` (`file_config["llm_mode"]`
  takes precedence over the global default) — so a single file/run can opt
  back into synchronous mode without touching global config.
- `pdf_factory.create_pdf_processor`:

  ```python
  if ocr_engine == "llm":
      llm_mode = scan_config.get("llm_mode", config.LLM_MODE)
      if llm_mode == "online":
          inner = LLMPDFProcessor(config, llm_model=llm_model, llm_workers=llm_workers)
      else:
          inner = LLMPDFOfflineProcessor(config, llm_model=llm_model)
  ```

  This satisfies "batch is the default whenever Gemini OCR is used, unless
  explicitly overridden" — the override is a one-line `llm_mode: online` in
  a file's scan config, not a new CLI flag.

### 5. Eval UI surface (secondary, not required for correctness)

`eval/api.py` already exposes single-page LLM extraction
(`extract_indic_text`) for testing. Add a small read-only view backed by
`IndexState.list_pending_batch_jobs()`:

- Table of `document_id` / `batch_job_name` / `status` / `submitted_at`.
- A manual "refresh status" action per row (calls the same Phase B check
  logic ad hoc, without waiting for the next full crawl rerun).

This is purely for visibility/debugging — batch jobs must keep progressing
automatically on crawl rerun regardless of whether anyone opens this view;
it should not become a required step to unstick a job.

## Open questions

- Batch size limits per job (page count / payload size) — need to check
  current Gemini Batch API limits and decide whether one document maps to
  one batch job always, or large documents get split into multiple jobs.
- Whether `llm_workers` config is meaningless in batch mode (no local
  concurrency needed) or should map to something like "max concurrent batch
  jobs across documents" for a full backfill run.
- Retry/backoff semantics for job *submission* failures (network errors
  when calling `batches.create`) vs. job *content* failures (pages Gemini
  couldn't OCR) — the plan above only covers the latter.
