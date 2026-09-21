"""Garbage collection for the Deploy page's "Clean up" tab: what can be reclaimed on a machine, and cleaning it.

Docker numbers and pruning go through the Docker Engine API (the same API the CLI uses), so sizes are exact and
structured. The dev machine is reached through its unix socket, prod through `ssh` + `curl` on the same socket.
Cleaning runs as a job (kind "gc"), so it can never overlap a build, snapshot or restore.

Never touched here: volumes. They can hold OpenSearch's data, so they are listed for information only.
"""
import http.client
import json
import logging
import os
import re
import shlex
import shutil
import socket
import subprocess
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import quote

import yaml

from deploy import settings
from deploy.runner import StepCtx, StepSpec, runner

log = logging.getLogger(__name__)

DOCKER_SOCKET = "/var/run/docker.sock"
TARGETS = ("local", "prod")
CACHE_AGE_DAYS = 7
_PREDEFINED_NETWORKS = {"bridge", "host", "none"}

# id -> what it is. `safe` categories are what "Clean all safe" runs; the others are opt-in and need a confirmation.
CATEGORIES: Dict[str, Dict[str, Any]] = {
    "dangling_images": dict(
        title="Dangling images", safe=True,
        description="Untagged image layers left behind by rebuilds and pulls. Nothing uses them."),
    "build_cache": dict(
        title="Build cache", safe=True,
        description="Layers Docker keeps to make builds faster. Clearing it only makes the next build slower."),
    "stopped_containers": dict(
        title="Stopped containers", safe=True,
        description="Containers that have exited. Their logs go with them; compose recreates the ones you use."),
    "unused_networks": dict(
        title="Unused networks", safe=True,
        description="Networks no container is attached to."),
    "unused_images": dict(
        title="Unused tagged images", safe=False,
        description="Tagged images no container uses, such as base images or images built only to push. Images your "
                    "compose files name (api, frontend, opensearch, chat) are always kept."),
    "snapshot_files": dict(
        title="Snapshot files", safe=False,
        description="The snapshots folder and tarball from 'Copy snapshots to prod'. The next deploy recreates them; "
                    "without them a restore cannot be re-run until then."),
}
CACHE_VARIANTS = {
    "older": f"Older than {CACHE_AGE_DAYS} days",
    "all": "All",
}


class EngineError(Exception):
    """The machine (or its Docker) could not be reached or refused."""


def fmt_bytes(n: float) -> str:
    n = float(n or 0)
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if abs(n) < 1000 or unit == "TB":
            return f"{n:.0f} {unit}" if unit == "B" else f"{n:.1f} {unit}"
        n /= 1000
    return f"{n:.1f} TB"


# --------------------------------------------------------------------------------------- transports

class _UnixConnection(http.client.HTTPConnection):
    def __init__(self, path: str, timeout: float):
        super().__init__("localhost", timeout=timeout)
        self._path = path

    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(self.timeout)
        self.sock.connect(self._path)


class LocalEngine:
    """The Docker on the machine running the dev server."""
    local = True
    label = "This machine"

    def request(self, method: str, path: str, timeout: float = 900) -> Any:
        if not os.path.exists(DOCKER_SOCKET):
            raise EngineError("Docker isn't reachable on this machine. Is OrbStack / Docker running?")
        conn = _UnixConnection(DOCKER_SOCKET, timeout)
        try:
            conn.request(method, path)
            resp = conn.getresponse()
            raw = resp.read().decode("utf-8", "replace")
        except OSError as exc:
            raise EngineError(f"Docker didn't answer: {exc}") from exc
        finally:
            conn.close()
        return _parse(resp.status, raw, path)

    def shell(self, script: str, timeout: float = 600) -> str:
        proc = subprocess.run(["sh", "-c", script], capture_output=True, text=True, timeout=timeout)
        return proc.stdout


class RemoteEngine:
    """The Docker on prod, over ssh (curl talking to its socket; nothing to install there)."""

    local = False

    def __init__(self, host: str):
        self.host = host
        self.label = f"Prod ({host})"

    def _ssh(self, remote_cmd: str, timeout: float) -> subprocess.CompletedProcess:
        try:
            return subprocess.run(["ssh", *settings.SSH_OPTS, self.host, remote_cmd],
                                  capture_output=True, text=True, timeout=timeout)
        except subprocess.TimeoutExpired as exc:
            raise EngineError(f"{self.host} didn't answer in time") from exc

    def request(self, method: str, path: str, timeout: float = 900) -> Any:
        url = shlex.quote(f"http://localhost{path}")
        proc = self._ssh(f"curl -s --unix-socket {DOCKER_SOCKET} -X {method} -w '\\n%{{http_code}}' {url}", timeout)
        if proc.returncode != 0:
            raise EngineError(f"Could not reach {self.host}: {(proc.stderr or 'ssh failed').strip()[:200]}")
        body, _, code = proc.stdout.rpartition("\n")
        try:
            status = int(code.strip())
        except ValueError as exc:
            raise EngineError(f"Unexpected reply from {self.host}") from exc
        return _parse(status, body, path)

    def shell(self, script: str, timeout: float = 600) -> str:
        proc = self._ssh(script, timeout)
        if proc.returncode not in (0, 1):  # du/find exit 1 on missing globs, which is fine here
            raise EngineError(f"{self.host}: {(proc.stderr or 'command failed').strip()[:200]}")
        return proc.stdout


def _parse(status: int, raw: str, path: str) -> Any:
    try:
        data = json.loads(raw) if raw.strip() else {}
    except ValueError:
        data = {"message": raw.strip()[:200]}
    if not 200 <= status < 300:
        message = data.get("message") if isinstance(data, dict) else None
        raise EngineError(f"Docker refused {path.split('?')[0]} (HTTP {status}): {message or 'no details'}")
    return data


def engine_for(target: str):
    if target == "local":
        return LocalEngine()
    if target == "prod":
        return RemoteEngine(settings.PROD_HOST)
    raise ValueError(f"Unknown target: {target}")


# --------------------------------------------------------------------------------------- protected images

_ENV_REF = re.compile(r"\$\{([A-Za-z_][A-Za-z0-9_]*)(?::?-([^}]*))?\}")


def _normalise_ref(ref: str) -> Optional[str]:
    """An image reference as Docker lists it in RepoTags: no registry prefix for Docker Hub, an explicit tag."""
    def expand(m):
        value = os.environ.get(m.group(1))
        return value if value else (m.group(2) if m.group(2) is not None else "\0")
    ref = _ENV_REF.sub(expand, ref or "").strip()
    if not ref or "\0" in ref or "$" in ref:
        return None  # depends on a variable we can't resolve: don't guess
    for prefix in ("docker.io/", "index.docker.io/"):
        if ref.startswith(prefix):
            ref = ref[len(prefix):]
    if ref.startswith("library/"):
        ref = ref[len("library/"):]
    last = ref.rsplit("/", 1)[-1]
    if "@" not in last and ":" not in last:
        ref += ":latest"
    return ref


def _compose_files() -> List[Path]:
    files: List[Path] = []
    for folder in (settings.REPO_ROOT, settings.CHAT_REPO_DIR):
        if folder and Path(folder).is_dir():
            files += sorted(Path(folder).glob("docker-compose*.yml"))
    return files


def protected_images() -> set:
    """Images that are never removed: every `image:` named in the compose files (this repo and the chat repo, dev and
    prod), so the current api / frontend / opensearch / chat builds survive even when their containers are stopped.

    Read from the files, so there is no second list to keep in sync; commented-out services are ignored (YAML). Extra
    references can be added with DEPLOY_PROTECTED_IMAGES (comma-separated).
    """
    refs = set()
    for path in _compose_files():
        try:
            doc = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        except (OSError, yaml.YAMLError) as exc:
            log.warning("Could not read %s for protected images: %s", path, exc)
            continue
        for svc in (doc.get("services") or {}).values():
            ref = _normalise_ref(svc.get("image", "")) if isinstance(svc, dict) else None
            if ref:
                refs.add(ref)
    for extra in filter(None, (e.strip() for e in os.environ.get("DEPLOY_PROTECTED_IMAGES", "").split(","))):
        ref = _normalise_ref(extra)
        if ref:
            refs.add(ref)
    return refs


def _is_protected(image: dict, protected: set) -> bool:
    return any(tag in protected for tag in _tags(image))


def _unused_tagged(images: List[dict]) -> List[dict]:
    return [i for i in images if _tags(i) and i.get("Containers") == 0]


# --------------------------------------------------------------------------------------- scanning

def _tags(image: dict) -> List[str]:
    return [t for t in (image.get("RepoTags") or []) if t and t != "<none>:<none>"]


def _unique_size(image: dict) -> int:
    """What removing this image would free: its size minus layers shared with other images.

    Never sum the plain `Size` of several images: shared layers are counted once per image (prod's 108 dangling
    images list 86GB but hold 6.5GB). This matches the RECLAIMABLE column of `docker system df`.
    """
    size = int(image.get("Size") or 0)
    shared = int(image.get("SharedSize") or 0)
    return max(size - max(shared, 0), 0)


def _image_name(image: dict) -> str:
    tags = _tags(image)
    return tags[0] if tags else f"<untagged> {str(image.get('Id', ''))[7:19]}"


def _top(items: List[dict], limit: int = 12) -> List[dict]:
    return sorted(items, key=lambda i: i.get("size", 0), reverse=True)[:limit]


def _parse_time(value: Optional[str]) -> Optional[datetime]:
    if not value or value.startswith("0001-"):
        return None
    try:
        # Docker sends nanoseconds; datetime takes microseconds
        head, _, tail = value.rstrip("Z").partition(".")
        frac = tail.split("+")[0].split("-")[0][:6]
        return datetime.fromisoformat(f"{head}.{frac}" if frac else head).replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def _category(cat_id: str, **fields: Any) -> Dict[str, Any]:
    meta = CATEGORIES[cat_id]
    return {"id": cat_id, "title": meta["title"], "description": meta["description"], "safe": meta["safe"], **fields}


def _snapshot_paths_local() -> List[Path]:
    root = settings.REPO_ROOT
    return [root / "snapshots", *sorted(root.glob("snapshots_*.tar.zst"))]


def _size_of(path: Path) -> int:
    if path.is_file():
        return path.stat().st_size
    return sum(f.stat().st_size for f in path.rglob("*") if f.is_file())


def _snapshot_items(engine) -> List[dict]:
    if getattr(engine, "local", False):
        return [{"name": p.name + ("/" if p.is_dir() else ""), "size": _size_of(p)} for p in _snapshot_paths_local() if p.exists()]
    out = engine.shell(f"cd {settings.PROD_DIR} 2>/dev/null && du -sb snapshots snapshot*.tar.zst 2>/dev/null")
    items = []
    for line in out.splitlines():
        size, _, name = line.partition("\t")
        if size.strip().isdigit() and name:
            items.append({"name": name + ("/" if name == "snapshots" else ""), "size": int(size)})
    return items


def scan(target: str, engine=None) -> Dict[str, Any]:
    """Everything reclaimable on `target`, with sizes. Read-only."""
    engine = engine or engine_for(target)
    df = engine.request("GET", "/system/df") or {}
    images = df.get("Images") or []
    cats: List[Dict[str, Any]] = []

    dangling = [i for i in images if not _tags(i) and i.get("Containers") == 0]
    cats.append(_category(
        "dangling_images", count=len(dangling), size=sum(_unique_size(i) for i in dangling),
        reclaimable=sum(_unique_size(i) for i in dangling),
        items=_top([{"name": _image_name(i), "size": _unique_size(i)} for i in dangling])))

    cache = [b for b in (df.get("BuildCache") or []) if not b.get("InUse")]
    cutoff = datetime.now(timezone.utc) - timedelta(days=CACHE_AGE_DAYS)
    older = [b for b in cache if (_parse_time(b.get("LastUsedAt")) or _parse_time(b.get("CreatedAt")) or cutoff) <= cutoff]
    cats.append(_category(
        "build_cache", count=len(cache), size=sum(int(b.get("Size") or 0) for b in cache),
        reclaimable=sum(int(b.get("Size") or 0) for b in cache),
        variants=[
            {"id": "older", "label": CACHE_VARIANTS["older"], "count": len(older), "reclaimable": sum(int(b.get("Size") or 0) for b in older)},
            {"id": "all", "label": CACHE_VARIANTS["all"], "count": len(cache), "reclaimable": sum(int(b.get("Size") or 0) for b in cache)},
        ],
        items=_top([{"name": (b.get("Description") or b.get("Type") or b.get("ID", ""))[:70], "size": int(b.get("Size") or 0)} for b in cache], 8)))

    stopped = [c for c in (df.get("Containers") or []) if c.get("State") not in ("running", "restarting")]
    cats.append(_category(
        "stopped_containers", count=len(stopped), size=sum(int(c.get("SizeRw") or 0) for c in stopped),
        reclaimable=sum(int(c.get("SizeRw") or 0) for c in stopped),
        items=_top([{"name": (c.get("Names") or ["?"])[0].lstrip("/"), "size": int(c.get("SizeRw") or 0), "note": c.get("State")} for c in stopped])))

    filt = quote(json.dumps({"dangling": ["true"]}))
    networks = [n for n in (engine.request("GET", f"/networks?filters={filt}") or []) if n.get("Name") not in _PREDEFINED_NETWORKS]
    cats.append(_category("unused_networks", count=len(networks), size=None, reclaimable=0,
                          items=[{"name": n.get("Name", "?"), "size": 0} for n in networks[:12]]))

    protected = protected_images()
    unused_all = _unused_tagged(images)
    unused = [i for i in unused_all if not _is_protected(i, protected)]
    kept = [i for i in unused_all if _is_protected(i, protected)]
    cats.append(_category(
        "unused_images", count=len(unused), size=sum(_unique_size(i) for i in unused),
        reclaimable=sum(_unique_size(i) for i in unused),
        items=_top([{"name": _image_name(i), "size": _unique_size(i)} for i in unused]),
        # named in a compose file: never removed, shown so you can see what is being spared
        protected={"count": len(kept), "size": sum(_unique_size(i) for i in kept),
                   "items": _top([{"name": _image_name(i), "size": _unique_size(i), "note": "kept"} for i in kept])}))

    snaps = _snapshot_items(engine)
    cats.append(_category("snapshot_files", count=len(snaps), size=sum(s["size"] for s in snaps),
                          reclaimable=sum(s["size"] for s in snaps), items=snaps))

    volumes = df.get("Volumes") or []
    unused_vols = [v for v in volumes if (v.get("UsageData") or {}).get("RefCount") == 0]
    return {
        "target": target,
        "label": engine.label,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "categories": cats,
        "totals": {
            "safe": sum(c["reclaimable"] for c in cats if c["safe"]),
            "optional": sum(c["reclaimable"] for c in cats if not c["safe"]),
        },
        # Listed for information only: never cleaned here, because they can hold data (OpenSearch lives in one).
        "volumes": {
            "count": len(volumes), "unused": len(unused_vols),
            "unused_size": sum(max(int((v.get("UsageData") or {}).get("Size") or 0), 0) for v in unused_vols),
            "items": _top([{"name": v.get("Name", "?"), "size": max(int((v.get("UsageData") or {}).get("Size") or 0), 0),
                            "note": "in use" if (v.get("UsageData") or {}).get("RefCount") else "unused"} for v in volumes]),
        },
    }


# --------------------------------------------------------------------------------------- cleaning

def _filters(**kv: Any) -> str:
    return quote(json.dumps({k: [str(v)] for k, v in kv.items()}))


def _clear_snapshot_files(engine) -> Dict[str, Any]:
    """Delete the snapshot folder's *contents* (the folder itself may be bind-mounted into OpenSearch) and the tarballs."""
    before = sum(i["size"] for i in _snapshot_items(engine))
    if getattr(engine, "local", False):
        for path in _snapshot_paths_local():
            if path.is_dir():
                for child in path.iterdir():
                    shutil.rmtree(child) if child.is_dir() and not child.is_symlink() else child.unlink()
            elif path.exists():
                path.unlink()
    else:
        engine.shell(f"cd {settings.PROD_DIR} && find snapshots -mindepth 1 -delete 2>/dev/null; rm -f snapshots_*.tar.zst snapshot.tar.zst")
    return {"reclaimed": before, "detail": None}


def _remove_unused_images(engine) -> Dict[str, Any]:
    """Remove unused tagged images one by one, never the protected ones.

    Docker's blanket prune (`dangling=false`) has no way to exclude names, so the list is worked out here, from a fresh
    scan (an image that started being used since you looked is skipped), and each image is removed by its tag(s).
    The amount freed is measured from Docker's total layer size before and after, so shared layers are counted right.
    """
    before = engine.request("GET", "/system/df") or {}
    protected = protected_images()
    removable = [i for i in _unused_tagged(before.get("Images") or []) if not _is_protected(i, protected)]
    removed = failed = 0
    estimate = 0
    for image in removable:
        try:
            for tag in _tags(image):
                engine.request("DELETE", f"/images/{quote(tag, safe='/:')}?noprune=false")
            removed += 1
            estimate += _unique_size(image)
        except EngineError as exc:
            failed += 1
            log.warning("Kept %s: %s", _image_name(image), exc)
    after = engine.request("GET", "/system/df") or {}
    measured = int(before.get("LayersSize") or 0) - int(after.get("LayersSize") or 0)
    kept = len(_unused_tagged(before.get("Images") or [])) - len(removable)
    parts = [f"{removed} removed"]
    if failed:
        parts.append(f"{failed} couldn't be removed")
    if kept:
        parts.append(f"{kept} protected kept")
    return {"reclaimed": measured if measured > 0 else estimate, "detail": ", ".join(parts)}


def prune(target: str, cat_id: str, variant: Optional[str] = None, engine=None) -> Dict[str, Any]:
    """Clean one category. Returns {"reclaimed": bytes, "detail": str|None}."""
    engine = engine or engine_for(target)
    if cat_id == "snapshot_files":
        return _clear_snapshot_files(engine)
    if cat_id == "dangling_images":
        res = engine.request("POST", f"/images/prune?filters={_filters(dangling='true')}")
        deleted = len(res.get("ImagesDeleted") or [])
    elif cat_id == "unused_images":
        return _remove_unused_images(engine)
    elif cat_id == "build_cache":
        older = variant == "older"
        res = engine.request("POST", "/build/prune?all=true" + (f"&filters={_filters(until=f'{CACHE_AGE_DAYS * 24}h')}" if older else ""))
        deleted = len(res.get("CachesDeleted") or [])
    elif cat_id == "stopped_containers":
        res = engine.request("POST", "/containers/prune")
        deleted = len(res.get("ContainersDeleted") or [])
    elif cat_id == "unused_networks":
        res = engine.request("POST", "/networks/prune")
        deleted = len(res.get("NetworksDeleted") or [])
    else:
        raise ValueError(f"Unknown category: {cat_id}")
    return {"reclaimed": int(res.get("SpaceReclaimed") or 0), "detail": f"{deleted} removed"}


# --------------------------------------------------------------------------------------- jobs

def normalise(target: str, selections: List[Dict[str, Any]], confirm: bool) -> List[Dict[str, Optional[str]]]:
    """Validate a request. Optional (not-safe) categories, and anything on prod, need `confirm`."""
    if target not in TARGETS:
        raise ValueError(f"Unknown target: {target}")
    out: List[Dict[str, Optional[str]]] = []
    seen = set()
    for sel in selections:
        cat_id, variant = sel.get("id"), sel.get("variant")
        if cat_id not in CATEGORIES:
            raise ValueError(f"Unknown category: {cat_id}")
        if variant is not None and not (cat_id == "build_cache" and variant in CACHE_VARIANTS):
            raise ValueError(f"'{variant}' is not an option for {cat_id}")
        if cat_id in seen:
            continue
        seen.add(cat_id)
        out.append({"id": cat_id, "variant": (variant or "all") if cat_id == "build_cache" else None})
    if not out:
        raise ValueError("Nothing selected")
    if not confirm and (target == "prod" or any(not CATEGORIES[s["id"]]["safe"] for s in out)):
        raise ValueError("This needs confirmation (it is on prod, or removes more than the safe items)")
    return out


def _step(target: str, sel: Dict[str, Optional[str]]) -> StepSpec:
    cat_id, variant = sel["id"], sel["variant"]
    title = CATEGORIES[cat_id]["title"] + (f" ({CACHE_VARIANTS[variant].lower()})" if variant else "")

    def run(ctx: StepCtx) -> int:
        try:
            res = prune(target, cat_id, variant)
        except (EngineError, ValueError, OSError, subprocess.SubprocessError) as exc:
            ctx.log(f"❌ {exc}")
            ctx.summary(f"Failed: {exc}")
            return 1
        ctx.log(f"✅ {title}: reclaimed {fmt_bytes(res['reclaimed'])}" + (f" ({res['detail']})" if res.get("detail") else ""))
        ctx.summary(f"Reclaimed {fmt_bytes(res['reclaimed'])}" + (f" · {res['detail']}" if res.get("detail") else ""))
        return 0

    return StepSpec(f"c_{cat_id}", title, run, continue_on_fail=True)


def start_cleanup(target: str, selections: List[Dict[str, Any]], confirm: bool) -> str:
    chosen = normalise(target, selections, confirm)
    label = f"Clean up {'prod' if target == 'prod' else 'this machine'}: {len(chosen)} item{'s' if len(chosen) != 1 else ''}"
    return runner.start("gc", label, [_step(target, s) for s in chosen], {"target": target, "categories": chosen})
