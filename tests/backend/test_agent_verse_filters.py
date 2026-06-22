from backend.api.agent.router import AgentSearchRequest, _build_filters


def _has_term(filters, field, value):
    return {"term": {field: value}} in filters


def test_build_filters_adds_verse_filters():
    payload = AgentSearchRequest(
        query="मोक्ष",
        language="hi",
        granth="Atmanushashan",
        shlok="42",
    )
    filters = _build_filters(payload)
    assert _has_term(filters, "metadata.Name.keyword", "Atmanushashan")
    assert _has_term(filters, "chunk_labels.shlok", "42")


def test_build_filters_supports_all_verse_fields():
    payload = AgentSearchRequest(
        query="q",
        language="hi",
        gatha="1",
        shlok="2",
        doha="3",
        kavya="4",
        sutra="5",
    )
    filters = _build_filters(payload)
    assert _has_term(filters, "chunk_labels.gatha", "1")
    assert _has_term(filters, "chunk_labels.shlok", "2")
    assert _has_term(filters, "chunk_labels.doha", "3")
    assert _has_term(filters, "chunk_labels.kavya", "4")
    assert _has_term(filters, "chunk_labels.sutra", "5")


def test_build_filters_omits_absent_verse_filters():
    payload = AgentSearchRequest(query="q", language="hi", granth="Samaysaar")
    filters = _build_filters(payload)
    chunk_label_filters = [
        f for f in filters
        if "term" in f and any(k.startswith("chunk_labels.") for k in f["term"])
    ]
    assert chunk_label_filters == []
