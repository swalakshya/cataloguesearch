"""Scheduled SQLite maintenance (prune/VACUUM) run in-process, not via host cron.

Last-run state is persisted in the DB itself (db_maintenance table) so
cadence survives a redeploy -- a naive sleep-loop would drift or
double/skip-run jobs across restarts.
"""
import asyncio
import logging
import os
import sqlite3
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Callable, List, Optional

log_handle = logging.getLogger(__name__)

CADENCE_SECONDS = {"daily": 24 * 60 * 60, "weekly": 7 * 24 * 60 * 60}
TICK_INTERVAL_SECONDS = 60 * 60


@dataclass
class MaintenanceJob:
    name: str
    cadence: str
    run: Callable[[], None]
    low_traffic_window_only: bool = False


class DbManager:
    def __init__(
        self,
        db_path: str,
        *,
        clock: Callable[[], float] = None,
        tick_interval_seconds: int = TICK_INTERVAL_SECONDS,
        low_traffic_start_hour: int = None,
        low_traffic_end_hour: int = None,
    ):
        self.db_path = str(db_path)
        self.clock = clock or time.time
        self.tick_interval_seconds = tick_interval_seconds
        self.low_traffic_start_hour = (
            low_traffic_start_hour
            if low_traffic_start_hour is not None
            else int(os.environ.get("DB_MAINTENANCE_LOW_TRAFFIC_START_HOUR", "21"))
        )
        self.low_traffic_end_hour = (
            low_traffic_end_hour
            if low_traffic_end_hour is not None
            else int(os.environ.get("DB_MAINTENANCE_LOW_TRAFFIC_END_HOUR", "23"))
        )
        self.jobs: List[MaintenanceJob] = []
        self._task: Optional[asyncio.Task] = None

        os.makedirs(os.path.dirname(os.path.abspath(self.db_path)), exist_ok=True)
        self._conn = sqlite3.connect(self.db_path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA journal_mode = WAL")
        self._conn.execute("PRAGMA synchronous = NORMAL")
        self._conn.executescript("""
            CREATE TABLE IF NOT EXISTS db_maintenance (
                job_name    TEXT PRIMARY KEY,
                last_run_at INTEGER NOT NULL
            );
        """)

    def register_job(self, job: MaintenanceJob) -> None:
        if job.cadence not in CADENCE_SECONDS:
            raise ValueError(f"unknown cadence: {job.cadence}")
        self.jobs.append(job)

    def vacuum(self) -> None:
        self._conn.execute("VACUUM")
        # In WAL mode (both MetricsStore and UsersStore run WAL), VACUUM alone
        # rewrites the file's internal page layout but does not shrink the
        # file on disk -- a checkpoint is required to actually reclaim space.
        self._conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")

    def _in_low_traffic_window(self, now: float) -> bool:
        hour = datetime.fromtimestamp(now, tz=timezone.utc).hour
        start, end = self.low_traffic_start_hour, self.low_traffic_end_hour
        if start <= end:
            return start <= hour < end
        # Window wraps past midnight (e.g. 22 -> 4): "in window" means at or
        # after start OR before end, not a plain start<=hour<end range.
        return hour >= start or hour < end

    def _should_run(self, job: MaintenanceJob, now: float) -> bool:
        if job.low_traffic_window_only and not self._in_low_traffic_window(now):
            return False
        row = self._conn.execute(
            "SELECT last_run_at FROM db_maintenance WHERE job_name = ?", (job.name,)
        ).fetchone()
        if row is None:
            return True
        return now - row["last_run_at"] >= CADENCE_SECONDS[job.cadence]

    def _run_job(self, job: MaintenanceJob, now: float) -> None:
        try:
            job.run()
            self._conn.execute(
                "INSERT INTO db_maintenance (job_name, last_run_at) VALUES (?, ?) "
                "ON CONFLICT(job_name) DO UPDATE SET last_run_at = excluded.last_run_at",
                (job.name, now),
            )
            self._conn.commit()
            log_handle.info("db_maintenance_job_ran job=%s", job.name)
        except Exception:
            log_handle.exception("db_maintenance_job_failed job=%s", job.name)

    def tick(self) -> None:
        now = self.clock()
        for job in self.jobs:
            if self._should_run(job, now):
                self._run_job(job, now)

    async def run_forever(self) -> None:
        # tick() can run VACUUM, a blocking sqlite call that can take real
        # time once the DB is large -- offloaded to a thread so it doesn't
        # stall the event loop (and every concurrent request) for that
        # duration. Safe because self._conn was opened with
        # check_same_thread=False.
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(None, self.tick)
        while True:
            await asyncio.sleep(self.tick_interval_seconds)
            await loop.run_in_executor(None, self.tick)

    def start(self) -> asyncio.Task:
        self._task = asyncio.create_task(self.run_forever())
        return self._task

    async def shutdown(self) -> None:
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        self._conn.close()

    def close(self) -> None:
        self._conn.close()
