"""Read-only status probes shown on the Deploy page. Prefer HTTP APIs; ssh only for prod."""
import shutil
import subprocess
from typing import Any, Dict, List

import requests
import yaml

from deploy import settings

_TIMEOUT = 5


def build_services() -> List[str]:
    """Buildable targets: services in docker-compose.yml with a `build:` section, plus the chat repo if present."""
    with open(settings.REPO_ROOT / settings.COMPOSE_FILE, encoding="utf-8") as fh:
        compose = yaml.safe_load(fh)
    services = [name for name, svc in (compose.get("services") or {}).items() if "build" in svc]
    if (settings.CHAT_REPO_DIR / "docker-compose.yml").exists():
        services.append(settings.CHAT_SERVICE)
    return services


def local_opensearch() -> Dict[str, Any]:
    """Cluster health + doc count of the prod-named indices, via the OpenSearch REST API."""
    try:
        health = requests.get(f"{settings.OPENSEARCH_URL}/_cluster/health", timeout=_TIMEOUT).json()
        rows = requests.get(
            f"{settings.OPENSEARCH_URL}/_cat/indices/cataloguesearch_prod*?format=json&h=index,docs.count,store.size",
            timeout=_TIMEOUT).json()
        return {
            "reachable": True,
            "status": health.get("status"),
            "indices": sorted(
                ({"name": r["index"], "docs": int(r["docs.count"] or 0), "size": r["store.size"]} for r in rows),
                key=lambda r: r["name"]),
        }
    except Exception as exc:  # noqa: BLE001
        return {"reachable": False, "error": str(exc)[:200], "indices": []}


def dockerhub_tags() -> Dict[str, Any]:
    """When each tag of the image repo was last pushed, via the Docker Hub API."""
    try:
        resp = requests.get(
            f"https://hub.docker.com/v2/repositories/{settings.DOCKERHUB_REPO}/tags?page_size=25",
            timeout=_TIMEOUT)
        resp.raise_for_status()
        return {"reachable": True, "repo": settings.DOCKERHUB_REPO, "tags": [
            {"name": t["name"], "last_pushed": t.get("tag_last_pushed") or t.get("last_updated")}
            for t in resp.json().get("results", [])]}
    except Exception as exc:  # noqa: BLE001
        return {"reachable": False, "repo": settings.DOCKERHUB_REPO, "error": str(exc)[:200], "tags": []}


def local_tooling() -> Dict[str, Any]:
    """Things the copy-snapshots step needs on this machine."""
    return {
        "docker": bool(shutil.which("docker")),
        "pv": bool(shutil.which("pv")),
        "zstandard": _python_has(settings.SCRIPT_PYTHON, "zstandard"),
        "python": settings.SCRIPT_PYTHON,
        "build_env_file": (settings.REPO_ROOT / settings.BUILD_ENV_FILE).exists(),
    }


def _python_has(python: str, module: str) -> bool:
    try:
        return subprocess.run([python, "-c", f"import {module}"], capture_output=True, timeout=10).returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False


def prod_status() -> Dict[str, Any]:
    """Reachability + running containers on prod (ssh, read-only)."""
    try:
        proc = subprocess.run(
            ["ssh", *settings.SSH_OPTS, settings.PROD_HOST,
             "docker ps --format '{{.Names}}|{{.Image}}|{{.Status}}'"],
            capture_output=True, text=True, timeout=20)
    except Exception as exc:  # noqa: BLE001
        return {"reachable": False, "host": settings.PROD_HOST, "error": str(exc)[:200], "containers": []}
    if proc.returncode != 0:
        return {"reachable": False, "host": settings.PROD_HOST,
                "error": (proc.stderr or "ssh failed").strip()[:200], "containers": []}
    containers = []
    for line in proc.stdout.splitlines():
        parts = line.split("|", 2)
        if len(parts) == 3:
            containers.append({"name": parts[0], "image": parts[1], "status": parts[2]})
    return {"reachable": True, "host": settings.PROD_HOST, "containers": containers}
