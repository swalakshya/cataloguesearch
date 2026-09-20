"""Discover jobs. Per folder, ingesting is two phases, and index never starts before OCR is complete:

  1. OCR    `--crawl`  -> files go Not indexed -> OCRed (ocr/ and text/ folders are written; nothing goes to
            OpenSearch). With LLM batch OCR this only *submits* the job.
  2. Wait   a single shared wait (all folders at once) that re-runs the crawl to collect finished batch jobs.
            Gives up after DISCOVER_MAX_WAIT_MINUTES; the run then ends "waiting" and you click Discover again
            later: batch state lives in SQLite, so it resumes where it left off.
  3. Index  `--index`  -> OCRed -> Indexed, only for folders whose OCR is complete.

Modes: "ocr" = phases 1-2 (then evaluate the output by hand), "index" = phases 1-3, "reindex" = force the
index step again on already-OCRed folders. Cleanup is a separate one-step job.
"""
import os
import sys
import time
from typing import List, Optional

from deploy.runner import EXIT_WAITING, Cmd, StepCtx, StepSpec, runner
from ingest import status

POLL_SECONDS = int(os.environ.get("DISCOVER_POLL_SECONDS", "30"))
# Gemini batch jobs can take up to 24h; don't sit and wait for them. Come back later instead.
MAX_WAIT_SECONDS = int(float(os.environ.get("DISCOVER_MAX_WAIT_MINUTES", "120")) * 60)

MODES = ("ocr", "index", "reindex")


def _cli(rel_dir: str, *flags: str, label: str) -> Cmd:
    root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    abs_dir = os.path.join(status._load_config().BASE_PDF_PATH, rel_dir)  # noqa: SLF001
    return Cmd(
        [sys.executable, "-u", "scripts/discovery_cli.py", "discover", *flags, abs_dir] if flags[:1] == ("--cleanup",)
        else [sys.executable, "-u", "scripts/discovery_cli.py", "discover", *flags, "--process-folder", abs_dir,
              "--no-dry-run"],
        f"{label}: {rel_dir}",
        # PYTHONPATH: the script lives in scripts/, so the repo root isn't importable otherwise.
        # EMIT_PROGRESS_NOTES: makes the crawler print its "File 2/3 · sub-section 4/5" progress lines.
        env={"PYTHONPATH": root, "EMIT_PROGRESS_NOTES": "1"},
    )


def _crawl_cmd(d: str) -> Cmd:
    return _cli(d, "--crawl", "--skip-post-steps", label="crawl (OCR)")


def _index_cmd(d: str, force: bool = False, skip_post_steps: bool = False) -> Cmd:
    flags = ["--index"] + (["--force"] if force else []) + (["--skip-post-steps"] if skip_post_steps else [])
    return _cli(d, *flags, label="re-index" if force else "index")


def _ago(iso: Optional[str]) -> str:
    if not iso:
        return "?"
    from datetime import datetime, timezone
    secs = int((datetime.now(timezone.utc) - datetime.fromisoformat(iso)).total_seconds())
    return f"{secs // 3600}h {secs % 3600 // 60}m" if secs >= 3600 else f"{max(secs, 0) // 60}m"


def ocr_phase(ctx: StepCtx, folders: List[str]) -> int:
    """One crawl pass per folder that still has un-OCRed files. Batch OCR only submits here; the wait phase collects."""
    failed, submitted, done_now = [], 0, 0
    for i, d in enumerate(folders, 1):
        if ctx.cancelled:
            return 130
        if status.folder_snapshot(d)["not_indexed"] == 0:
            ctx.log(f"✓ {d}: OCR already complete, nothing to do.")
            continue
        ctx.progress(d, done=i - 1, total=len(folders), unit="folders")
        code = ctx.run(_crawl_cmd(d))
        if code != 0:
            failed.append(d)
            continue
        snap = status.folder_snapshot(d)
        if snap["not_indexed"] == 0:
            done_now += 1
        elif snap["batch_pending"] > 0:
            submitted += 1
        else:
            ctx.log(f"❌ {d}: {snap['not_indexed']} file(s) still without OCR and no LLM batch job is running for them.")
            failed.append(d)
    ctx.summary(f"OCR done in {done_now} folder(s), {submitted} submitted to LLM batch"
                + (f", {len(failed)} failed" if failed else ""))
    return 1 if failed else 0


def wait_phase(ctx: StepCtx, folders: List[str]) -> int:
    """Wait (once, for all folders) until LLM batch jobs finish, polling by re-running the crawl to collect them."""
    started = time.monotonic()

    def waiting() -> List[str]:
        out = []
        for d in folders:
            s = status.folder_snapshot(d)
            if s["not_indexed"] > 0 and s["batch_pending"] > 0:
                out.append(d)
        return out

    pending = waiting()
    if not pending:
        ctx.summary("No LLM batch jobs to wait for")
        return 0

    while True:
        if time.monotonic() - started > MAX_WAIT_SECONDS:
            ctx.log(f"⏳ Still waiting on {len(pending)} folder(s) after {MAX_WAIT_SECONDS // 60} min:")
            for d in pending:
                ctx.log(f"   - {d}")
            ctx.log("Come back later and click Discover again. It will collect the finished jobs and carry on.")
            ctx.summary(f"{len(pending)} folder(s) still waiting on LLM batch. Come back later and click Discover again.")
            return EXIT_WAITING

        ctx.progress("Waiting for LLM batch jobs", done=len(folders) - len(pending), total=len(folders), unit="folders OCRed")
        oldest = min((status.folder_snapshot(d)["oldest_batch_submitted_at"] or "") for d in pending) or None
        left = MAX_WAIT_SECONDS - int(time.monotonic() - started)
        ctx.log(f"⏳ {len(pending)} folder(s) waiting on LLM batch jobs (oldest submitted {_ago(oldest)} ago); checking again in {POLL_SECONDS}s.")
        remaining = POLL_SECONDS
        while remaining > 0:
            ctx.detail(f"{len(pending)} folder(s) waiting on LLM batch · submitted {_ago(oldest)} ago · "
                       f"next check {remaining // 60}m{remaining % 60:02d}s · gives up in {max(left, 0) // 60}m "
                       f"(jobs can take up to 24h)")
            if not ctx.sleep(min(5, remaining)):
                return 130
            remaining -= 5
            left -= 5

        for d in pending:
            if ctx.cancelled:
                return 130
            ctx.detail(f"Checking batch jobs: {d}")
            code = ctx.run(_crawl_cmd(d))
            if code != 0:
                return code
            snap = status.folder_snapshot(d)
            if snap["not_indexed"] > 0 and snap["batch_pending"] == 0:
                ctx.log(f"❌ {d}: OCR incomplete and no batch job is running any more (job failed or expired?). "
                        f"Click Discover again to resubmit.")
                ctx.summary(f"{d}: batch job ended without complete OCR")
                return 1
        pending = waiting()
        if not pending:
            ctx.summary("All LLM batch jobs finished")
            return 0


def index_phase(ctx: StepCtx, folders: List[str], force: bool = False) -> int:
    """Index folders whose OCR is complete. Others are left for the next Discover (reported as waiting)."""
    todo, not_ready = [], []
    for d in folders:
        s = status.folder_snapshot(d)
        if not force and s["not_indexed"] > 0:
            not_ready.append(d)
        elif force or s["pending"] > 0:
            todo.append(d)
        else:
            ctx.log(f"✓ {d}: already indexed.")

    failed = []
    for i, d in enumerate(todo, 1):
        if ctx.cancelled:
            return 130
        ctx.progress(d, done=i - 1, total=len(todo), unit="folders")
        # series refresh + catalogue rebuild only after the last folder, not after every one
        code = ctx.run(_index_cmd(d, force=force, skip_post_steps=i < len(todo)))
        if code != 0:
            failed.append(d)
        elif not force and status.folder_snapshot(d)["pending"] > 0:
            ctx.log(f"❌ {d}: some files are still not indexed after the index step; see the log above.")
            failed.append(d)

    parts = [f"{len(todo) - len(failed)} of {len(todo)} folder(s) {'re-indexed' if force else 'indexed'}"]
    if not_ready:
        parts.append(f"{len(not_ready)} not ready (OCR incomplete)")
        for d in not_ready:
            ctx.log(f"⏳ {d}: OCR not complete yet, skipped. Click Discover again later.")
    ctx.summary(", ".join(parts))
    if failed:
        return 1
    return EXIT_WAITING if not_ready else 0


def _resolve_targets(folders: Optional[List[str]], mode: str) -> List[str]:
    data = status.scan()
    runnable = {f["dir"]: f for c in data["categories"] for f in c["folders"] if f["runnable"]}
    if folders is None:
        if mode == "reindex":
            raise ValueError("Re-index needs explicit folders")
        key = "not_indexed" if mode == "ocr" else "pending"
        targets = [d for d, f in runnable.items() if (f["counts"]["not_indexed"] if key == "not_indexed" else f["pending"]) > 0]
    else:
        unknown = [d for d in folders if d not in runnable]
        if unknown:
            raise ValueError(f"Not a known scan_config folder: {', '.join(unknown)}")
        targets = list(dict.fromkeys(folders))
    if not targets:
        raise ValueError("Nothing to do: no folder has pending files")
    return targets


def start_discover(folders: Optional[List[str]], mode: str = "index") -> str:
    """Start a run over the given folders (relative dirs), or every folder with pending files if None."""
    if mode not in MODES:
        raise ValueError(f"Unknown mode: {mode}")
    targets = _resolve_targets(folders, mode)
    n = f"{len(targets)} folder{'s' if len(targets) != 1 else ''}"

    if mode == "reindex":
        specs = [StepSpec("index", f"Re-index ({n})", lambda ctx: index_phase(ctx, targets, force=True))]
    else:
        specs = [
            StepSpec("ocr", f"OCR ({n})", lambda ctx: ocr_phase(ctx, targets), continue_on_fail=True),
            StepSpec("wait", "Wait for LLM batch jobs", lambda ctx: wait_phase(ctx, targets), continue_on_fail=True),
        ]
        if mode == "index":
            specs.append(StepSpec("index", f"Index ({n})", lambda ctx: index_phase(ctx, targets)))

    verb = {"ocr": "OCR", "index": "Discover", "reindex": "Re-index"}[mode]
    label = f"{verb} {targets[0]}" if len(targets) == 1 else f"{verb} {n}"
    return runner.start("discover", label, specs, {"folders": targets, "mode": mode})


def start_cleanup(folder: str) -> str:
    """Remove a folder's OpenSearch documents and index state. Keeps the ocr/ and text/ folders."""
    data = status.scan()
    if folder not in {f["dir"] for c in data["categories"] for f in c["folders"] if f["runnable"]}:
        raise ValueError(f"Not a known scan_config folder: {folder}")
    spec = StepSpec("cleanup", f"Cleanup {folder}", lambda ctx: ctx.run(_cli(folder, "--cleanup", label="cleanup")))
    return runner.start("discover", f"Cleanup {folder}", [spec], {"folders": [folder], "mode": "cleanup"})
