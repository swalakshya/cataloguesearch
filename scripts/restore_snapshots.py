"""
Automated OpenSearch snapshot restore script.

Replaces restore_snapshots.sh with fully automated Python using only stdlib.
Docker operations use the Docker Unix socket API directly (no subprocess).
OpenSearch operations use urllib (no curl).
"""

import argparse
import http.client
import json
import logging
import os
import socket
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

# ---------------------------------------------------------------------------
# Logging setup — same pattern as backend/ (getLogger), but also write to file
# ---------------------------------------------------------------------------

log_handle = logging.getLogger(__name__)

def _setup_logging():
    fmt = logging.Formatter("%(asctime)s [%(levelname)-8s] %(message)s",
                            datefmt="%Y-%m-%d %H:%M:%S")

    console = logging.StreamHandler(sys.stdout)
    console.setFormatter(fmt)

    log_path = Path(__file__).parent / "restore_snapshots.log"
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

DOCKER_SOCKET     = "/var/run/docker.sock"
CONTAINER_NAME    = "opensearch-node"
SNAPSHOTS_MOUNT   = "/tmp/snapshots"
OS_HOST           = "localhost"
OS_PORT           = 9200
REPO_NAME         = "local_backup"

SNAPSHOTS = [
    "cataloguesearch_prod",
    "cataloguesearch_prod_metadata",
]

SNAPSHOTS_DIR = Path(__file__).parent.parent / "snapshots"

# How long to wait between health / restore-status polls (seconds)
POLL_INTERVAL     = 5
OS_READY_TIMEOUT  = 120   # seconds to wait for OpenSearch after container restart
RESTORE_TIMEOUT   = 600   # seconds to wait for all indices to be fully restored


# ---------------------------------------------------------------------------
# Docker Unix-socket helper
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

    if resp.status not in (200, 201, 204):
        raise RuntimeError(
            f"❌ Docker API {method} {path} → HTTP {resp.status}: {raw[:400]}"
        )
    return json.loads(raw) if raw.strip() else {}


def _docker_exec(cmd: list[str], user: str = "") -> tuple[int, str]:
    """
    Run a command inside CONTAINER_NAME via Docker exec API.
    Returns (exit_code, combined_stdout_stderr).
    """
    # 1. Create exec instance
    create_body = {
        "AttachStdout": True,
        "AttachStderr": True,
        "Cmd": cmd,
    }
    if user:
        create_body["User"] = user

    resp = _docker_request(
        "POST",
        f"/containers/{CONTAINER_NAME}/exec",
        body=create_body,
    )
    exec_id = resp["Id"]

    # 2. Start exec (stream=false → wait for completion)
    conn = _UnixSocketHTTPConnection(DOCKER_SOCKET)
    start_body = json.dumps({"Detach": False, "Tty": False}).encode()
    conn.request(
        "POST",
        f"/exec/{exec_id}/start",
        body=start_body,
        headers={"Content-Type": "application/json"},
    )
    exec_resp = conn.getresponse()
    # Docker multiplexes stdout/stderr with an 8-byte header per frame.
    # We strip those headers to get plain text.
    raw_output = exec_resp.read()
    conn.close()

    output = _strip_docker_stream_headers(raw_output)

    # 3. Inspect to get exit code
    inspect = _docker_request("GET", f"/exec/{exec_id}/json")
    exit_code = inspect.get("ExitCode", -1)
    return exit_code, output


def _strip_docker_stream_headers(data: bytes) -> str:
    """Remove Docker multiplexed stream headers (8 bytes each) and decode."""
    result = []
    idx = 0
    while idx + 8 <= len(data):
        # Header: [stream_type(1), 0, 0, 0, size(4 big-endian)]
        size = int.from_bytes(data[idx + 4: idx + 8], "big")
        idx += 8
        if idx + size <= len(data):
            result.append(data[idx: idx + size].decode("utf-8", errors="replace"))
        idx += size
    return "".join(result)


# ---------------------------------------------------------------------------
# OpenSearch HTTP helper
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
        return 0, {}   # OpenSearch not reachable


# ---------------------------------------------------------------------------
# Pre-flight: validate local snapshots directory
# ---------------------------------------------------------------------------

def _validate_snapshots_dir():
    log_handle.info("🔍 Validating snapshots directory: %s", SNAPSHOTS_DIR)

    if not SNAPSHOTS_DIR.exists():
        raise FileNotFoundError(
            f"❌ 'snapshots/' directory not found at {SNAPSHOTS_DIR}. "
            "Run this script from the cataloguesearch project root."
        )
    if not os.access(SNAPSHOTS_DIR, os.R_OK):
        raise PermissionError(f"❌ Cannot read snapshots directory: {SNAPSHOTS_DIR}")

    for required in ("index.latest", "indices"):
        if not (SNAPSHOTS_DIR / required).exists():
            raise FileNotFoundError(
                f"❌ Required snapshot file/dir '{required}' missing in {SNAPSHOTS_DIR}"
            )

    index_files = list(SNAPSHOTS_DIR.glob("index-*"))
    if not index_files:
        raise FileNotFoundError(f"❌ No index-* file found in {SNAPSHOTS_DIR}")

    dat_files = list(SNAPSHOTS_DIR.glob("*.dat"))
    if not dat_files:
        raise FileNotFoundError(
            f"❌ No .dat snapshot files found in {SNAPSHOTS_DIR}. "
            "This does not appear to be a valid OpenSearch snapshot directory."
        )

    log_handle.info(
        "✅ Snapshots directory OK — %d index file(s), %d .dat file(s)",
        len(index_files), len(dat_files),
    )


# ---------------------------------------------------------------------------
# Pre-flight: Docker socket accessible?
# ---------------------------------------------------------------------------

def _validate_docker_socket():
    if not os.path.exists(DOCKER_SOCKET):
        raise FileNotFoundError(
            f"❌ Docker socket not found at {DOCKER_SOCKET}. "
            "Is OrbStack / Docker running?"
        )
    log_handle.info("✅ Docker socket found at %s", DOCKER_SOCKET)


# ---------------------------------------------------------------------------
# Confirmation prompt
# ---------------------------------------------------------------------------

def _confirm():
    print()
    print("=" * 62)
    print("  OpenSearch Snapshot Restore")
    print("=" * 62)
    print()
    print("The following steps will be executed:")
    print()
    print("  1. Restart opensearch-node container (refresh bind mount)")
    print("  2. Fix permissions on /tmp/snapshots/ inside the container")
    print("     and VERIFY them with stat")
    print("  3. Delete existing snapshot repository (local_backup)")
    print("  4. Register new snapshot repository → /tmp/snapshots")
    print("  5. Verify both snapshots are present and state=SUCCESS")
    print("  6. Delete existing OpenSearch indices")
    print("  7. Restore both snapshots")
    print("  8. Poll until all indices are fully restored, then print")
    print("     document counts")
    print()
    print("⚠️  WARNING: Step 6 will PERMANENTLY DELETE all data in:")
    print("           • cataloguesearch_prod")
    print("           • cataloguesearch_prod_metadata")
    print("         Ensure your snapshots are valid before proceeding.")
    print("⚠️  WARNING: OpenSearch will be restarted (brief downtime).")
    print()

    answer = input("Do you want to proceed? (yes/no): ").strip().lower()
    if answer != "yes":
        log_handle.info("🚫 Aborted by user.")
        sys.exit(0)
    print()


# ---------------------------------------------------------------------------
# Step 1: Restart container and wait for OpenSearch to be ready
# ---------------------------------------------------------------------------

def step1_restart_container():
    log_handle.info("🔄 Step 1: Restarting container '%s'...", CONTAINER_NAME)

    _docker_request("POST", f"/containers/{CONTAINER_NAME}/restart")
    log_handle.info("🔄 Restart signal sent. Waiting for container to be running...")

    deadline = time.time() + OS_READY_TIMEOUT
    while time.time() < deadline:
        try:
            info = _docker_request("GET", f"/containers/{CONTAINER_NAME}/json")
            state = info.get("State", {}).get("Status", "")
            if state == "running":
                log_handle.info("🔄 Container is running. Waiting for OpenSearch to be ready...")
                break
        except RuntimeError:
            pass
        time.sleep(POLL_INTERVAL)
    else:
        raise RuntimeError(f"❌ Container '{CONTAINER_NAME}' did not reach 'running' state in time.")

    # Now wait for OpenSearch to accept requests
    deadline = time.time() + OS_READY_TIMEOUT
    while time.time() < deadline:
        status, body = _os_request("GET", "/_cluster/health")
        if status == 200:
            cluster_status = body.get("status", "unknown")
            log_handle.info("✅ Step 1 done. OpenSearch is ready. Cluster health: %s", cluster_status)
            return
        log_handle.info("🟠 OpenSearch not ready yet (HTTP %s). Retrying in %ds...", status or "unreachable", POLL_INTERVAL)
        time.sleep(POLL_INTERVAL)

    raise RuntimeError("❌ OpenSearch did not become ready within the timeout period.")


# ---------------------------------------------------------------------------
# Step 2: Fix and VERIFY permissions
# ---------------------------------------------------------------------------

def step2_fix_permissions():
    log_handle.info("🔄 Step 2: Fixing permissions on %s inside container...", SNAPSHOTS_MOUNT)

    # Show current state
    exit_code, output = _docker_exec(["ls", "-la", SNAPSHOTS_MOUNT])
    log_handle.info("Before permission fix:\n%s", output.strip())

    # chown
    exit_code, output = _docker_exec(
        ["chown", "-R", "opensearch:opensearch", SNAPSHOTS_MOUNT], user="root"
    )
    if exit_code != 0:
        raise RuntimeError(f"❌ chown failed (exit {exit_code}): {output.strip()}")
    log_handle.info("✅ chown -R opensearch:opensearch OK")

    # chmod
    exit_code, output = _docker_exec(
        ["chmod", "-R", "775", SNAPSHOTS_MOUNT], user="root"
    )
    if exit_code != 0:
        raise RuntimeError(f"❌ chmod failed (exit {exit_code}): {output.strip()}")
    log_handle.info("✅ chmod -R 775 OK")

    # VERIFY with stat — this is the critical check the shell script skipped
    log_handle.info("🔍 Verifying permissions with stat...")
    exit_code, stat_output = _docker_exec(
        ["stat", "-c", "%U %G %a", SNAPSHOTS_MOUNT]
    )
    if exit_code != 0:
        raise RuntimeError(f"❌ stat verification failed (exit {exit_code}): {stat_output.strip()}")

    stat_output = stat_output.strip()
    log_handle.info("stat output: '%s'", stat_output)

    parts = stat_output.split()
    if len(parts) != 3:
        raise RuntimeError(f"❌ Unexpected stat output format: '{stat_output}'")

    owner, group, perms = parts
    errors = []
    if owner != "opensearch":
        errors.append(f"owner is '{owner}', expected 'opensearch'")
    if group != "opensearch":
        errors.append(f"group is '{group}', expected 'opensearch'")
    if perms != "775":
        errors.append(f"permissions are '{perms}', expected '775'")

    if errors:
        raise RuntimeError(
            f"❌ Permission verification FAILED on {SNAPSHOTS_MOUNT}: " + "; ".join(errors)
        )

    log_handle.info(
        "✅ Step 2 done. Permissions verified: owner=%s group=%s mode=%s", owner, group, perms
    )

    # Show final state
    _, output = _docker_exec(["ls", "-la", SNAPSHOTS_MOUNT])
    log_handle.info("After permission fix:\n%s", output.strip())


# ---------------------------------------------------------------------------
# Step 3: Delete existing repository
# ---------------------------------------------------------------------------

def step3_delete_repository():
    log_handle.warning(
        "🟠 Step 3: Deleting existing snapshot repository '%s' (if present)...", REPO_NAME
    )
    status, body = _os_request("DELETE", f"/_snapshot/{REPO_NAME}")
    if status == 200:
        log_handle.info("✅ Step 3 done. Repository '%s' deleted.", REPO_NAME)
    elif status == 404:
        log_handle.info("✅ Step 3 done. Repository '%s' did not exist — nothing to delete.", REPO_NAME)
    else:
        raise RuntimeError(
            f"❌ Unexpected response deleting repository: HTTP {status} — {body}"
        )


# ---------------------------------------------------------------------------
# Step 4: Create repository and verify it round-trips
# ---------------------------------------------------------------------------

def step4_create_repository():
    log_handle.info(
        "🔄 Step 4: Creating snapshot repository '%s' → %s", REPO_NAME, SNAPSHOTS_MOUNT
    )
    status, body = _os_request(
        "PUT",
        f"/_snapshot/{REPO_NAME}",
        body={"type": "fs", "settings": {"location": SNAPSHOTS_MOUNT}},
    )
    if status != 200 or not body.get("acknowledged"):
        raise RuntimeError(
            f"❌ Repository creation failed: HTTP {status} — {body}"
        )
    log_handle.info("Repository created (acknowledged=true).")

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
    log_handle.info("✅ Step 4 done. Repository verified: location=%s", location)


# ---------------------------------------------------------------------------
# Step 5: Verify snapshots are visible and state=SUCCESS
# ---------------------------------------------------------------------------

def step5_verify_snapshots():
    log_handle.info("🔄 Step 5: Verifying both snapshots are accessible in repository...")
    status, body = _os_request("GET", f"/_snapshot/{REPO_NAME}/_all")
    if status != 200:
        raise RuntimeError(
            f"❌ Could not list snapshots: HTTP {status} — {body}"
        )

    found = {s["snapshot"]: s for s in body.get("snapshots", [])}

    if not found:
        raise RuntimeError(
            "❌ No snapshots found in repository. "
            "Check that the bind mount is correctly set up."
        )

    for name in SNAPSHOTS:
        if name not in found:
            raise RuntimeError(f"❌ Snapshot '{name}' not found in repository.")
        state = found[name].get("state", "UNKNOWN")
        if state != "SUCCESS":
            raise RuntimeError(
                f"❌ Snapshot '{name}' has state='{state}', expected 'SUCCESS'."
            )
        log_handle.info("✅ Snapshot '%s': state=%s", name, state)

    log_handle.info("✅ Step 5 done. Both snapshots verified.")


# ---------------------------------------------------------------------------
# Step 6: Delete existing indices
# ---------------------------------------------------------------------------

def step6_delete_indices():
    log_handle.warning(
        "🟠 Step 6: Deleting existing indices — THIS IS IRREVERSIBLE"
    )
    for index in SNAPSHOTS:
        status, body = _os_request("DELETE", f"/{index}")
        if status == 200:
            log_handle.info("🟠 Deleted index '%s'.", index)
        elif status == 404:
            log_handle.info("🟠 Index '%s' did not exist — skipping.", index)
        else:
            raise RuntimeError(
                f"❌ Unexpected response deleting index '{index}': HTTP {status} — {body}"
            )

    # Confirm indices are gone
    status, body = _os_request("GET", "/_cat/indices?format=json")
    if status == 200:
        existing = {i["index"] for i in body}
        still_present = [name for name in SNAPSHOTS if name in existing]
        if still_present:
            raise RuntimeError(
                f"❌ Indices still present after deletion: {still_present}"
            )
    log_handle.info("✅ Step 6 done. All target indices confirmed absent.")


# ---------------------------------------------------------------------------
# Step 7: Restore snapshots
# ---------------------------------------------------------------------------

def step7_restore_snapshots():
    log_handle.info("🔄 Step 7: Initiating restore of both snapshots...")
    for name in SNAPSHOTS:
        log_handle.info("🔄 Restoring '%s'...", name)
        status, body = _os_request(
            "POST",
            f"/_snapshot/{REPO_NAME}/{name}/_restore",
            body={
                "indices": name,
                "ignore_unavailable": True,
                "include_global_state": False,
            },
        )
        if status == 200 and body.get("accepted"):
            log_handle.info("✅ Restore of '%s' accepted.", name)
        else:
            raise RuntimeError(
                f"❌ Restore of '{name}' not accepted: HTTP {status} — {body}"
            )
    log_handle.info("✅ Step 7 done. Both restores accepted, now waiting for completion...")


# ---------------------------------------------------------------------------
# Step 8: Poll until all indices are fully restored, then print counts
# ---------------------------------------------------------------------------

def step8_wait_for_restore():
    log_handle.info(
        "🔄 Step 8: Polling until all indices are fully restored "
        "(503 = still restoring, will keep retrying)..."
    )
    deadline = time.time() + RESTORE_TIMEOUT
    pending = set(SNAPSHOTS)
    counts = {}

    while time.time() < deadline:
        for name in list(pending):
            status, body = _os_request("GET", f"/{name}/_count")
            if status == 200:
                count = body.get("count", "?")
                log_handle.info("✅ Index '%s' is ready. Document count: %d", name, count)
                counts[name] = count
                pending.discard(name)
            elif status == 503:
                log_handle.info(
                    "🟠 Index '%s' not ready yet (503 — restore in progress). "
                    "Retrying in %ds...", name, POLL_INTERVAL
                )
            else:
                log_handle.info(
                    "🟠 Index '%s' returned HTTP %s. Retrying in %ds...",
                    name, status or "unreachable", POLL_INTERVAL,
                )

        if not pending:
            break
        time.sleep(POLL_INTERVAL)
    else:
        still_pending = ", ".join(pending)
        raise RuntimeError(
            f"❌ Timed out waiting for restore. Indices still not ready: {still_pending}"
        )

    print()
    print("=" * 62)
    print("✅ Restore complete! Document counts:")
    print("=" * 62)
    for name in SNAPSHOTS:
        print(f"  {name}: {counts[name]:,}")
    print("=" * 62)
    print()
    log_handle.info("✅ Step 8 done. All indices restored successfully.")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description=(
            "Automated OpenSearch snapshot restore script.\n"
            "Restarts the opensearch-node container, fixes permissions, registers\n"
            "the snapshot repository, and restores both production indices."
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.parse_args()

    _setup_logging()

    try:
        _validate_snapshots_dir()
        _validate_docker_socket()
        _confirm()

        step1_restart_container()
        step2_fix_permissions()
        step3_delete_repository()
        step4_create_repository()
        step5_verify_snapshots()
        step6_delete_indices()
        step7_restore_snapshots()
        step8_wait_for_restore()

        log_handle.info("✅ Script completed successfully.")

    except (FileNotFoundError, PermissionError, RuntimeError) as exc:
        log_handle.error("❌ FATAL: %s", exc)
        sys.exit(1)
    except KeyboardInterrupt:
        log_handle.info("🚫 Interrupted by user.")
        sys.exit(0)


if __name__ == "__main__":
    main()
