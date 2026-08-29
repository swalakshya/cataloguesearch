#!/usr/bin/env python3
"""
Manual smoke test for LLMPDFOfflineProcessor (Gemini Batch OCR).

Run it once to submit a batch job for a page range of a local PDF. Batch jobs
aren't instant (Gemini's SLA is "usually much sooner than 24h, but not
immediate"), so re-run the exact same command later to poll and, once the job
has finished, collect the results -- this mirrors how the real crawl loop
drives LLMPDFOfflineProcessor via reruns.

Job state is tracked in a small sqlite file under the OS temp dir (NOT the
project's real IndexState DB), so this can be run freely without touching
production crawl state.

Usage:
    python -m scratch.batch_ocr_smoke_test \\
        --pdf /path/to/file.pdf --output-dir /path/to/out \\
        --start-page 1 --end-page 3

    # later, re-run the identical command to check status / collect results
    python -m scratch.batch_ocr_smoke_test \\
        --pdf /path/to/file.pdf --output-dir /path/to/out \\
        --start-page 1 --end-page 3

Pages land at <output-dir>/<pdf-stem>/page_NNNN.json -- same layout and JSON
format the real LLMPDFProcessor/LLMPDFOfflineProcessor use.

Requires GEMINI_API_KEY in the environment (or in a .env.local at the repo
root), on a paid/billed Gemini tier -- the Batch API is not available on the
free tier.
"""
import argparse
import os
import sys
import tempfile
import uuid

from scratch.prod_setup import prod_setup
from backend.config import Config
from backend.crawler.index_state import IndexState
from backend.crawler.llm_pdf_offline_processor import LLMPDFOfflineProcessor

DEFAULT_STATE_DB = os.path.join(tempfile.gettempdir(), "cataloguesearch_batch_ocr_smoke_state.db")


def parse_args():
    parser = argparse.ArgumentParser(description="Smoke-test Gemini Batch OCR on a single local PDF.")
    parser.add_argument("--pdf", required=True, help="Path to the local PDF file.")
    parser.add_argument("--output-dir", required=True,
                         help="Directory OCR output is written under (a <pdf-stem>/ subfolder is created inside it).")
    parser.add_argument("--start-page", type=int, required=True, help="First page to OCR (1-based, inclusive).")
    parser.add_argument("--end-page", type=int, required=True, help="Last page to OCR (1-based, inclusive).")
    parser.add_argument("--model", default=None,
                         help="Override the LLM model (defaults to crawler.default_llm_model in config.yaml).")
    parser.add_argument("--state-db", default=DEFAULT_STATE_DB,
                         help=f"Scratch sqlite file to track the batch job in (default: {DEFAULT_STATE_DB}).")
    return parser.parse_args()


def main():
    args = parse_args()

    try:
        from dotenv import load_dotenv
        load_dotenv(".env.local")
    except ImportError:
        pass

    prod_setup(console_only=True)

    pdf_path = os.path.abspath(args.pdf)
    if not os.path.exists(pdf_path):
        print(f"PDF not found: {pdf_path}")
        sys.exit(1)

    config = Config("configs/config.yaml")
    # Point the processor at this single PDF's own directory and the chosen
    # output dir, in-memory only -- does not touch the real crawler paths.
    config.settings()["crawler"]["base_pdf_path"] = os.path.dirname(pdf_path)
    config.settings()["crawler"]["base_ocr_path"] = os.path.abspath(args.output_dir)

    print(f"Using scratch job-state DB: {args.state_db}")
    index_state = IndexState(args.state_db)

    processor = LLMPDFOfflineProcessor(config, llm_model=args.model, index_state=index_state)

    scan_config = {}
    if args.model:
        scan_config["llm_model"] = args.model

    pages_list = list(range(args.start_page, args.end_page + 1))

    print(f"Processing {pdf_path}, pages {args.start_page}-{args.end_page}...")
    done = processor.process_pdf(pdf_path, scan_config, pages_list)

    document_id = str(uuid.uuid5(uuid.NAMESPACE_URL, os.path.basename(pdf_path)))
    batch_job = index_state.get_batch_job(document_id)

    print()
    if done:
        stem = os.path.splitext(os.path.basename(pdf_path))[0]
        out_dir = os.path.join(os.path.abspath(args.output_dir), stem)
        print(f"Done. Pages written to: {out_dir}")
    elif batch_job:
        print(
            f"Batch job in flight: {batch_job['batch_job_name']} "
            f"(model={batch_job['batch_model']}, submitted={batch_job['batch_submitted_at']}).\n"
            f"Re-run this exact command later to check status / collect results."
        )
    else:
        print(
            "process_pdf returned False with no batch job recorded -- some pages likely "
            "failed even after the inline fallback retry. Check the logs above for details."
        )


if __name__ == "__main__":
    main()
