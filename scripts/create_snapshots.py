"""
Automated OpenSearch snapshot creation script.

Replaces create_snapshots.sh with fully automated Python using only stdlib.
Docker operations use the Docker Unix socket API directly (no subprocess).
OpenSearch operations use urllib (no curl).

Usage:
    python scripts/create_snapshots.py <local_directory_path>

Example:
    python scripts/create_snapshots.py /home/user/opensearch_snapshots
"""

import http.client
import json
import logging
import os
import shutil
import socket
import sys
import tarfile
import time
import urllib.error
import urllib.request
from pathlib import Path

# ---------------------------------------------------------------------------
# Logging setup — same pattern as backend/ (getLogger), also writes to file
# ---------------------------------------------------------------------------

log_handle = logging.getLogger(__name__)


def _setup_logging():
    fmt = logging.Formatter("%(asctime)s [%(levelname)-8s] %(message)s",
                            datefmt="%Y-%m-%d %H:%M:%S")

    console = logging.StreamHandler(sys.stdout)
    console.setFormatter(fmt)

    log_path = Path(__file__).parent / "create_snapshots.log"
    file_handler = logging.FileHandler(log_path, encoding="utf-8")
    file_handler.setFormatter(fmt)

    root = logging.getLogger()
    root.setLevel(logging.DEBUG)
    root.addHandler(console)
    root.addHandler(file_handler)

    log_handle.info("📋 Logging to console and %s", log_path)


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

DOCKER_SOCKET   = "/var/run/docker.sock"
CONTAINER_NAME  = "opensearch-node"
SNAPSHOTS_MOUNT = "/tmp/snapshots"
OS_HOST         = "localhost"
OS_PORT         = 9200
REPO_NAME       = "local_backup"

SNAPSHOTS = [
    "cataloguesearch_prod",
    "cataloguesearch_prod_metadata",
]

POLL_INTERVAL      = 2    # seconds between health polls
OS_READY_TIMEOUT   = 120  # seconds to wait for OpenSearch after restart
SNAPSHOT_TIMEOUT   = 600  # seconds to wait for a single snapshot to complete


# ---------------------------------------------------------------------------
# Docker Unix-socket helper  (identical to restore_snapshots.py)
# ---------------------------------------------------------------------------

class _UnixSocketHTTPConnection(http.client.HTTPConnection):
    """HTTPConnection that talks over a Unix domain socket instead of TCP."""

    def __init__(self, socket_path: str):
        super().__init__("localhost")
        self._socket_path = socket_path

    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.connect(self._socket_path)


def _docker_request(method: str, path: str, body: dict | None = None) -> dict:
    """
    Send a request to the Docker daemon via the Unix socket.
    Returns the parsed JSON response body.
    Raises RuntimeError on non-2xx status.
    """
    conn = _UnixSocketHTTPConnection(DOCKER_SOCKET)
    headers = {"Content-Type": "application/json"}
    encoded = json.dumps(body).encode() if body else None
    conn.request(method, path, body=encoded, headers=headers)
    resp = conn.getresponse()
    raw = resp.read().decode("utf-8", errors="replace")
    conn.close()

    if resp.status not in (200, 201, 204, 304):
        raise RuntimeError(
            f"❌ Docker API {method} {path} → HTTP {resp.status}: {raw[:400]}"
        )
    return json.loads(raw) if raw.strip() else {}


# ---------------------------------------------------------------------------
# OpenSearch HTTP helper  (identical to restore_snapshots.py)
# ---------------------------------------------------------------------------

def _os_request(method: str, path: str, body: dict | None = None) -> tuple[int, dict]:
    """
    Send an HTTP request to OpenSearch at localhost:9200.
    Returns (status_code, parsed_json_body).
    Never raises on HTTP errors — callers check the status code.
    """
    url = f"http://{OS_HOST}:{OS_PORT}{path}"
    data = json.dumps(body).encode() if body else None
    headers = {"Content-Type": "application/json"} if data else {}
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as resp:
            raw = resp.read().decode("utf-8")
            return resp.status, json.loads(raw) if raw.strip() else {}
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        return exc.code, json.loads(raw) if raw.strip() else {}
    except (urllib.error.URLError, ConnectionRefusedError, OSError):
        return 0, {}


# ---------------------------------------------------------------------------
# Pre-flight checks
# ---------------------------------------------------------------------------

def _parse_args() -> Path:
    if len(sys.argv) != 2:
        print(f"Usage: python {sys.argv[0]} <local_directory_path>")
        print(f"Example: python {sys.argv[0]} /home/user/opensearch_snapshots")
        sys.exit(1)
    return Path(sys.argv[1]).resolve()


def _validate_docker_socket():
    if not os.path.exists(DOCKER_SOCKET):
        raise FileNotFoundError(
            f"❌ Docker socket not found at {DOCKER_SOCKET}. "
            "Is OrbStack / Docker running?"
        )
    log_handle.info("✅ Docker socket found at %s", DOCKER_SOCKET)


def _validate_local_dir(local_dir: Path):
    """Create the output directory if needed and confirm it is writable."""
    local_dir.mkdir(parents=True, exist_ok=True)
    if not os.access(local_dir, os.W_OK):
        raise PermissionError(f"❌ Local directory is not writable: {local_dir}")
    log_handle.info("✅ Local snapshots directory: %s", local_dir)


# ---------------------------------------------------------------------------
# Confirmation prompt
# ---------------------------------------------------------------------------

def _confirm(local_dir: Path):
    print()
    print("=" * 62)
    print("  OpenSearch Snapshot Creation")
    print("=" * 62)
    print()
    print("The following steps will be executed:")
    print()
    print("  1. Delete existing snapshot repository (local_backup)")
    print("  2. Stop opensearch-node container")
    print("     Clear and recreate the local snapshots directory")
    print("     Restart opensearch-node container")
    print("     Wait for cluster to be healthy")
    print("  3. Register new snapshot repository → /tmp/snapshots")
    print("  4. Create snapshot: cataloguesearch_prod")
    print("  5. Create snapshot: cataloguesearch_prod_metadata")
    print("  6. Verify both snapshots have state=SUCCESS")
    print("  7. Verify snapshot files exist on disk")
    print("  8. Create tarball: snapshots.tar.gz alongside the snapshots folder")
    print()
    print(f"⚠️  WARNING: Step 2 will CLEAR all existing files in:")
    print(f"           {local_dir}")
    print("         Make sure you do not need any files currently there.")
    print("⚠️  WARNING: OpenSearch will be briefly stopped and restarted.")
    print()

    answer = input("Do you want to proceed? (yes/no): ").strip().lower()
    if answer != "yes":
        log_handle.info("🚫 Aborted by user.")
        sys.exit(0)
    print()


# ---------------------------------------------------------------------------
# Step 1: Delete existing repository
# ---------------------------------------------------------------------------

def step1_delete_repository():
    log_handle.warning(
        "🟠 Step 1: Deleting existing snapshot repository '%s' (if present)...", REPO_NAME
    )
    status, body = _os_request("DELETE", f"/_snapshot/{REPO_NAME}")
    if status == 200:
        log_handle.info("✅ Step 1 done. Repository '%s' deleted.", REPO_NAME)
    elif status == 404:
        log_handle.info("✅ Step 1 done. Repository '%s' did not exist — nothing to delete.", REPO_NAME)
    elif status == 0:
        log_handle.info(
            "✅ Step 1 done. OpenSearch not reachable (container likely stopped from a "
            "previous interrupted run) — assuming no repository to delete."
        )
    else:
        raise RuntimeError(
            f"❌ Unexpected response deleting repository: HTTP {status} — {body}"
        )


# ---------------------------------------------------------------------------
# Step 2: Stop container, clear host dir, restart, wait for healthy cluster
# ---------------------------------------------------------------------------

def step2_cycle_container(local_dir: Path):
    log_handle.info("🔄 Step 2: Stopping container '%s'...", CONTAINER_NAME)
    # stop with a 30-second timeout so OpenSearch flushes cleanly
    _docker_request("POST", f"/containers/{CONTAINER_NAME}/stop?t=30")
    log_handle.info("🔄 Container stopped.")

    # Clear and recreate host snapshot directory (pure Python — no shell)
    log_handle.warning("🟠 Clearing local snapshots directory: %s", local_dir)
    if local_dir.exists():
        shutil.rmtree(local_dir)
    local_dir.mkdir(parents=True)
    os.chmod(local_dir, 0o755)
    log_handle.info("✅ Local directory cleared and recreated with mode 755.")

    log_handle.info("🔄 Starting container '%s'...", CONTAINER_NAME)
    _docker_request("POST", f"/containers/{CONTAINER_NAME}/start")

    # Wait for container to be running
    deadline = time.time() + OS_READY_TIMEOUT
    while time.time() < deadline:
        try:
            info = _docker_request("GET", f"/containers/{CONTAINER_NAME}/json")
            if info.get("State", {}).get("Status") == "running":
                log_handle.info("🔄 Container is running. Waiting for OpenSearch...")
                break
        except RuntimeError:
            pass
        time.sleep(POLL_INTERVAL)
    else:
        raise RuntimeError(
            f"❌ Container '{CONTAINER_NAME}' did not reach 'running' state in time."
        )

    # Wait for cluster health green or yellow
    attempt = 0
    deadline = time.time() + OS_READY_TIMEOUT
    while time.time() < deadline:
        attempt += 1
        status, body = _os_request("GET", "/_cluster/health")
        if status == 200:
            cluster_status = body.get("status", "unknown")
            if cluster_status in ("green", "yellow"):
                log_handle.info(
                    "✅ Step 2 done. Cluster healthy (status=%s) after %d attempt(s).",
                    cluster_status, attempt,
                )
                return
            log_handle.info(
                "🟠 Cluster status='%s' — waiting for shards to allocate... "
                "(attempt %d)", cluster_status, attempt,
            )
        else:
            log_handle.info(
                "🟠 OpenSearch not reachable yet (HTTP %s). (attempt %d)",
                status or "unreachable", attempt,
            )
        time.sleep(POLL_INTERVAL)

    raise RuntimeError(
        "❌ OpenSearch cluster did not reach a healthy state within the timeout period."
    )


# ---------------------------------------------------------------------------
# Step 3: Register snapshot repository and verify it round-trips
# ---------------------------------------------------------------------------

def step3_create_repository():
    log_handle.info(
        "🔄 Step 3: Registering snapshot repository '%s' → %s", REPO_NAME, SNAPSHOTS_MOUNT
    )
    status, body = _os_request(
        "PUT",
        f"/_snapshot/{REPO_NAME}",
        body={"type": "fs", "settings": {"location": SNAPSHOTS_MOUNT}},
    )
    if status != 200 or not body.get("acknowledged"):
        raise RuntimeError(
            f"❌ Repository registration failed: HTTP {status} — {body}"
        )
    log_handle.info("Repository registered (acknowledged=true).")

    # Round-trip verify
    status, body = _os_request("GET", f"/_snapshot/{REPO_NAME}")
    if status != 200 or REPO_NAME not in body:
        raise RuntimeError(
            f"❌ Repository round-trip verify failed: HTTP {status} — {body}"
        )
    location = body[REPO_NAME].get("settings", {}).get("location", "")
    if location != SNAPSHOTS_MOUNT:
        raise RuntimeError(
            f"❌ Repository location mismatch: got '{location}', expected '{SNAPSHOTS_MOUNT}'"
        )
    log_handle.info("✅ Step 3 done. Repository verified: location=%s", location)


# ---------------------------------------------------------------------------
# Steps 4-5: Create each snapshot synchronously and verify state=SUCCESS
# ---------------------------------------------------------------------------

def _log_index_doc_count(index: str):
    """Log current document count for an index before snapshotting it."""
    status, body = _os_request("GET", f"/{index}/_count")
    if status == 200:
        log_handle.info("📊 Index '%s' document count: %d", index, body.get("count", "?"))
    else:
        log_handle.warning(
            "🟠 Could not get document count for '%s': HTTP %s", index, status
        )


def _create_one_snapshot(name: str):
    log_handle.info("🔄 Creating snapshot '%s' (wait_for_completion=true)...", name)
    _log_index_doc_count(name)

    status, body = _os_request(
        "PUT",
        f"/_snapshot/{REPO_NAME}/{name}?wait_for_completion=true",
        body={
            "indices": name,
            "ignore_unavailable": True,
            "include_global_state": False,
            "metadata": {
                "description": f"Snapshot of {name} index",
                "created_by": "create_snapshots.py",
            },
        },
    )

    if status != 200:
        raise RuntimeError(
            f"❌ Snapshot creation request for '{name}' failed: HTTP {status} — {body}"
        )

    state = body.get("snapshot", {}).get("state", "UNKNOWN")
    if state != "SUCCESS":
        raise RuntimeError(
            f"❌ Snapshot '{name}' completed with state='{state}' (expected SUCCESS). "
            f"Full response: {body}"
        )

    shards = body.get("snapshot", {}).get("shards", {})
    log_handle.info(
        "✅ Snapshot '%s' created: state=%s, shards successful=%s/%s",
        name, state,
        shards.get("successful", "?"),
        shards.get("total", "?"),
    )


def step4_create_snapshot_prod():
    log_handle.info("🔄 Step 4: Creating snapshot for cataloguesearch_prod...")
    _create_one_snapshot("cataloguesearch_prod")
    log_handle.info("✅ Step 4 done.")


def step5_create_snapshot_metadata():
    log_handle.info("🔄 Step 5: Creating snapshot for cataloguesearch_prod_metadata...")
    _create_one_snapshot("cataloguesearch_prod_metadata")
    log_handle.info("✅ Step 5 done.")


# ---------------------------------------------------------------------------
# Step 6: Verify both snapshots show state=SUCCESS in the repository
# ---------------------------------------------------------------------------

def step6_verify_snapshots():
    log_handle.info("🔄 Step 6: Verifying both snapshots in repository...")
    status, body = _os_request("GET", f"/_snapshot/{REPO_NAME}/_all")
    if status != 200:
        raise RuntimeError(
            f"❌ Could not list snapshots: HTTP {status} — {body}"
        )

    found = {s["snapshot"]: s for s in body.get("snapshots", [])}

    for name in SNAPSHOTS:
        if name not in found:
            raise RuntimeError(f"❌ Snapshot '{name}' not found in repository.")
        state = found[name].get("state", "UNKNOWN")
        if state != "SUCCESS":
            raise RuntimeError(
                f"❌ Snapshot '{name}' has state='{state}', expected 'SUCCESS'."
            )
        log_handle.info("✅ Snapshot '%s': state=%s — OK", name, state)

    log_handle.info("✅ Step 6 done. Both snapshots verified successfully.")


# ---------------------------------------------------------------------------
# Step 7: Verify snapshot files exist on disk
# ---------------------------------------------------------------------------

def step7_verify_files_on_disk(local_dir: Path):
    log_handle.info("🔄 Step 7: Verifying snapshot files on disk at %s...", local_dir)
    errors = []

    for required in ("index.latest", "indices"):
        if not (local_dir / required).exists():
            errors.append(f"Missing required file/dir: '{required}'")

    index_files = list(local_dir.glob("index-*"))
    if not index_files:
        errors.append("No 'index-*' file found")

    dat_files = list(local_dir.glob("*.dat"))
    if not dat_files:
        errors.append("No '.dat' snapshot files found")

    if errors:
        raise RuntimeError(
            f"❌ Snapshot directory validation failed: {'; '.join(errors)}"
        )

    log_handle.info(
        "✅ Disk verification OK — %d index file(s), %d .dat file(s)",
        len(index_files), len(dat_files),
    )

    # Log total size on disk
    total_bytes = sum(f.stat().st_size for f in local_dir.rglob("*") if f.is_file())
    log_handle.info(
        "✅ Step 7 done. Total snapshot size on disk: %.1f MB", total_bytes / (1024 * 1024)
    )


# ---------------------------------------------------------------------------
# Step 8: Create tarball of the snapshots directory
# ---------------------------------------------------------------------------

def step8_create_tarball(local_dir: Path):
    tarball_path = local_dir.parent / (local_dir.name + ".tar.gz")
    log_handle.info("🔄 Step 8: Creating tarball at %s...", tarball_path)

    with tarfile.open(tarball_path, "w:gz") as tar:
        tar.add(local_dir, arcname=local_dir.name)

    size_mb = tarball_path.stat().st_size / (1024 * 1024)
    log_handle.info("✅ Step 8 done. Tarball created: %s (%.1f MB)", tarball_path, size_mb)
    return tarball_path


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    _setup_logging()

    local_dir = _parse_args()

    try:
        _validate_docker_socket()
        _validate_local_dir(local_dir)
        _confirm(local_dir)

        step1_delete_repository()
        step2_cycle_container(local_dir)
        step3_create_repository()
        step4_create_snapshot_prod()
        step5_create_snapshot_metadata()
        step6_verify_snapshots()
        step7_verify_files_on_disk(local_dir)
        tarball_path = step8_create_tarball(local_dir)

        print()
        print("=" * 62)
        print("✅ All snapshots created successfully!")
        print(f"   Snapshots folder : {local_dir}")
        print(f"   Tarball          : {tarball_path}")
        print("=" * 62)
        print()
        log_handle.info("✅ Script completed successfully.")

    except (FileNotFoundError, PermissionError, RuntimeError) as exc:
        log_handle.error("❌ FATAL: %s", exc)
        sys.exit(1)
    except KeyboardInterrupt:
        log_handle.info("🚫 Interrupted by user.")
        sys.exit(0)


if __name__ == "__main__":
    main()
