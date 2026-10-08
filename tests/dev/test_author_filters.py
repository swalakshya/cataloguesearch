from backend.common.author_filters import filter_categories_for, group_authors


def test_groups_follow_catalogue_category_language_and_deduplicate():
    rows = [
        {"category": "Granth", "language": "hi", "author": "Shared"},
        {"category": "Granth", "language": "hi", "author": "Shared"},
        {"category": "Books", "language": "hi", "author": "Shared"},
        {"category": "Books", "language": "gu", "author": ["Gujarati", ""]},
        {"category": "Pravachan", "language": "hi", "author": "Speaker"},
        {"category": "Granth", "author": None},
    ]
    assert group_authors(rows) == {"Granth": {"hi": ["Shared"], "gu": []}, "Books": {"hi": ["Shared"], "gu": ["Gujarati"]}}


def test_scoped_authors_do_not_cross_categories():
    filters = {"_granth_authors": ["Acharya"], "_books_authors": ["Scholar"], "Name": ["Work"], "Series": ["Series"]}
    assert filter_categories_for("Granth", filters) == {"Author": ["Acharya"], "Name": ["Work"]}
    assert filter_categories_for("Books", filters) == {"Author": ["Scholar"], "Name": ["Work"]}
    assert filter_categories_for("Pravachan", filters) == {"Series": ["Series"]}
    assert filter_categories_for("Other", filters) == {"Name": ["Work"], "Series": ["Series"]}


def test_existing_author_filter_remains_supported():
    filters = {"Author": ["Legacy"], "_granth_authors": ["Acharya"]}
    assert filter_categories_for("Books", filters) == {"Author": ["Legacy"]}
    assert filter_categories_for("Granth", filters) == {"Author": ["Acharya"]}
    assert filter_categories_for("Pravachan", filters) == {}


def test_authors_endpoint_refreshes_with_shared_catalogue_cache(monkeypatch):
    from fastapi.testclient import TestClient
    from backend.api import search_api
    from types import SimpleNamespace
    rows = [{"category": "Granth", "language": "hi", "author": "First"}]
    calls = []
    def fetch(config):
        calls.append(config)
        return list(rows)
    monkeypatch.setattr(search_api, "get_catalogue", fetch)
    monkeypatch.setattr(search_api.app.state, "config", SimpleNamespace(), raising=False)
    monkeypatch.setattr(search_api.app.state, "catalogue_cache", {"data": None, "timestamp": 0, "ttl": 1800}, raising=False)
    client = TestClient(search_api.app)
    assert client.get('/api/authors').json()['Granth']['hi'] == ['First']
    assert client.get('/api/catalogue').json() == rows
    assert len(calls) == 1
    rows.append({"category": "Books", "language": "hi", "author": "New scholar"})
    search_api.app.state.catalogue_cache['timestamp'] = 0
    assert client.get('/api/authors').json()['Books']['hi'] == ['New scholar']
    assert len(calls) == 2


def test_every_search_mode_receives_only_its_scoped_authors():
    import asyncio
    from backend.api.search_api import _search_category
    from types import SimpleNamespace
    calls = []
    def search(**kwargs):
        calls.append(kwargs)
        return [], 0
    searcher = SimpleNamespace(perform_rrf_search=search, perform_category_search=search, perform_vector_search=search)
    async def run():
        for mode, lexical in [('rrf', None), ('lexical', True), ('vector', False)]:
            for category in ['Granth', 'Books']:
                await _search_category(asyncio.get_running_loop(), searcher, category, {}, 'query', False, [],
                    {'_granth_authors': ['Acharya'], '_books_authors': ['Scholar']}, 'hindi', mode, lexical,
                    None, False, 20, None, None)
                assert calls[-1]['categories']['Author'] == (['Acharya'] if category == 'Granth' else ['Scholar'])
                assert not any(key.startswith('_') for key in calls[-1]['categories'])
    asyncio.run(run())
