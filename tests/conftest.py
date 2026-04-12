import subprocess
import time
from pathlib import Path

import docker
import docker.errors
import pytest

_PROJECT_ROOT = Path(__file__).parent.parent
_CONTAINER_NAME = "opensearch-test"
_DOCKER_COMPOSE_FILE = _PROJECT_ROOT / "docker-compose.test.yml"


def _wait_until_healthy(client: docker.DockerClient, timeout: int = 90) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            container = client.containers.get(_CONTAINER_NAME)
            container.reload()
            status = container.attrs.get("State", {}).get("Health", {}).get("Status")
            if status == "healthy":
                return
        except docker.errors.NotFound:
            pass
        time.sleep(2)
    raise RuntimeError(f"OpenSearch did not become healthy within {timeout}s.")


@pytest.fixture(scope="session", autouse=True)
def ensure_opensearch_running():
    client = docker.from_env()
    try:
        container = client.containers.get(_CONTAINER_NAME)
        if container.status != "running":
            container.start()
            _wait_until_healthy(client)
    except docker.errors.NotFound:
        # Container doesn't exist yet — use compose to create and start it.
        # Falls back to subprocess only for this first-time case; all subsequent
        # runs use the Docker SDK path above.
        subprocess.run(
            ["docker-compose", "-f", str(_DOCKER_COMPOSE_FILE), "up", "-d"],
            check=True,
            cwd=_PROJECT_ROOT,
        )
        _wait_until_healthy(client)

    yield

    # Intentionally NOT stopping the container after tests.
    # Keeping it running saves startup time on the next run.
    # Stop it manually when done: docker-compose -f docker-compose.test.yml down


def pytest_addoption(parser):
    """Adds the --run-slow command-line option to pytest."""
    parser.addoption(
        "--run-slow", action="store_true", default=False, help="run slow tests"
    )
    parser.addoption(
        "--run-integration", action="store_true", default=False,
        help="run integration tests"
    )
    parser.addoption(
        "--run-all", action="store_true", default=False,
        help="run all tests, including slow and integration tests"
    )

def pytest_configure(config):
    """Adds the 'slow' marker to the pytest configuration."""
    config.addinivalue_line("markers", "slow: mark test as slow to run")

def pytest_collection_modifyitems(config, items):
    """
    Skips tests marked as 'slow' if the --run-slow option is not given.
    """
    skip_slow = True
    skip_integration = True

    if config.getoption("--run-all"):
        # If --run-all is given, do not skip any tests
        skip_slow = False
        skip_integration = False
    elif config.getoption("--run-slow"):
        # If --run-slow is given, do not skip slow tests
        skip_slow = False
    elif config.getoption("--run-integration"):
        # If --run-integration is given, do not skip integration tests
        skip_integration = False

    if skip_slow:
        # If skip all tests marked as 'slow'
        skip_slow = pytest.mark.skip(
            reason="need --run-slow or --run-all option to run")
        for item in items:
            if "slow" in item.keywords:
                item.add_marker(skip_slow)

    if skip_integration:
        # If --run-integration or --run-all is not given,
        # skip all tests marked as 'integration'
        skip_integration = pytest.mark.skip(
            reason="need --run-integration or --run-all option to run")
        for item in items:
            if "integration" in item.keywords:
                item.add_marker(skip_integration)
