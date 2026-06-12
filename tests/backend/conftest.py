import logging
import os
import shutil
import subprocess
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import pytest
import requests
from dotenv import load_dotenv

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
def bookmark_cache():
    """
    Session-scoped bookmark cache for CachedBookmarkExtractor.

    Shared across ALL backend tests. Cache key = extractor_type + hash(bookmark titles),
    so it self-invalidates when bookmarks change.
    """
    cache = {}
    yield cache
    log_handle.info("Bookmark cache statistics: %d entries", len(cache))


@pytest.fixture(scope="session", autouse=True)
def enable_bookmark_caching_for_tests(bookmark_cache):
    """
    Monkey-patch the bookmark extractor factory at session start so every
    extractor created during tests is wrapped with CachedBookmarkExtractor.
    """
    from tests.backend.bookmark_cache_helper import enable_bookmark_caching, disable_bookmark_caching

    enable_bookmark_caching(bookmark_cache)
    yield
    disable_bookmark_caching()


@pytest.fixture(scope="session", autouse=True)
def prewarm_bookmark_cache(enable_bookmark_caching_for_tests):
    """
    Pre-warm the bookmark cache in parallel at session start.

    Mirrors exactly what common.py:setup() + discovery.crawl() does:
    - All 12 PDFs are copied from source (preserving original bookmarks)
    - 4 of them get their TOC replaced with test bookmarks (same as setup())
    - parse_bookmarks() is called using create_bookmark_extractor(config) — the
      same code path as discovery.py — so cache keys match exactly.

    Subsequent crawl calls get instant cache hits instead of waiting for Gemini.
    """
    _TESTS_ROOT = Path(__file__).parent.parent
    load_dotenv(dotenv_path=_TESTS_ROOT / ".env")
    test_base_dir = os.getenv("TEST_BASE_DIR")
    if not test_base_dir:
        log_handle.warning("TEST_BASE_DIR not set — skipping bookmark cache pre-warm")
        return

    from backend.config import Config
    from backend.crawler.bookmark_extractor.factory import create_bookmark_extractor
    from tests.backend.common import add_bookmarks_to_pdf

    Config.reset()
    config = Config(os.path.join(test_base_dir, "data", "configs", "test_config.yaml"))

    data_pdf_path = os.path.join(test_base_dir, "data", "pdfs")

    # All 12 PDFs discovery.crawl() will process, with the TOC replacements that
    # common.py:setup(add_bookmarks=True) makes on 4 of them.
    # None → keep original 5 bookmarks from PDF; list → replace TOC with these.
    all_pdfs = [
        ("bangalore_hindi.pdf",    None),
        ("bangalore_gujarati.pdf", None),
        ("hampi_hindi.pdf",        [(2, "prav number 248, 1985-10-23"),         (4, "Prav 324. Date 24-05-1986")]),
        ("hampi_gujarati.pdf",     None),
        ("indore_hindi.pdf",       None),
        ("indore_gujarati.pdf",    [(2, "pr number 28, 1982-10-23"),            (4, "Prav 324. Date 24-05-1982")]),
        ("jaipur_hindi.pdf",       [(1, "Pravachan Num 10 on Date 03-05-1986"),(5, "Pravachan Num 12 on Date 04-06-1987")]),
        ("jaipur_gujarati.pdf",    None),
        ("songadh_hindi.pdf",      None),
        ("songadh_gujarati.pdf",   None),
        ("thanjavur_hindi.pdf",    None),
        ("thanjavur_gujarati.pdf", [(2, "Pravachan Num 15 on Date 06-05-1980"),(3, "Pravachan Num 18 on Date 04-06-1983")]),
    ]

    def prewarm_one(pdf_name, bookmark_override):
        src_path = os.path.join(data_pdf_path, pdf_name)
        if not os.path.exists(src_path):
            log_handle.warning("Pre-warm: PDF not found: %s", src_path)
            return

        tmp = tempfile.mktemp(suffix=f"_prewarm_{pdf_name}")
        try:
            shutil.copy(src_path, tmp)
            if bookmark_override is not None:
                add_bookmarks_to_pdf(tmp, bookmark_override)
            extractor = create_bookmark_extractor(config)
            result = extractor.parse_bookmarks(tmp)
            log_handle.info("Pre-warm: %s → %d bookmarks cached", pdf_name, len(result))
        except Exception as e:
            log_handle.warning("Pre-warm: failed for %s: %s", pdf_name, e)
        finally:
            if os.path.exists(tmp):
                os.remove(tmp)

    log_handle.info("Pre-warming bookmark cache for %d PDFs (4 workers)...", len(all_pdfs))
    with ThreadPoolExecutor(max_workers=4) as executor:
        futures = {executor.submit(prewarm_one, name, bms): name for name, bms in all_pdfs}
        for future in as_completed(futures):
            future.result()
    log_handle.info("Bookmark cache pre-warm complete.")


@pytest.fixture(scope="session")
def build_index(prewarm_bookmark_cache):
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
