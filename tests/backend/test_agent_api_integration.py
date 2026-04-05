import pytest
import requests


@pytest.fixture(scope="module", autouse=True)
def _require_index(build_index):
    """Pull the session-scoped build_index into this module."""


@pytest.fixture(scope="module")
def api_base_url(api_server):
    return f"http://{api_server.host}:{api_server.port}"


def _agent_search(base_url, query, content_type=None):
    payload = {
        "query": query,
        "language": "hi",
        "content_type": content_type if content_type is not None else ["Granth", "Books"],
        "page_size": 5,
        "page": 1,
        "rerank": False,
    }
    r = requests.post(f"{base_url}/api/agent/search", json=payload)
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
        assert isinstance(results[0]["file_url"], str)

    def test_agent_navigate_includes_current(self, api_base_url):
        results = _agent_search(api_base_url, "भगवान आत्मा")
        if not results:
            pytest.skip("No results returned; OpenSearch may be empty")
        chunk_id = results[0]["chunk_id"]

        payload = {"chunk_id": chunk_id, "direction": "both", "steps": 1}
        r = requests.post(f"{api_base_url}/api/agent/navigate", json=payload)
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
    #             #     )
    #     assert r.status_code == 200
    #     data = r.json()
    #     assert isinstance(data, list)

    def test_agent_get_filter_options(self, api_base_url):
        payload = {"language": "hi", "content_type": "Granth"}
        r = requests.post(f"{api_base_url}/api/agent/get_filter_options", json=payload)
        assert r.status_code == 200
        data = r.json()
        for key in ("granths", "anuyogs", "contributors", "date_ranges"):
            assert key in data
        assert isinstance(data["granths"], list)

    def test_agent_get_metadata_options(self, api_base_url):
        payload = {"language": "hi", "content_type": "Pravachan"}
        r = requests.post(f"{api_base_url}/api/agent/get_metadata_options", json=payload)
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        if data:
            for item in data:
                assert "granth" in item
                assert "author" in item
                assert "anuyog" in item
                assert "url" in item
                assert isinstance(item["url"], str)

    def test_agent_get_pravachan_returns_list(self, api_base_url):
        payload = {"granth": "Samaysaar", "pravachan_number": "1", "language": "hi"}
        r = requests.post(f"{api_base_url}/api/agent/get_pravachan", json=payload)
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)

    def test_agent_search_file_url_is_short(self, api_base_url):
        results = _agent_search(api_base_url, "भगवान आत्मा")
        if not results:
            pytest.skip("No results returned; OpenSearch may be empty")
        file_url = results[0].get("file_url")
        if not file_url:
            pytest.skip("Search result missing file_url; shortener store may be empty")
        assert "/url/" in file_url, f"Expected a short URL containing /url/, got: {file_url}"
