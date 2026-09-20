"""Static settings for the deploy tooling. Every value can be overridden by an env var."""
import os
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

# Where run history (sqlite) and per-step logs are kept.
DATA_DIR = Path(os.environ.get("DEPLOY_DATA_DIR", Path.home() / "cataloguesearch" / "deploy"))

# ssh alias (from ~/.ssh/config) or user@host of the prod VM.
PROD_HOST = os.environ.get("DEPLOY_PROD_HOST", "swalakshya-prod")
# Directory on prod that holds restore_snapshots.py, docker-compose.prod.yml, .env.prod, snapshots/.
PROD_DIR = os.environ.get("DEPLOY_PROD_DIR", "~")

# Same env file `docker compose ... build --push` is run with by hand today.
BUILD_ENV_FILE = os.environ.get("DEPLOY_BUILD_ENV_FILE", ".env.local")
COMPOSE_FILE = "docker-compose.yml"
DEFAULT_BUILD_SERVICES = ["cataloguesearch-api", "cataloguesearch-frontend"]

# The chat service lives in its own repo and is built there with a plain `docker compose build --push`.
CHAT_REPO_DIR = Path(os.environ.get("DEPLOY_CHAT_REPO", REPO_ROOT.parent / "cataloguesearch-chat"))
CHAT_SERVICE = "cataloguesearch-chat"

DOCKERHUB_REPO = os.environ.get("DEPLOY_DOCKERHUB_REPO", "swalakshya/cataloguesearch")
OPENSEARCH_URL = os.environ.get("DEPLOY_OPENSEARCH_URL", "http://localhost:9200")

# Interpreter used for scripts/create_snapshots.py (needs `zstandard`).
SCRIPT_PYTHON = os.environ.get("DEPLOY_PYTHON", sys.executable)

SSH_OPTS = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "-o", "ServerAliveInterval=30"]
