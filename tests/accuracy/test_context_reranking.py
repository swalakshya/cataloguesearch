"""Context windows and batching without live models or OpenSearch."""
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from backend.search.context_reranking import enrich_hits, enrich_results, context_token_limit
from backend.config import ADMIN_PARAM_DEFAULTS


class Tokenizer:
    model_max_length = 512

    def encode(self, text, add_special_tokens=False):
        return list(text)

    def num_special_tokens_to_add(self, pair=True):
        return 4


def hit(doc, para, text, language="hi", lecture="1"):
    field = "text_content_gujarati" if language == "gu" else "text_content_hindi"
    return {"_id": f"{doc}_{language}_{para}", "_source": {
        "document_id": doc, "paragraph_id": para, field: text, "language": language,
        "original_filename": f"{doc}.pdf", "page_number": para,
        "metadata": {"Name": doc, "category": "Pravachan"},
        "chunk_labels": {"pravachan_number": lecture},
    }}


def enrich(hits, neighbours, language="hi", max_length=512):
    client = Mock()
    client.search.return_value = {"hits": {"hits": neighbours}}
    output = enrich_hits(hits, client, "index", language, "query", Tokenizer(), max_length)
    return output, client


def test_every_candidate_gets_both_neighbours_in_one_deduplicated_lookup():
    originals = [hit("doc", 2, "CENTRE"), hit("doc", 3, "OTHER")]
    output, client = enrich(originals, [hit("doc", 1, "BEFORE"), hit("doc", 4, "AFTER")])
    assert client.search.call_count == 1
    assert output[0]["_rerank_text"] == "BEFORE\nCENTRE\nOTHER"
    assert output[1]["_rerank_text"] == "CENTRE\nOTHER\nAFTER"
    assert output[0]["_rerank_context"]["previous"]["_id"] == "doc_hi_1"
    assert output[1]["_rerank_context"]["next"]["_source"]["page_number"] == 4
    assert "_rerank_text" not in originals[0], "do not mutate stored/source candidates"
    body = client.search.call_args.kwargs["body"]
    assert "vector_embedding" not in str(body["_source"])
    assert body["size"] == 2, "already-retrieved neighbours should not be fetched twice"


def test_context_window_keeps_centre_and_respects_real_token_limit():
    output, _ = enrich([hit("doc", 2, "CENTRE")],
        [hit("doc", 1, "B" * 700), hit("doc", 3, "A" * 700)], max_length=64)
    text = output[0]["_rerank_text"]
    assert "CENTRE" in text
    assert len(text) + len("query") + 4 <= 64
    assert text.startswith("B") and text.endswith("A")
    context = output[0]["_rerank_context"]
    assert context["previous"]["_source"]["text_content_hindi"] in text
    assert context["next"]["_source"]["text_content_hindi"] in text


def test_long_centre_takes_priority_and_long_query_is_bounded():
    original = hit("doc", 2, "C" * 900)
    output = enrich_hits([original], Mock(search=Mock(return_value={"hits": {"hits": []}})),
        "index", "hi", "Q" * 900, Tokenizer(), 1500)
    assert len(output[0]["_rerank_query"]) + len(output[0]["_rerank_text"]) + 4 <= 512
    assert output[0]["_rerank_text"].startswith("C")
    assert len(output[0]["_source"]["text_content_hindi"]) == 900


@pytest.mark.parametrize("neighbour", [hit("other", 1, "wrong document"),
    hit("doc", 1, "wrong language", "gu"), hit("doc", 1, "other lecture", lecture="2")])
def test_neighbours_cannot_cross_document_language_or_lecture(neighbour):
    output, _ = enrich([hit("doc", 2, "CENTRE")], [neighbour])
    assert output[0]["_rerank_text"] == "CENTRE"
    assert not output[0].get("_rerank_context")


def test_missing_paragraph_ids_and_lookup_failure_fall_back_to_central_text():
    missing = hit("doc", 2, "CENTRE")
    del missing["_source"]["paragraph_id"]
    output, client = enrich([missing], [])
    assert client.search.call_count == 0
    assert output[0]["_rerank_text"] == "CENTRE"
    client = Mock(search=Mock(side_effect=RuntimeError("unavailable")))
    output = enrich_hits([hit("doc", 2, "CENTRE")], client, "index", "hi", "q", Tokenizer(), 512)
    assert output[0]["_rerank_text"] == "CENTRE"


def test_gujarati_windows_use_gujarati_text():
    output, _ = enrich([hit("doc", 2, "મધ્ય", "gu")],
        [hit("doc", 1, "પહેલાં", "gu"), hit("doc", 3, "પછી", "gu")], language="gu")
    assert output[0]["_rerank_text"] == "પહેલાં\nમધ્ય\nપછી"


@pytest.mark.parametrize("language,expected", [("hindi", "hi"), ("gujarati", "gu")])
def test_khoj_language_names_are_normalized_for_neighbour_filters(language, expected):
    output, client = enrich([hit("doc", 2, "CENTRE", expected)],
        [hit("doc", 1, "BEFORE", expected)], language=language)
    assert {"term": {"language": expected}} in client.search.call_args.kwargs["body"]["query"]["bool"]["filter"]
    assert "BEFORE" in output[0]["_rerank_text"]


def test_rrf_fetches_original_sources_in_bulk_before_context_lookup():
    client = Mock()
    client.mget.return_value = {"docs": [dict(hit("doc", 2, "CENTRE"), found=True)]}
    client.search.return_value = {"hits": {"hits": [hit("doc", 1, "BEFORE")]}}
    results = [{"document_id": "doc_hi_2", "content_snippet": "highlight", "score": 0.4}]
    output = enrich_results(results, client, "index", "hi", "q", Tokenizer(), 512)
    assert client.mget.call_count == 1
    assert output[0]["_rerank_text"] == "BEFORE\nCENTRE"
    assert output[0]["document_id"] == "doc_hi_2"
    assert output[0]["score"] == 0.4


def test_flag_defaults_off_and_token_limit_is_capped_at_deployed_model():
    assert ADMIN_PARAM_DEFAULTS["context_reranking"] is False
    assert context_token_limit(Tokenizer(), 1500) == 512
    assert context_token_limit(Tokenizer(), 256) == 256

@pytest.mark.parametrize("mode", ["vector", "rrf"])
@pytest.mark.parametrize("enabled", [False, True])
def test_khoj_context_flag_controls_both_reranking_paths(mode, enabled):
    from backend.search.index_searcher import IndexSearcher
    searcher = IndexSearcher.__new__(IndexSearcher)
    searcher._config = SimpleNamespace(CONTEXT_RERANKING=enabled, RERANK_BATCH_SIZE=4, RERANK_MAX_LENGTH=1500)
    searcher._index_name = "index"
    searcher._metadata_prefix = "metadata"
    searcher._build_vector_query = Mock(return_value={"query": {"knn": {}}})
    centre = hit("doc", 2, "CENTRE")
    neighbours = [hit("doc", 1, "BEFORE"), hit("doc", 3, "AFTER")]
    client = Mock()
    client.search.side_effect = lambda **kwargs: {"hits": {"hits": neighbours if "_source" in kwargs["body"] else [centre]}}
    client.mget.return_value = {"docs": [dict(centre, found=True)]}
    searcher._opensearch_client = client
    searcher._reranker = Mock(tokenizer=Tokenizer(), predict=Mock(return_value=[0.5]))
    searcher.perform_category_search = Mock(return_value=([searcher._extract_results([centre], False, "hi")[0]], 1))
    if mode == "vector":
        results, _ = searcher.perform_vector_search("query", [0.1], {}, 10, 1, "hi")
    else:
        results, _ = searcher.perform_rrf_search("Pravachan", "query", False, [], {}, [0.1], "hi", 10, 1)
    pairs = searcher._reranker.predict.call_args.args[0]
    assert pairs[0][1] == ("BEFORE\nCENTRE\nAFTER" if enabled else "CENTRE")
    assert ("rerank_context" in results[0]) is enabled
    if enabled:
        assert results[0]["rerank_context"]["previous"]["document_id"] == "doc_hi_1"
        assert searcher._reranker.predict.call_args.kwargs["max_length"] == 512
    assert all(not key.startswith("_rerank_") for key in results[0]), "internal sources must not leak"
    assert client.search.call_count == (2 if enabled else 1)


@pytest.mark.parametrize("mode", ["vector", "rrf"])
@pytest.mark.parametrize("enabled", [False, True])
def test_chat_context_flag_controls_every_agent_reranking_path(monkeypatch, mode, enabled):
    import asyncio
    import json
    from starlette.requests import Request
    from backend.api.agent import router as agent
    centre = hit("doc", 2, "CENTRE")
    neighbours = [hit("doc", 1, "BEFORE"), hit("doc", 3, "AFTER")]
    client = Mock()
    client.search.side_effect = lambda **kwargs: {"hits": {"hits": neighbours if "_source" in kwargs["body"] else [centre]}}
    config = SimpleNamespace(SEARCH_MODE=mode, CONTEXT_RERANKING=enabled, OPENSEARCH_INDEX_NAME="index",
        _agent_config={"rerank_oversample": 40, "rerank_batch_size": 4, "rerank_max_length": 1500})
    reranker = Mock(tokenizer=Tokenizer(), predict=Mock(return_value=[0.5]))
    state = SimpleNamespace(config=config, index_searcher=SimpleNamespace(_reranker=reranker),
        embedding_model=Mock(get_embedding=Mock(return_value=[0.1])), metrics_store=Mock(),
        shortener_store=Mock(), shortener_base_url="https://example.com")
    request = Request({"type": "http", "headers": [], "app": SimpleNamespace(state=state)})
    monkeypatch.setattr(agent, "get_opensearch_client", lambda _: client)
    monkeypatch.setattr(agent, "_shorten_results", lambda *args: None)
    response = asyncio.run(agent.agent_search(request, agent.AgentSearchRequest(query="query", language="hi")))
    results = json.loads(response.body)
    assert reranker.predict.call_args.args[0][0][1] == ("BEFORE\nCENTRE\nAFTER" if enabled else "CENTRE")
    assert ("rerank_context" in results[0]) is enabled
    if enabled:
        assert results[0]["rerank_context"]["previous"]["chunk_id"] == "doc_hi_1"
        assert results[0]["rerank_context"]["previous"]["page_number"] == 1
        assert reranker.predict.call_args.kwargs["max_length"] == 512


def test_admin_flag_persists_and_resets_without_changing_agent_depth(tmp_path):
    import json
    from backend.config import Config
    config = object.__new__(Config)
    config._settings = {}
    config._overrides = {}
    config._agent_overrides = {}
    config._agent_config = config._build_agent_config()
    path = str(tmp_path / "overrides.json")
    assert config.CONTEXT_RERANKING is False
    config.update_overrides(path, {"context_reranking": True})
    assert config.CONTEXT_RERANKING is True
    assert json.loads((tmp_path / "overrides.json").read_text())["context_reranking"] is True
    assert config._agent_config["rerank_oversample"] == 40
    config.reset_overrides(path, "context_reranking")
    assert config.CONTEXT_RERANKING is False


def test_khoj_context_extraction_handles_neighbours_with_missing_filename():
    from backend.search.index_searcher import IndexSearcher
    searcher = IndexSearcher.__new__(IndexSearcher)
    searcher._metadata_prefix = "metadata"
    central = hit("doc", 2, "CENTRE")
    neighbour = hit("doc", 1, "BEFORE")
    del neighbour["_source"]["original_filename"]
    central["_rerank_context"] = {"previous": neighbour}
    result = searcher._extract_results([central], is_lexical=False, language="hi")[0]
    assert result["content_snippet"] == "CENTRE"
    assert result["rerank_context"]["previous"]["content_snippet"] == "BEFORE"
