"""Restarts Docker (OrbStack) as a job, so its progress shows up like any other and only one job runs at a time.

`orb stop` can itself hang when the VM is stuck, so every command has a time limit; whatever happens, the job goes on
to `orb start` and then waits until `docker ps` is quick again and the local OpenSearch container is healthy.
"""
import shutil
import subprocess
import threading
import time
from typing import List, Optional

from deploy import docker_health, settings
from deploy.runner import StepCtx, StepSpec, runner

STOP_TIMEOUT = 120       # seconds each OrbStack command may take
START_TIMEOUT = 120
DOCKER_WAIT = 180        # how long Docker gets to become responsive after the start
OPENSEARCH_WAIT = 120    # ... and the OpenSearch container to become healthy
POLL = 3


def start_restart() -> str:
    return runner.start("docker", "Restart Docker (OrbStack)", [StepSpec("restart", "Restart OrbStack", _restart)], {})


def _run(ctx: StepCtx, argv: List[str], timeout: float) -> Optional[int]:
    """Runs a command, logging its output. Returns its exit code, or None if it ran past `timeout` or the job was cancelled."""
    proc = subprocess.Popen(argv, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)

    def pump() -> None:
        for line in proc.stdout:
            ctx.log(line.rstrip())

    reader = threading.Thread(target=pump, daemon=True)
    reader.start()
    deadline = time.monotonic() + timeout
    while proc.poll() is None:
        if ctx.cancelled or time.monotonic() > deadline:
            proc.kill()
            proc.wait()
            reader.join(timeout=2)
            return None
        time.sleep(0.3)
    reader.join(timeout=2)
    return proc.returncode


def _opensearch_state() -> Optional[str]:
    """'healthy' / 'starting' / 'running' / 'exited' ..., or None when the container does not exist or Docker is silent."""
    try:
        proc = subprocess.run(
            ["docker", "inspect", "--format", "{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}",
             settings.OPENSEARCH_CONTAINER], capture_output=True, text=True, timeout=15)
    except (OSError, subprocess.SubprocessError):
        return None
    return proc.stdout.strip() if proc.returncode == 0 and proc.stdout.strip() else None


def _restart(ctx: StepCtx) -> int:
    orb = settings.ORB_BIN or shutil.which("orb") or shutil.which("orbctl")
    if not orb:
        ctx.log("OrbStack's command line tool (orb) was not found on this machine, so Docker cannot be restarted from here.")
        ctx.summary("orb not found")
        return 1
    docker_health.forget()

    ctx.progress("Stopping OrbStack", index=1, of=4)
    ctx.log("$ orb stop")
    code = _run(ctx, [orb, "stop"], STOP_TIMEOUT)
    if ctx.cancelled:
        return 1
    if code is None:
        ctx.log(f"orb stop did not finish within {STOP_TIMEOUT}s. Going on to start it anyway.")
    elif code != 0:
        ctx.log(f"orb stop exited with {code}. Going on to start it anyway.")

    ctx.progress("Starting OrbStack", index=2, of=4)
    ctx.log("$ orb start")
    code = _run(ctx, [orb, "start"], START_TIMEOUT)
    if ctx.cancelled:
        return 1
    if code is None:
        ctx.log(f"orb start did not finish within {START_TIMEOUT}s. Checking Docker anyway.")
    elif code != 0:
        ctx.log(f"orb start exited with {code}. Checking Docker anyway.")

    ctx.progress("Waiting for Docker to answer", index=3, of=4)
    deadline = time.monotonic() + DOCKER_WAIT
    last_note = 0.0
    while True:
        result = docker_health.check()
        if result["status"] == docker_health.OK:
            ctx.log(f"✅ {result['message']}")
            break
        if time.monotonic() - last_note > 15:
            ctx.log(f"… Docker is not ready yet: {result['message']}")
            last_note = time.monotonic()
        if time.monotonic() > deadline:
            ctx.log("❌ Docker did not become responsive. Quit OrbStack from the menu bar and open it again, then check here.")
            ctx.summary("Docker did not recover")
            return 1
        if not ctx.sleep(POLL):
            return 1

    ctx.progress(f"Waiting for {settings.OPENSEARCH_CONTAINER}", index=4, of=4)
    state = _opensearch_state()
    deadline = time.monotonic() + OPENSEARCH_WAIT
    while state in ("starting", "created", "restarting") and time.monotonic() < deadline:
        if not ctx.sleep(POLL):
            return 1
        state = _opensearch_state()
    if state == "healthy" or state == "running":
        ctx.log(f"✅ {settings.OPENSEARCH_CONTAINER} is {state}.")
        note = f"OpenSearch {state}"
    elif state is None:
        ctx.log(f"{settings.OPENSEARCH_CONTAINER} does not exist here; nothing to wait for.")
        note = "no local OpenSearch container"
    else:
        ctx.log(f"⚠️ {settings.OPENSEARCH_CONTAINER} is '{state}'. Start it with: docker compose up -d {settings.OPENSEARCH_CONTAINER}")
        note = f"OpenSearch {state}"
    docker_health.forget()
    ctx.summary(f"Docker answers again ({result['seconds']:g}s); {note}")
    return 0
