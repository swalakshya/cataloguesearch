"""Request-local monotonic measurements; no timing state on shared searchers."""
import time
from contextvars import ContextVar
from functools import wraps

_current = ContextVar('search_timings', default=None)


def timed_call(operation, fn, *args, **kwargs):
    timings = _current.get()
    if timings is None:
        return fn(*args, **kwargs)
    return measure(timings, operation, fn, *args, **kwargs)


def measure(timings, operation, fn, *args, **kwargs):
    started = time.perf_counter()
    try:
        return fn(*args, **kwargs)
    finally:
        timings[operation] = timings.get(operation, 0) + round((time.perf_counter() - started) * 1000, 2)


def capture_timings(fn):
    @wraps(fn)
    def wrapped(*args, **kwargs):
        timings = kwargs.pop('timings', None)
        if timings is None:
            return fn(*args, **kwargs)
        token = _current.set(timings)
        try:
            return fn(*args, **kwargs)
        finally:
            _current.reset(token)
    return wrapped
