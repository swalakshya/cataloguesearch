"""
Batch-mode LLM PDF processor: submits page OCR to Gemini's Batch API instead of
calling generate_content synchronously per page.

Batch calls are billed at 50% of the synchronous price and run outside the
per-minute rate-limit quota, at the cost of a "usually much sooner than 24h,
but not immediate" turnaround -- an acceptable trade for OCR, a bulk,
non-interactive workload. See research/gemini-batch-ocr-offline-processor.md
for the design this implements.
"""
import base64
import io
import json
import logging
import os
import tempfile
import uuid
from datetime import datetime, timezone

from google import genai
from google.genai import types

from backend.crawler.llm_pdf_processor import LLMPDFProcessor, PROMPT

log_handle = logging.getLogger(__name__)

# Gemini caps inline batch request payloads at 20MB; page images alone routinely
# exceed that past a handful of pages, so this processor always submits via the
# JSONL file-upload path instead of maintaining a second inline code path.
_TERMINAL_STATES = {
    "JOB_STATE_SUCCEEDED", "JOB_STATE_FAILED", "JOB_STATE_CANCELLED", "JOB_STATE_EXPIRED",
}


def _get_gemini_client():
    api_key = os.environ.get("GEMINI_API_KEY", "")
    if not api_key:
        raise ValueError("GEMINI_API_KEY environment variable is not set")
    return genai.Client(api_key=api_key)


def _page_key(page_num: int) -> str:
    return f"page_{page_num:04d}"


def _page_num_from_key(key: str) -> int | None:
    try:
        return int(key.split("_")[-1])
    except (ValueError, IndexError):
        return None


def _image_to_request(image) -> dict:
    buf = io.BytesIO()
    image.save(buf, format="JPEG")
    data = base64.b64encode(buf.getvalue()).decode("ascii")
    return {
        "contents": [{
            "role": "user",
            "parts": [
                {"text": PROMPT},
                {"inline_data": {"mime_type": "image/jpeg", "data": data}},
            ],
        }],
        "generation_config": {"response_mime_type": "application/json"},
    }


class LLMPDFOfflineProcessor(LLMPDFProcessor):
    """
    Drop-in alternative to LLMPDFProcessor that OCRs pages via Gemini's Batch API.

    Subclasses LLMPDFProcessor (rather than PDFProcessor directly) to reuse its
    output format (_write_output_to_file/read_paragraphs) and its single-page
    fallback retry (_try_single_model) unchanged -- output on disk is identical
    to the synchronous processor, so nothing downstream needs to know which one
    produced it.

    process_pdf is two-phase, keyed off state recorded in IndexState rather than
    off output files alone (a document mid-batch has no output files yet, but
    isn't "not started" either):
      - submit:  no batch job recorded -> render missing pages, submit a batch
                 job, record it, return False (crawl reruns until it drains).
      - collect: a batch job is recorded -> poll it. Still running -> False.
                 Succeeded -> write page_NNNN.json for each page, retry any
                 failed pages inline against SECONDARY_LLM_MODEL, clear the
                 recorded job, return True (or False if pages are still
                 missing after the inline retry).
    """

    def __init__(self, config, llm_model: str = None, index_state=None):
        super().__init__(config, llm_model=llm_model)
        if index_state is None:
            from backend.crawler.index_state import IndexState
            index_state = IndexState(config.SQLITE_DB_PATH)
        self._index_state = index_state

    def process_pdf(self, pdf_file: str, scan_config: dict, pages_list: list[int]):
        if not os.path.exists(pdf_file):
            raise FileNotFoundError(f"Error: File {pdf_file} not found.")

        relative_pdf_path = os.path.relpath(pdf_file, self._base_pdf_folder)
        document_id = str(uuid.uuid5(uuid.NAMESPACE_URL, relative_pdf_path))
        output_ocr_dir = f"{self._base_ocr_folder}/{os.path.splitext(relative_pdf_path)[0]}"
        os.makedirs(output_ocr_dir, exist_ok=True)

        batch_job = self._index_state.get_batch_job(document_id)
        if batch_job:
            return self._collect(pdf_file, document_id, batch_job, output_ocr_dir, scan_config)

        return self._submit(pdf_file, document_id, output_ocr_dir, pages_list, scan_config)

    # ------------------------------------------------------------------
    # Phase A -- submit
    # ------------------------------------------------------------------

    def _submit(self, pdf_file, document_id, output_ocr_dir, pages_list, scan_config):
        relative_pdf_path = os.path.relpath(pdf_file, self._base_pdf_folder)
        missing_pages = [
            p for p in pages_list
            if not os.path.exists(f"{output_ocr_dir}/page_{p:04d}.json")
        ]
        if not missing_pages:
            log_handle.info(f"All {len(pages_list)} pages already processed in {output_ocr_dir}")
            return True

        llm_model = scan_config.get("llm_model", self._llm_model)
        images, page_numbers = self._get_image(pdf_file, missing_pages, scan_config)
        if not images:
            log_handle.warning(f"No pages could be rendered for {pdf_file}; nothing to submit.")
            return False

        client = _get_gemini_client()
        job_name = self._create_batch_job(client, llm_model, page_numbers, images, document_id)

        self._index_state.set_batch_job(
            document_id,
            batch_job_name=job_name,
            status="pending",
            submitted_at=datetime.now(timezone.utc).isoformat(),
            model=llm_model,
            file_path=relative_pdf_path,
        )
        log_handle.info(
            f"Submitted Gemini batch job {job_name} for {len(page_numbers)} page(s) of {pdf_file} "
            f"(model={llm_model}). Rerun crawl later to collect results."
        )
        return False

    def _create_batch_job(self, client, model, page_numbers, images, document_id) -> str:
        lines = [
            json.dumps({"key": _page_key(p), "request": _image_to_request(img)}, ensure_ascii=False)
            for p, img in zip(page_numbers, images)
        ]
        jsonl_content = "\n".join(lines)

        with tempfile.NamedTemporaryFile(mode="w", suffix=".jsonl", delete=False, encoding="utf-8") as fh:
            fh.write(jsonl_content)
            tmp_path = fh.name

        try:
            uploaded_file = client.files.upload(
                file=tmp_path,
                config=types.UploadFileConfig(
                    display_name=f"ocr-{document_id}",
                    mime_type="jsonl",
                ),
            )
            job = client.batches.create(
                model=model,
                src=uploaded_file.name,
                config={"display_name": f"ocr-{document_id}"},
            )
        finally:
            os.remove(tmp_path)

        return job.name

    # ------------------------------------------------------------------
    # Phase B -- collect
    # ------------------------------------------------------------------

    def _collect(self, pdf_file, document_id, batch_job, output_ocr_dir, scan_config):
        job_name = batch_job["batch_job_name"]
        client = _get_gemini_client()

        try:
            job = client.batches.get(name=job_name)
        except Exception as e:
            log_handle.error(f"Failed to poll batch job {job_name} for {pdf_file}: {e}")
            return False

        state = job.state.name if hasattr(job.state, "name") else str(job.state)

        if state not in _TERMINAL_STATES:
            log_handle.info(f"Batch job {job_name} for {pdf_file} is still {state}; will check again next run.")
            return False

        if state != "JOB_STATE_SUCCEEDED":
            log_handle.error(
                f"Batch job {job_name} for {pdf_file} ended in {state}; "
                f"clearing recorded job and will resubmit on next run."
            )
            self._index_state.clear_batch_job(document_id)
            return False

        results = self._download_results(client, job, job_name)
        self._index_state.clear_batch_job(document_id)

        failed_pages = []
        for page_num, blocks in results.items():
            if blocks is None:
                failed_pages.append(page_num)
            else:
                self._write_output_to_file(output_ocr_dir, [(page_num, blocks)])

        if failed_pages:
            failed_pages = self._retry_failed_pages_inline(pdf_file, failed_pages, output_ocr_dir, scan_config)

        if failed_pages:
            log_handle.error(
                f"Batch OCR completed with {len(failed_pages)} failed page(s) for {pdf_file}: "
                f"{failed_pages}. IndexState will NOT be updated -- re-run to retry."
            )
            return False

        log_handle.info(f"Batch OCR completed for {pdf_file} in {output_ocr_dir}")
        return True

    def _download_results(self, client, job, job_name) -> dict[int, list | None]:
        """
        Returns {page_num: blocks} for every key in the results file, blocks is
        None for pages that errored or failed to parse.

        The exact JSON envelope of a downloaded batch-results line isn't fully
        pinned down from docs alone (samples disagree on `key`/`response` at the
        top level vs. nested under `output`) -- this checks both shapes and
        leaves an unrecognised line's raw text logged rather than silently
        dropped, so a real run makes any mismatch immediately visible.
        """
        results = {}
        dest = getattr(job, "dest", None)
        result_file_name = getattr(dest, "file_name", None) if dest else None
        if not result_file_name:
            log_handle.error(f"Batch job {job_name} succeeded but has no result file.")
            return results

        raw = client.files.download(file=result_file_name)
        text = raw.decode("utf-8") if isinstance(raw, bytes) else raw

        for line in text.splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                log_handle.error(f"Batch job {job_name}: could not parse result line: {line[:200]}")
                continue

            key = entry.get("key", "")
            page_num = _page_num_from_key(key)
            if page_num is None:
                log_handle.warning(f"Batch job {job_name}: result line has no usable key: {line[:200]}")
                continue

            response = entry.get("response")
            error = entry.get("error")
            if response is None and error is None:
                output = entry.get("output", {})
                response = output.get("response")
                error = output.get("error")

            if error or response is None:
                log_handle.warning(f"Batch job {job_name}: page {page_num} errored: {error}")
                results[page_num] = None
                continue

            try:
                text_out = response["candidates"][0]["content"]["parts"][0]["text"]
                results[page_num] = json.loads(text_out)
            except (KeyError, IndexError, TypeError, json.JSONDecodeError) as e:
                log_handle.warning(
                    f"Batch job {job_name}: page {page_num} response could not be parsed: {e}. "
                    f"Raw line: {line[:200]}"
                )
                results[page_num] = None

        return results

    def _retry_failed_pages_inline(self, pdf_file, failed_pages, output_ocr_dir, scan_config) -> list[int]:
        """
        Retries pages that came back failed/unparseable from the batch job,
        synchronously against SECONDARY_LLM_MODEL. Batch failures are expected
        to be rare (safety blocks, transient parse errors) so a small inline
        retry here is simpler than tracking a second batch job for them.
        """
        if not self._fallback_model:
            return failed_pages

        images, page_numbers = self._get_image(pdf_file, failed_pages, scan_config)
        still_failed = []
        for page_num, image in zip(page_numbers, images):
            blocks = self._try_single_model(image, self._fallback_model)
            if blocks is None:
                still_failed.append(page_num)
            else:
                self._write_output_to_file(output_ocr_dir, [(page_num, blocks)])
        return still_failed
