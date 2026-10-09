import pytest
from backend.search.timings import capture_timings, timed_call

def test_nested_and_failed_operations_are_measured_without_leaking(monkeypatch):
    ticks = iter([1, 1.25, 2, 2.5])
    monkeypatch.setattr('backend.search.timings.time.perf_counter', lambda: next(ticks))
    @capture_timings
    def search():
        timed_call('retrieval', lambda: None)
        with pytest.raises(ValueError):
            timed_call('reranking', lambda: (_ for _ in ()).throw(ValueError()))
    stats = {}
    search(timings=stats)
    assert stats == {'retrieval': 250, 'reranking': 500}
    timed_call('retrieval', lambda: None)  # no active request means no measurement
