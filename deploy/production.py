"""Read-only production health, separate from deployment jobs and Docker health."""
from datetime import datetime, timezone
import json
from pathlib import Path
import subprocess
import threading
import time

from deploy import settings


def _probe():
    result = {"host": settings.PROD_HOST, "reachable": False,
              "checked_at": datetime.now(timezone.utc).isoformat()}
    try:
        probe = Path(__file__).with_name("production_probe.py").read_text()
        proc = subprocess.run(["ssh", *settings.SSH_OPTS, settings.PROD_HOST, "python3 -"],
                              input=probe, capture_output=True, text=True, timeout=65)
        if proc.returncode:
            raise RuntimeError(proc.stderr.strip()[:500] or "Production probe failed")
        payload = json.loads(proc.stdout)
        if not isinstance(payload, dict) or not all(key in payload for key in ("system", "updates", "certificates", "renewal", "endpoints")):
            raise ValueError("Invalid production probe response")
        result.update(payload, reachable=True)
    except (OSError, subprocess.SubprocessError, ValueError, RuntimeError) as exc:
        result["error"] = str(exc)[:500]
    return result


_lock = threading.Lock()
_cached = None
_cached_at = 0


def forget():
    global _cached_at
    with _lock:
        _cached_at = 0


def status(fresh=False):
    global _cached, _cached_at
    # One SSH probe shared by the top bar and Production page.
    with _lock:
        if not fresh and _cached is not None and time.monotonic() - _cached_at < 60:
            return _cached
        _cached = _probe()
        _cached_at = time.monotonic()
        return _cached
