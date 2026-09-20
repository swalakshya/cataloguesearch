"""Generic job runner: one job at a time (deploy, discover, ...), each a list of steps.

A step is a callable that gets a StepCtx and returns an exit code (0 = success). Steps usually
shell out via ctx.run(Cmd(...)); output goes to the step's log file, and the latest progress
line is mirrored into the DB so the UI can show live status without tailing the whole log.

Only one job runs at a time across *all* kinds: deploy snapshots stop OpenSearch, so it must
never overlap with indexing.
"""
import json
import logging
import os
import re
import signal
import subprocess
import threading
import time
import traceback
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Dict, List, Optional

from deploy import db, progress, settings

log = logging.getLogger(__name__)


@dataclass
class Cmd:
    argv: List[str]
    label: str
    stdin_path: Optional[Path] = None
    cwd: Optional[Path] = None
    env: Optional[Dict[str, str]] = None  # extra environment variables, on top of the server's
    # optional tool-specific progress parser (e.g. progress.DockerBuildProgress()): feed(line) -> progress update
    progress_parser: Optional[object] = None


# A step returns this when it is incomplete but not broken (e.g. an LLM batch job that is still running):
# shown as "waiting", it doesn't stop the run, and the run ends as "waiting" rather than "succeeded".
EXIT_WAITING = 75


@dataclass
class StepSpec:
    name: str                       # unique within the run; also the log file name
    title: str                      # shown in the UI
    fn: Callable[["StepCtx"], int]  # returns an exit code, 0 = success
    continue_on_fail: bool = False  # keep running later steps even if this one fails (the run still ends "failed")


def log_path(run_id: str, step: str) -> Path:
    return settings.DATA_DIR / "runs" / run_id / f"{step}.log"


class Busy(Exception):
    pass


_SEGMENT_END = re.compile(rb"[\r\n]")
_PROGRESS_LINE = re.compile(r"Step\s+\d+|^#\d+\s|✅|❌|🔄|pushing|pushed|%", re.IGNORECASE)


def _proc_start(pid: int) -> Optional[str]:
    """Process start time as ps reports it. Identifies a process across PID reuse. None if gone (or a zombie)."""
    try:
        out = subprocess.run(["ps", "-o", "stat=,lstart=", "-p", str(pid)], capture_output=True, text=True, timeout=5)
    except (OSError, subprocess.SubprocessError):
        return None
    parts = out.stdout.strip().split(None, 1)
    if len(parts) < 2 or parts[0].startswith("Z"):  # a zombie is already dead; it only lingers until its parent reaps it
        return None
    return parts[1]


def reap_orphans() -> None:
    """Kill process groups left behind by a previous server process (crash or --reload restart).

    Steps run in their own session, so they outlive the server. Left alone they would keep
    running untracked and clash with the next run. Only a group whose leader still has the
    recorded start time is killed, so a reused PID is never touched.
    """
    for row in db.orphan_candidates():
        pgid, pstart = row["pgid"], row["pstart"]
        if not pgid or not pstart or _proc_start(pgid) != pstart:
            continue
        log.warning("Killing orphaned job process group %s (run %s, step %s)", pgid, row["run_id"], row["name"])
        try:
            os.killpg(pgid, signal.SIGTERM)
        except (ProcessLookupError, PermissionError):
            continue
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline and _proc_start(pgid) == pstart:
            time.sleep(0.25)
        if _proc_start(pgid) == pstart:
            try:
                os.killpg(pgid, signal.SIGKILL)
            except (ProcessLookupError, PermissionError):
                pass


def startup() -> None:
    """Call once when the server starts."""
    db.init_db()
    reap_orphans()
    db.mark_interrupted()


class _Run:
    def __init__(self, run_id: str, specs: List[StepSpec]):
        self.id = run_id
        self.specs = specs
        self.cancel_event = threading.Event()
        self.proc: Optional[subprocess.Popen] = None
        self.progress: Dict[str, Dict] = {}  # step name -> {"phase": {...}, "sub": {...}}


class StepCtx:
    """What a step function can do: run commands, log, report progress, wait (cancel-aware)."""

    def __init__(self, run: _Run, step: str, out, runner: "Runner"):
        self._run, self.step, self._out, self._runner = run, step, out, runner
        self.final_detail: Optional[str] = None

    @property
    def run_id(self) -> str:
        return self._run.id

    @property
    def cancelled(self) -> bool:
        return self._run.cancel_event.is_set()

    def log(self, line: str) -> None:
        self._out.write(line.encode("utf-8", "replace") + b"\n")

    def detail(self, text: str) -> None:
        db.update_step(self._run.id, self.step, detail=text[:200])

    def progress(self, label: str, done: Optional[float] = None, total: Optional[float] = None,
                 unit: Optional[str] = None, index: Optional[int] = None, of: Optional[int] = None,
                 items: Optional[list] = None) -> None:
        """Where the step is now ("folder 2 of 5"). Clears the previous phase's live detail.

        `items` is an optional checklist, [{"name", "state", "note"?}, ...], so the UI can show what each folder is doing.
        """
        self._runner._set_progress(self._run, self.step, phase={
            k: v for k, v in dict(label=label, done=done, total=total, unit=unit, index=index, of=of, items=items).items()
            if v is not None}, reset_sub=True)

    def summary(self, text: str) -> None:
        """One-line outcome shown on the step once it ends (instead of the generic "Done")."""
        self.final_detail = text[:200]

    def sleep(self, seconds: float) -> bool:
        """Wait, waking early on cancel. Returns False if the run was cancelled."""
        return not self._run.cancel_event.wait(seconds)

    def run(self, cmd: Cmd) -> int:
        return self._runner._run_cmd(self._run, self.step, cmd, self._out)


class Runner:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._active: Optional[_Run] = None

    def active_run_id(self) -> Optional[str]:
        with self._lock:
            return self._active.id if self._active else None

    def start(self, kind: str, label: str, specs: List[StepSpec], params: Dict) -> str:
        if not specs:
            raise ValueError("Nothing to run")
        with self._lock:
            if self._active:
                raise Busy(self._active.id)
            run_id = uuid.uuid4().hex[:12]
            db.create_run(run_id, kind, label, [(s.name, s.title) for s in specs], params)
            run = _Run(run_id, specs)
            self._active = run
        threading.Thread(target=self._execute, args=(run,), daemon=True, name=f"job-{run_id}").start()
        return run_id

    def cancel(self, run_id: str) -> bool:
        with self._lock:
            run = self._active
            if not run or run.id != run_id:
                return False
            run.cancel_event.set()
            proc = run.proc
        if proc and proc.poll() is None:
            self._terminate(proc)
        return True

    def shutdown(self) -> None:
        """Server is stopping: don't leave the running step behind as an orphan."""
        with self._lock:
            run = self._active
            if not run:
                return
            run.cancel_event.set()
            proc = run.proc
        if proc and proc.poll() is None:
            self._terminate(proc)

    @staticmethod
    def _terminate(proc: subprocess.Popen) -> None:
        try:
            os.killpg(proc.pid, signal.SIGTERM)
        except ProcessLookupError:
            return

        def _kill_later():
            time.sleep(10)
            if proc.poll() is None:
                try:
                    os.killpg(proc.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
        threading.Thread(target=_kill_later, daemon=True).start()

    def _execute(self, run: _Run) -> None:
        final = "succeeded"
        try:
            stopped = False
            for spec in run.specs:
                if stopped or run.cancel_event.is_set():
                    db.update_step(run.id, spec.name, status="skipped")
                    stopped = True
                    continue
                status = self._run_step(run, spec)
                if status == "waiting":
                    if final == "succeeded":
                        final = "waiting"
                elif status != "succeeded":
                    final = "cancelled" if status == "cancelled" else "failed"
                    if status == "cancelled" or not spec.continue_on_fail:
                        stopped = True
            if run.cancel_event.is_set() and final in ("succeeded", "waiting"):
                final = "cancelled"
        except Exception:  # noqa: BLE001 - never leave a run stuck in "running"
            log.exception("Job run %s crashed", run.id)
            final = "failed"
            current = db.get_run(run.id)
            for step in (current["steps"] if current else []):
                if step["status"] == "running":
                    db.update_step(run.id, step["name"], status="failed", finished_at=db.now(),
                                   detail="Internal error, see server log")
                elif step["status"] == "pending":
                    db.update_step(run.id, step["name"], status="skipped")
        finally:
            db.finish_run(run.id, final)
            with self._lock:
                self._active = None

    def _run_step(self, run: _Run, spec: StepSpec) -> str:
        path = log_path(run.id, spec.name)
        path.parent.mkdir(parents=True, exist_ok=True)
        db.update_step(run.id, spec.name, status="running", started_at=db.now(), detail="Starting…")
        with open(path, "ab", buffering=0) as out:
            ctx = StepCtx(run, spec.name, out, self)
            try:
                exit_code = spec.fn(ctx)
            except Exception:  # noqa: BLE001 - a buggy step fails, it doesn't take the run down
                ctx.log(traceback.format_exc())
                exit_code = 1
        if run.cancel_event.is_set():
            status = "cancelled"
        elif exit_code == 0:
            status = "succeeded"
        elif exit_code == EXIT_WAITING:
            status = "waiting"
        else:
            status = "failed"
        detail = ctx.final_detail or {"succeeded": "Done", "cancelled": "Cancelled", "waiting": "Waiting",
                                       "failed": f"Failed (exit {exit_code})"}[status]
        if status == "failed" and ctx.final_detail:
            detail = f"{ctx.final_detail} (exit {exit_code})"[:200]
        db.update_step(run.id, spec.name, status=status, exit_code=exit_code, finished_at=db.now(), detail=detail)
        return status

    @staticmethod
    def _set_progress(run: _Run, step: str, phase: Optional[Dict] = None, sub: Optional[Dict] = None,
                      reset_sub: bool = False) -> None:
        cur = run.progress.setdefault(step, {"phase": None, "sub": None})
        if phase is not None:
            cur["phase"] = {**(cur["phase"] or {}), **phase} if not reset_sub else phase
        if reset_sub:
            cur["sub"] = None
        if sub is not None:
            cur["sub"] = sub
        db.update_step(run.id, step, progress=json.dumps(cur))

    def _run_cmd(self, run: _Run, step: str, cmd: Cmd, out) -> int:
        def write(line: str) -> None:
            out.write(line.encode("utf-8", "replace") + b"\n")

        cwd = cmd.cwd or settings.REPO_ROOT
        write(f"$ (cd {cwd}) {' '.join(cmd.argv)}")
        stdin = open(cmd.stdin_path, "rb") if cmd.stdin_path else subprocess.DEVNULL
        try:
            proc = subprocess.Popen(
                cmd.argv, cwd=cwd, stdin=stdin, stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT, start_new_session=True, bufsize=0,
                env={**os.environ, **cmd.env} if cmd.env else None)
        except OSError as exc:
            write(f"Failed to start: {exc}")
            return 127
        finally:
            if cmd.stdin_path:
                stdin.close()
        run.proc = proc
        db.update_step(run.id, step, pgid=proc.pid, pstart=_proc_start(proc.pid))
        if run.cancel_event.is_set():  # cancel raced with process start
            self._terminate(proc)

        last_detail_write = 0.0
        last_progress_log = 0.0
        buf = b""
        while True:
            chunk = proc.stdout.read(4096)
            if not chunk:
                break
            buf += chunk
            while True:
                m = _SEGMENT_END.search(buf)
                if not m:
                    break
                segment, term, buf = buf[:m.start()], buf[m.start():m.end()], buf[m.end():]
                text = segment.decode("utf-8", "replace").rstrip()
                if not text:
                    continue
                # 1. our own scripts' structured markers: authoritative, never logged
                marker = progress.parse_marker(text)
                if marker is not None:
                    if set(marker) == {"note"}:  # one-line "which file/sub-section": keeps the phase + live bar
                        self._set_progress(run, step, phase=marker)
                        continue
                    sub = marker.pop("sub", None)
                    self._set_progress(run, step, phase=marker, sub=sub, reset_sub=sub is None)
                    continue
                # 2. tool-specific parser (docker build)
                if cmd.progress_parser is not None and term == b"\n":
                    update = cmd.progress_parser.feed(text)
                    if update:
                        self._set_progress(run, step, **update)
                # 3. "\r"-terminated segments are in-place progress bars (pv, tqdm): show, don't log
                if term == b"\n":
                    out.write(text.encode("utf-8", "replace") + b"\n")
                if term == b"\r":
                    ts = time.monotonic()
                    if ts - last_detail_write > 0.5:
                        bar = progress.parse_bar(text)
                        if bar:
                            self._set_progress(run, step, sub=bar)
                        else:
                            db.update_step(run.id, step, detail=text[:200])
                        last_detail_write = ts
                    # keep a sparse trail in the log so it isn't empty during a long transfer
                    if ts - last_progress_log > 15:
                        out.write(b"  \xe2\x86\xb3 " + text.encode("utf-8", "replace") + b"\n")
                        last_progress_log = ts
                elif _PROGRESS_LINE.search(text):
                    ts = time.monotonic()
                    if ts - last_detail_write > 0.5:
                        db.update_step(run.id, step, detail=text[:200])
                        last_detail_write = ts
        if buf.strip():
            out.write(buf.rstrip() + b"\n")
        proc.wait()
        run.proc = None
        write(f"[exit {proc.returncode}] {cmd.label}")
        db.update_step(run.id, step, pgid=None, pstart=None)
        return proc.returncode


runner = Runner()
