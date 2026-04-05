import logging
import subprocess
import time

import pytest
import requests

from tests.backend.common import APIServerManager

log_handle = logging.getLogger(__name__)

OLLAMA_URL = "http://localhost:11434"


@pytest.fixture(scope="session")
def ensure_ollama():
    """Start Ollama if it isn't already running. Shuts it down only if we started it."""
    try:
        requests.get(OLLAMA_URL, timeout=2)
        log_handle.info("Ollama already running at %s", OLLAMA_URL)
        we_started_it = False
    except requests.exceptions.RequestException:
        log_handle.info("Ollama not running — starting 'ollama serve'...")
        proc = subprocess.Popen(
            ["ollama", "serve"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        we_started_it = True

        deadline = time.time() + 30
        while time.time() < deadline:
            try:
                requests.get(OLLAMA_URL, timeout=1)
                log_handle.info("Ollama started successfully.")
                break
            except requests.exceptions.RequestException:
                time.sleep(1)
        else:
            proc.terminate()
            pytest.fail("Ollama failed to start within 30 seconds.")

    yield

    if we_started_it:
        log_handle.info("Stopping Ollama (we started it).")
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            log_handle.warning("Ollama did not stop after SIGTERM — sending SIGKILL.")
            proc.kill()
            proc.wait()


@pytest.fixture(scope="session")
def build_index(ensure_ollama):
    """
    Build the OpenSearch test index once per session.
    Shared by test_search_api.py and test_agent_api_integration.py.
    Inlines the Config initialisation that initialise() does per-module,
    since session scope cannot depend on module-scoped fixtures.
    """
    import os
    from dotenv import load_dotenv
    from backend.common.opensearch import get_opensearch_client, create_indices_if_not_exists
    from backend.config import Config
    from backend.crawler.discovery import Discovery
    from backend.crawler.index_state import IndexState
    from backend.crawler.index_generator import IndexGenerator
    from backend.crawler.pdf_factory import create_pdf_processor
    from tests.backend.common import setup, get_all_documents

    # Replicate what initialise() does for Config setup
    load_dotenv(
        dotenv_path=os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"),
        verbose=True,
    )
    test_base_dir = os.getenv("TEST_BASE_DIR")
    if not test_base_dir:
        pytest.fail("TEST_BASE_DIR not set in .env")
    Config.reset()
    config = Config(f"{test_base_dir}/data/configs/test_config.yaml")

    # Use dedicated index names so other modules that share cataloguesearch_pytest
    # cannot wipe this session's data mid-run.
    _orig_index = config._settings["opensearch"]["index_name"]
    _orig_meta_index = config._settings["opensearch"]["metadata_index_name"]
    config._settings["opensearch"]["index_name"] = "cataloguesearch_pytest_api"
    config._settings["opensearch"]["metadata_index_name"] = "cataloguesearch_pytest_api_metadata"

    setup(copy_ocr_files=True, add_scan_config=True)
    opensearch_client = get_opensearch_client(config)
    indices_to_delete = [config.OPENSEARCH_INDEX_NAME, config.OPENSEARCH_METADATA_INDEX_NAME]

    for index_name in indices_to_delete:
        if index_name and opensearch_client.indices.exists(index=index_name):
            opensearch_client.indices.delete(index=index_name)
            log_handle.info("Deleted existing index: %s", index_name)

    create_indices_if_not_exists(config, opensearch_client)
    log_handle.info("Created indices with proper mapping for vector search")

    pdf_processor = create_pdf_processor(config)
    discovery = Discovery(
        config,
        IndexGenerator(config, opensearch_client),
        IndexState(config.SQLITE_DB_PATH),
        pdf_processor,
    )
    log_handle.info("Starting discovery (CHUNK_STRATEGY=%s)", config.CHUNK_STRATEGY)
    discovery.crawl(process=False, index=True)

    doc_count = len(get_all_documents())
    log_handle.info("Indexed %d documents", doc_count)

    opensearch_client.indices.refresh(index=config.OPENSEARCH_INDEX_NAME)
    opensearch_client.indices.refresh(index=config.OPENSEARCH_METADATA_INDEX_NAME)

    yield

    for index_name in indices_to_delete:
        opensearch_client.indices.delete(index=index_name, ignore=[400, 404])

    config._settings["opensearch"]["index_name"] = _orig_index
    config._settings["opensearch"]["metadata_index_name"] = _orig_meta_index


@pytest.fixture(scope="session")
def api_server(build_index):
    """Session-scoped API server shared across all backend test modules."""
    server_manager = APIServerManager(host="127.0.0.1", port=19876)
    try:
        server_manager.start_server_in_thread()
        yield server_manager
    finally:
        server_manager.stop_server()
