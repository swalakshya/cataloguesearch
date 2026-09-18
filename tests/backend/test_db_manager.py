"""Unit tests for DbManager (scheduled SQLite maintenance)."""
import os
import sqlite3
from datetime import datetime, timezone

from backend.api.db.db_manager import CADENCE_SECONDS, DbManager, MaintenanceJob


def _at_utc_hour(hour: int) -> float:
    return datetime(2026, 1, 15, hour, 0, 0, tzinfo=timezone.utc).timestamp()


def test_creates_db_maintenance_table(tmp_path):
    db_path = str(tmp_path / "test.db")
    manager = DbManager(db_path)

    row = manager._conn.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'db_maintenance'"
    ).fetchone()
    assert row is not None

    manager.close()


def test_tick_runs_on_first_tick_then_withholds_until_cadence_elapses(tmp_path):
    db_path = str(tmp_path / "test.db")
    now = {"value": _at_utc_hour(10)}
    calls = {"count": 0}

    manager = DbManager(db_path, clock=lambda: now["value"])
    manager.register_job(MaintenanceJob(
        name="dailyJob", cadence="daily", run=lambda: calls.__setitem__("count", calls["count"] + 1),
    ))

    manager.tick()
    assert calls["count"] == 1

    now["value"] += 1
    manager.tick()
    assert calls["count"] == 1

    now["value"] += CADENCE_SECONDS["daily"]
    manager.tick()
    assert calls["count"] == 2

    manager.close()


def test_low_traffic_window_only_jobs_gated_by_hour(tmp_path):
    db_path = str(tmp_path / "test.db")
    now = {"value": _at_utc_hour(10)}
    calls = {"count": 0}

    manager = DbManager(db_path, clock=lambda: now["value"])
    manager.register_job(MaintenanceJob(
        name="vacuumJob", cadence="daily", low_traffic_window_only=True,
        run=lambda: calls.__setitem__("count", calls["count"] + 1),
    ))

    manager.tick()
    assert calls["count"] == 0, "should not run outside the low-traffic window"

    now["value"] = _at_utc_hour(22)
    manager.tick()
    assert calls["count"] == 1, "should run once inside the low-traffic window"

    manager.close()


def test_low_traffic_window_wraps_past_midnight(tmp_path):
    db_path = str(tmp_path / "test.db")
    now = {"value": _at_utc_hour(10)}

    manager = DbManager(db_path, clock=lambda: now["value"], low_traffic_start_hour=22, low_traffic_end_hour=4)

    assert manager._in_low_traffic_window(_at_utc_hour(10)) is False
    assert manager._in_low_traffic_window(_at_utc_hour(23)) is True
    assert manager._in_low_traffic_window(_at_utc_hour(2)) is True
    assert manager._in_low_traffic_window(_at_utc_hour(4)) is False
    assert manager._in_low_traffic_window(_at_utc_hour(21)) is False

    manager.close()


def test_last_run_state_survives_restart(tmp_path):
    db_path = str(tmp_path / "test.db")
    t0 = _at_utc_hour(10)

    first_calls = {"count": 0}
    first = DbManager(db_path, clock=lambda: t0)
    first.register_job(MaintenanceJob(
        name="dailyJob", cadence="daily", run=lambda: first_calls.__setitem__("count", first_calls["count"] + 1),
    ))
    first.tick()
    assert first_calls["count"] == 1
    first.close()

    soon_after = t0 + 1
    second_calls = {"count": 0}
    second = DbManager(db_path, clock=lambda: soon_after)
    second.register_job(MaintenanceJob(
        name="dailyJob", cadence="daily", run=lambda: second_calls.__setitem__("count", second_calls["count"] + 1),
    ))
    second.tick()
    assert second_calls["count"] == 0, "fresh instance should honor persisted last_run_at"
    second.close()

    much_later = t0 + CADENCE_SECONDS["daily"]
    third_calls = {"count": 0}
    third = DbManager(db_path, clock=lambda: much_later)
    third.register_job(MaintenanceJob(
        name="dailyJob", cadence="daily", run=lambda: third_calls.__setitem__("count", third_calls["count"] + 1),
    ))
    third.tick()
    assert third_calls["count"] == 1, "a stale last_run_at should allow the job to run again"
    third.close()


def test_vacuum_shrinks_bloated_database_file(tmp_path):
    db_path = str(tmp_path / "test.db")
    manager = DbManager(db_path)

    manager._conn.execute("CREATE TABLE bloat (data TEXT)")
    big_blob = "x" * 10_000
    manager._conn.executemany(
        "INSERT INTO bloat (data) VALUES (?)", [(big_blob,) for _ in range(500)]
    )
    manager._conn.commit()
    manager._conn.execute("DELETE FROM bloat")
    manager._conn.commit()

    size_before = os.path.getsize(db_path)
    manager.vacuum()
    size_after = os.path.getsize(db_path)

    assert size_after < size_before * 0.5, f"expected vacuum to shrink the file ({size_before} -> {size_after})"

    manager.close()
