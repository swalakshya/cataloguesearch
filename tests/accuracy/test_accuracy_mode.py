"""Request-scoped retrieval tests; no live models or OpenSearch required."""
import asyncio
import logging
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from starlette.requests import Request

from backend.api import search_api
from backend.api.agent import router as agent
from backend.search.index_searcher import IndexSearcher
from backend.api.auth.auth_api import _validate_settings_payload


@pytest.fixture(autouse=True)
def verbose_logging(monkeypatch):
    monkeypatch.setattr(logging.Logger, "verbose", logging.Logger.debug, raising=False)


@pytest.mark.parametrize("mode", ["vector", "rrf"])
@pytest.mark.parametrize("accuracy,expected", [(False, 40), (True, 100)])
def test_khoj_request_scopes_candidate_depth(monkeypatch, mode, accuracy, expected):
    app = FastAPI()
    app.post("/search")(search_api.search)
    app.state.config = SimpleNamespace(ACTIVE_CATEGORIES=["Granth"], SEARCH_MODE=mode, RERANK_OVERSAMPLE=40)
    app.state.embedding_model = Mock(get_embedding=Mock(return_value=[0.1]))
    searcher = Mock()
    searcher.perform_vector_search.return_value = ([], 0)
    searcher.perform_rrf_search.return_value = ([], 0)
    searcher.get_spelling_suggestions.return_value = []
    app.state.index_searcher = searcher
    app.state.metrics_store = Mock()
    response = TestClient(app).post("/search", json={"query": "आत्मा का स्वरूप क्या है?", "language": "hi",
        "accuracy_mode": accuracy, "search_types": {"Granth": {"enabled": True, "page_size": 10, "page_number": 1}}})
    assert response.status_code == 200
    call = searcher.perform_rrf_search.call_args if mode == "rrf" else searcher.perform_vector_search.call_args
    assert call.kwargs["oversample" if mode == "rrf" else "rerank_top_k"] == expected
    assert call.kwargs["rerank_timeout_seconds"] == (60 if accuracy else 40)
    assert app.state.config.RERANK_OVERSAMPLE == 40


@pytest.mark.parametrize("mode", ["vector", "rrf"])
@pytest.mark.parametrize("accuracy,expected", [(False, 40), (True, 100)])
def test_chat_agent_request_scopes_candidate_depth(monkeypatch, mode, accuracy, expected):
    config = SimpleNamespace(SEARCH_MODE=mode, OPENSEARCH_INDEX_NAME="unit-test",
        _agent_config={"rerank_oversample": 40, "rerank_batch_size": 4, "rerank_max_length": 512})
    hits = [{"_id": "a", "_score": 0.9, "_source": {"text_content_hindi": "उत्तर", "metadata": {}}}]
    client = Mock()
    client.search.return_value = {"hits": {"hits": hits}}
    reranker = Mock()
    reranker.predict.return_value = [0.8]
    state = SimpleNamespace(config=config, index_searcher=SimpleNamespace(_reranker=reranker),
        embedding_model=Mock(get_embedding=Mock(return_value=[0.1])), metrics_store=Mock(),
        shortener_store=Mock(), shortener_base_url="https://example.com")
    request = Request({"type": "http", "headers": [], "app": SimpleNamespace(state=state)})
    monkeypatch.setattr(agent, "get_opensearch_client", lambda _: client)
    monkeypatch.setattr(agent, "_shorten_results", lambda *args: None)
    response = asyncio.run(agent.agent_search(request, agent.AgentSearchRequest(query="आत्मा का स्वरूप क्या है?",
        language="hi", accuracy_mode=accuracy)))
    assert response.status_code == 200
    knn_call = next(c for c in client.search.call_args_list if "knn" in c.kwargs["body"]["query"])
    assert knn_call.kwargs["body"]["query"]["knn"]["vector_embedding"]["k"] == expected
    assert reranker.predict.call_args.kwargs["timeout_seconds"] == (60 if accuracy else 40)
    assert config._agent_config["rerank_oversample"] == 40


def test_partial_rerank_does_not_discard_the_search():
    searcher = IndexSearcher.__new__(IndexSearcher)
    searcher._config = SimpleNamespace(RERANK_BATCH_SIZE=4, RERANK_MAX_LENGTH=512)
    searcher._index_name = "unit-test"
    searcher._build_vector_query = Mock(return_value={})
    searcher._extract_results = lambda hits, **kwargs: hits
    searcher._reranker = Mock(predict=Mock(return_value=[0.7]))
    hits = [{"_id": str(i), "_source": {"text_content_hindi": "उत्तर"}} for i in range(3)]
    searcher._opensearch_client = Mock()
    searcher._opensearch_client.search.return_value = {"hits": {"hits": hits}}
    results, _ = searcher.perform_vector_search("query", [0.1], {}, 3, 1, "hi", rerank_top_k=100)
    assert [h["_id"] for h in results] == ["0", "1", "2"]


@pytest.mark.parametrize("rerank", [False, True])
@pytest.mark.parametrize("page", [1, 2])
def test_accuracy_keeps_page_size_when_reranking_is_unavailable(rerank, page):
    searcher = IndexSearcher.__new__(IndexSearcher)
    searcher._index_name = "unit-test"
    searcher._build_vector_query = Mock(return_value={})
    searcher._extract_results = lambda hits, **kwargs: hits
    searcher._reranker = None
    hits = [{"_id": str(i)} for i in range(100)]
    searcher._opensearch_client = Mock()
    searcher._opensearch_client.search.side_effect = lambda **kwargs: {
        "hits": {"hits": hits[kwargs["from_"]:kwargs["from_"] + kwargs["size"]],
                 "total": {"value": 100}}
    }
    results, _ = searcher.perform_vector_search("query", [0.1], {}, 20, page, "hi",
        rerank=rerank, rerank_top_k=100)
    offset = (page - 1) * 20
    assert [h["_id"] for h in results] == [str(i) for i in range(offset, offset + 20)]


def test_saved_chat_accuracy_setting_round_trips_without_a_schema_change():
    settings = _validate_settings_payload({"chatAccuracyMode": True, "answerFormat": "summary"}, ["Granth"])
    assert settings["chatAccuracyMode"] is True
