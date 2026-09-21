"""Is Docker (OrbStack) answering? Green / yellow / red, from how fast `docker ps` responds.

Docker on this machine sometimes gets stuck: `docker ps` takes ten seconds or never returns, and only restarting
OrbStack helps. Yellow and red therefore both mean "don't start anything that needs Docker".
"""
import subprocess
import threading
import time
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from deploy import settings

OK, SLOW, DOWN = "ok", "slow", "down"
_CACHE_SECONDS = 5.0

_lock = threading.Lock()          # one probe at a time: a stuck `docker ps` must not pile up behind every request
_last: Optional[Dict[str, Any]] = None
_last_at = 0.0


class DockerUnhealthy(Exception):
    """Docker is yellow or red, so the requested job was not started."""


def check() -> Dict[str, Any]:
    """Runs `docker ps` once, with a time limit (the child is killed when it does not answer)."""
    started = time.monotonic()
    result: Dict[str, Any] = {"checked_at": datetime.now(timezone.utc).isoformat(timespec="seconds")}
    try:
        proc = subprocess.run(["docker", "ps", "-q"], capture_output=True, text=True, timeout=settings.DOCKER_TIMEOUT_SECONDS)
    except FileNotFoundError:
        return {**result, "status": DOWN, "seconds": None, "message": "The docker command was not found on this machine."}
    except subprocess.TimeoutExpired:
        return {**result, "status": DOWN, "seconds": round(time.monotonic() - started, 1),
                "message": f"docker ps did not answer within {settings.DOCKER_TIMEOUT_SECONDS:g}s. Docker is stuck."}
    seconds = round(time.monotonic() - started, 1)
    if proc.returncode != 0:
        return {**result, "status": DOWN, "seconds": seconds,
                "message": (proc.stderr or "docker ps failed").strip().splitlines()[-1][:200]}
    if seconds >= settings.DOCKER_SLOW_SECONDS:
        return {**result, "status": SLOW, "seconds": seconds, "message": f"docker ps took {seconds:g}s. Docker is struggling."}
    return {**result, "status": OK, "seconds": seconds, "message": f"docker ps answers in {seconds:g}s."}


def get(fresh: bool = False) -> Dict[str, Any]:
    """The latest result; probes again when it is older than a few seconds (or `fresh`). Never runs two probes at once."""
    global _last, _last_at
    if not fresh and _last is not None and time.monotonic() - _last_at < _CACHE_SECONDS:
        return _last
    if not _lock.acquire(blocking=False):
        # a probe is already running (possibly a stuck one): report what we knew, or that we are still finding out
        return _last or {"status": "checking", "seconds": None, "message": "Checking Docker…", "checked_at": None}
    try:
        _last = check()
        _last_at = time.monotonic()
        return _last
    finally:
        _lock.release()


def require_healthy() -> None:
    """Called before starting a job that needs Docker. Raises DockerUnhealthy unless Docker is green right now."""
    result = get(fresh=True)
    if result["status"] == OK:
        return
    what = {SLOW: "is slow", DOWN: "is not responding"}.get(result["status"], "has not been checked yet")
    raise DockerUnhealthy(f"Docker {what}. {result['message']} Restart it from the Docker light at the top, then try again.")


def forget() -> None:
    """Drops the cached result (after a restart, so the next look is a real one)."""
    global _last, _last_at
    _last, _last_at = None, 0.0
