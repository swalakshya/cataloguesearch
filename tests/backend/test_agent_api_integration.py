import os
import time
from urllib.parse import urlparse

import pytest
import requests


def _api_base_url() -> str:
    # The API typically runs locally over plain HTTP.
    # Users can override this with EXTERNAL_API_BASE_URL (e.g. https://... in prod).
    return os.getenv("EXTERNAL_API_BASE_URL", "http://localhost:8000")


def _should_verify_tls(base_url: str) -> bool:
    """
    Whether `requests` should verify TLS certificates.

    - If EXTERNAL_API_VERIFY_TLS is set, it takes precedence.
    - Otherwise, verify TLS only for https URLs.
    """
    verify_env = os.getenv("EXTERNAL_API_VERIFY_TLS")
    if verify_env is not None:
        return verify_env.lower() in ("1", "true", "yes")
    return urlparse(base_url).scheme == "https"


@pytest.fixture(scope="module")
def api_base_url():
    base_url = _api_base_url().rstrip("/")
    verify_tls = _should_verify_tls(base_url)
    deadline = time.time() + 10
    last_exc = None
    while time.time() < deadline:
        try:
            r = requests.get(
                f"{base_url}/api/metadata",
                timeout=1,
                verify=verify_tls,
            )
            if r.status_code in (200, 404, 500):
                return base_url
        except requests.exceptions.RequestException as exc:
            last_exc = exc
        time.sleep(0.5)
    pytest.skip(f"API server not reachable at {base_url}: {last_exc}")


def _agent_search(base_url, query, content_type=None):
    payload = {
        "query": query,
        "language": "hi",
        "content_type": content_type if content_type is not None else ["Granth", "Books"],
        "page_size": 5,
        "page": 1,
        "rerank": False,
    }
    verify_tls = _should_verify_tls(base_url)
    r = requests.post(
        f"{base_url}/api/agent/search",
        json=payload,
        verify=verify_tls,
    )
    assert r.status_code == 200
    return r.json()


class TestAgentAPI:
    """Agent API integration tests against a running cataloguesearch-api container."""

    def test_agent_search_returns_list(self, api_base_url):
        results = _agent_search(api_base_url, "भगवान आत्मा")
        assert isinstance(results, list)

    def test_agent_search_fields_when_present(self, api_base_url):
        results = _agent_search(api_base_url, "भगवान आत्मा")
        if not results:
            pytest.skip("No results returned; OpenSearch may be empty")
        for field in (
            "chunk_id",
            "text_content",
            "category",
            "granth",
            "anuyog",
            "language",
            "page_number",
            "file_url",
            "score",
        ):
            assert field in results[0]

    def test_agent_navigate_includes_current(self, api_base_url):
        results = _agent_search(api_base_url, "भगवान आत्मा")
        if not results:
            pytest.skip("No results returned; OpenSearch may be empty")
        chunk_id = results[0]["chunk_id"]

        payload = {"chunk_id": chunk_id, "direction": "both", "steps": 1}
        r = requests.post(
            f"{api_base_url}/api/agent/navigate",
            json=payload,
            verify=_should_verify_tls(api_base_url),
        )
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        assert any(item.get("chunk_id") == chunk_id for item in data)

    # def test_agent_find_similar_returns_list(self, api_base_url):
    #     results = _agent_search(api_base_url, "भगवान आत्मा")
    #     if not results:
    #         pytest.skip("No results returned; OpenSearch may be empty")
    #     chunk_id = results[0]["chunk_id"]

    #     payload = {"chunk_id": chunk_id}
    #     r = requests.post(
    #         f"{api_base_url}/api/agent/find_similar",
    #         json=payload,
    #         verify=_should_verify_tls(api_base_url),
    #     )
    #     assert r.status_code == 200
    #     data = r.json()
    #     assert isinstance(data, list)

    def test_agent_get_filter_options(self, api_base_url):
        payload = {"language": "hi", "content_type": "Granth"}
        r = requests.post(
            f"{api_base_url}/api/agent/get_filter_options",
            json=payload,
            verify=_should_verify_tls(api_base_url),
        )
        assert r.status_code == 200
        data = r.json()
        for key in ("granths", "anuyogs", "contributors", "date_ranges"):
            assert key in data
        assert isinstance(data["granths"], list)

    def test_agent_get_pravachan_returns_list(self, api_base_url):
        payload = {"granth": "Samaysaar", "pravachan_number": "1", "language": "hi"}
        r = requests.post(
            f"{api_base_url}/api/agent/get_pravachan",
            json=payload,
            verify=_should_verify_tls(api_base_url),
        )
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)