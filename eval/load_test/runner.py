"""asyncio load test engine. Drives /api/search via aiohttp, measures TTFB and total latency."""
import asyncio
import hashlib
import json
import logging
import os
import time
from dataclasses import dataclass, field
from typing import Any, Dict, Optional

import aiohttp

from eval.load_test import db, queries, stats

log = logging.getLogger(__name__)

_SEARCH_PATH = "/api/search"
_ADMIN_AUTH_PATH = "/api/admin/auth"
_ADMIN_CONFIG_PATH = "/api/admin/config"

# Search categories enabled for all load test queries
_SEARCH_TYPES = {
    "Pravachan": {"enabled": True, "page_size": 20, "page_number": 1},
    "Granth":    {"enabled": True, "page_size": 20, "page_number": 1},
    "Books":     {"enabled": True, "page_size": 20, "page_number": 1},
}


@dataclass
class LoadTestConfig:
    base_api_url: str = "http://localhost:8000"
    duration_seconds: int = 60
    warmup_seconds: int = 15
    max_concurrent: int = 10
    query_type: str = "rrf"          # lexical | rrf | mixed
    page_size: int = 20
    rerank_batch_size: int = 4
    rerank_block_size: int = 1500
    recall_size: int = 40
    request_timeout_seconds: int = 30
    run_name: str = ""
    query_file: Optional[str] = None  # None → default_queries.json
    extra: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "base_api_url": self.base_api_url,
            "duration_seconds": self.duration_seconds,
            "warmup_seconds": self.warmup_seconds,
            "max_concurrent": self.max_concurrent,
            "query_type": self.query_type,
            "page_size": self.page_size,
            "rerank_batch_size": self.rerank_batch_size,
            "rerank_block_size": self.rerank_block_size,
            "recall_size": self.recall_size,
            "request_timeout_seconds": self.request_timeout_seconds,
        }


class LoadTestRunner:
    def __init__(self, config: LoadTestConfig, run_id: str) -> None:
        self.config = config
        self.run_id = run_id
        self.stats = stats.Stats()
        self._abort = asyncio.Event()
        self._done = asyncio.Event()
        self._start_time: Optional[float] = None

    def abort(self) -> None:
        self._abort.set()

    def is_done(self) -> bool:
        return self._done.is_set()

    def elapsed(self) -> float:
        return time.monotonic() - self._start_time if self._start_time else 0.0

    def warmup_active(self) -> bool:
        return self.elapsed() < self.config.warmup_seconds

    def snapshot(self) -> Dict[str, Any]:
        return self.stats.snapshot(
            elapsed_seconds=max(0.0, self.elapsed() - self.config.warmup_seconds),
            warmup_active=self.warmup_active(),
            running=not self._done.is_set(),
        )

    # ------------------------------------------------------------------
    # Admin helpers
    # ------------------------------------------------------------------

    async def _admin_token(self, session: aiohttp.ClientSession) -> Optional[str]:
        admin_key = os.environ.get("ADMIN_KEY", "")
        if not admin_key:
            log.warning("ADMIN_KEY not set — skipping admin config changes")
            return None
        key_hash = hashlib.sha256(admin_key.encode()).hexdigest()
        url = self.config.base_api_url.rstrip("/") + _ADMIN_AUTH_PATH
        try:
            async with session.post(url, json={"key_hash": key_hash}) as resp:
                data = await resp.json()
                return data.get("token")
        except Exception as exc:
            log.warning("Admin auth failed: %s", exc)
            return None

    async def _fetch_effective_config(self, session: aiohttp.ClientSession, token: str) -> Optional[Dict]:
        url = self.config.base_api_url.rstrip("/") + _ADMIN_CONFIG_PATH
        headers = {"Authorization": f"Bearer {token}"}
        try:
            async with session.get(url, headers=headers) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    return data.get("effective")
        except Exception as exc:
            log.warning("Failed to fetch current admin config: %s", exc)
        return None

    async def _set_admin_config(self, session: aiohttp.ClientSession, token: str, updates: Dict) -> None:
        url = self.config.base_api_url.rstrip("/") + _ADMIN_CONFIG_PATH
        headers = {"Authorization": f"Bearer {token}"}
        try:
            async with session.post(url, json=updates, headers=headers) as resp:
                if resp.status != 200:
                    log.warning("Admin config update failed: HTTP %s", resp.status)
        except Exception as exc:
            log.warning("Admin config update error: %s", exc)

    async def _restore_defaults(self, session: aiohttp.ClientSession, token: str) -> None:
        url = self.config.base_api_url.rstrip("/") + _ADMIN_CONFIG_PATH
        headers = {"Authorization": f"Bearer {token}"}
        try:
            async with session.delete(url, headers=headers) as resp:
                if resp.status != 200:
                    log.warning("Admin config reset failed: HTTP %s", resp.status)
                else:
                    log.info("Admin config restored to defaults")
        except Exception as exc:
            log.warning("Admin config reset error: %s", exc)

    # ------------------------------------------------------------------
    # Single query execution
    # ------------------------------------------------------------------

    def _build_payload(self, query: str, query_type: str, query_id: str) -> Dict[str, Any]:
        search_types = {
            cat: {**cfg, "page_size": self.config.page_size}
            for cat, cfg in _SEARCH_TYPES.items()
        }
        return {
            "query": query,
            "language": "hindi",
            "text_search": query_type == "lexical",
            "search_types": search_types,
            "enable_reranking": True,
            "categories": {},
            "exclude_words": [],
            "query_id": query_id,
        }

    async def _run_query(
        self,
        session: aiohttp.ClientSession,
        query: str,
        query_type: str,
        is_warmup: bool,
    ) -> None:
        query_id = os.urandom(3).hex()
        url = self.config.base_api_url.rstrip("/") + _SEARCH_PATH
        payload = self._build_payload(query, query_type, query_id)
        timeout = aiohttp.ClientTimeout(total=self.config.request_timeout_seconds)
        ttfb_ms: Optional[float] = None
        total_ms: Optional[float] = None
        result_status = "ok"
        error_msg: Optional[str] = None

        t0 = time.monotonic()
        try:
            async with session.post(url, json=payload, timeout=timeout, headers={"X-Query-Source": "loadtest"}) as resp:
                resp.raise_for_status()
                # Use readline() — aiohttp's async for iterates chunks not lines
                while True:
                    raw_line = await resp.content.readline()
                    if not raw_line:
                        break
                    line = raw_line.decode("utf-8").strip()
                    if not line.startswith("data:"):
                        continue
                    try:
                        event = json.loads(line[5:].strip())
                    except json.JSONDecodeError:
                        continue
                    if ttfb_ms is None and event.get("type") == "category":
                        ttfb_ms = (time.monotonic() - t0) * 1000
                    if event.get("type") == "done":
                        total_ms = (time.monotonic() - t0) * 1000
                        break
                # Stream ended (with or without events) — always capture end time
                if total_ms is None:
                    total_ms = (time.monotonic() - t0) * 1000
        except asyncio.TimeoutError:
            result_status = "timeout"
            error_msg = f"Timeout after {self.config.request_timeout_seconds}s"
            log.warning("Query timeout after %ds: %s", self.config.request_timeout_seconds, query[:60])
        except Exception as exc:
            result_status = "error"
            error_msg = str(exc)[:200]
            log.warning("Query error (%s): %s", query[:60], error_msg)

        if not is_warmup:
            self.stats.record(ttfb_ms, total_ms, result_status)

        try:
            db.insert_query_result(
                run_id=self.run_id,
                query_id=query_id,
                query=query,
                query_type=query_type,
                ttfb_ms=ttfb_ms,
                total_latency_ms=total_ms,
                is_warmup=is_warmup,
                status=result_status,
                error_message=error_msg,
            )
        except Exception as exc:
            log.warning("Failed to persist query result: %s", exc)

    # ------------------------------------------------------------------
    # Main run loop
    # ------------------------------------------------------------------

    async def _worker(self, session: aiohttp.ClientSession, query_data: Dict, deadline: float) -> None:
        """Single worker coroutine: runs queries back-to-back until deadline or abort."""
        last_log = time.monotonic()
        while not self._abort.is_set() and time.monotonic() < deadline:
            query, query_type = queries.pick_query(query_data, self.config.query_type)
            is_warmup = self.warmup_active()
            await self._run_query(session, query, query_type, is_warmup)
            now = time.monotonic()
            if now - last_log >= 10:
                snap = self.snapshot()
                log.info(
                    "[%s] elapsed=%.0fs queries=%d qps=%.2f timeouts=%d errors=%d warmup=%s",
                    self.run_id[:8], self.elapsed(), snap["total_queries"],
                    snap["throughput_qps"], snap["timeouts"], snap["errors"],
                    snap["warmup_active"],
                )
                last_log = now

    async def run(self, query_data: Dict) -> None:
        cfg = self.config
        connector = aiohttp.TCPConnector(limit=cfg.max_concurrent + 4)
        try:
            async with aiohttp.ClientSession(connector=connector) as session:
                # Snapshot current config before touching anything
                token = await self._admin_token(session)
                if token:
                    effective = await self._fetch_effective_config(session, token)
                    if effective:
                        try:
                            db.save_pre_test_config(self.run_id, effective)
                            log.info("Pre-test config snapshot saved: %s", effective)
                        except Exception as exc:
                            log.warning("Failed to save pre-test config snapshot: %s", exc)

                    # Mark config as dirty BEFORE applying changes
                    try:
                        db.set_state("config_dirty", json.dumps({
                            "run_id": self.run_id,
                            "base_api_url": cfg.base_api_url,
                            "set_at": time.time(),
                        }))
                    except Exception as exc:
                        log.warning("Failed to set config_dirty state: %s", exc)

                    await self._set_admin_config(session, token, {
                        "rerank_batch_size": cfg.rerank_batch_size,
                        "rerank_max_length": cfg.rerank_block_size,
                        "rerank_oversample": cfg.recall_size,
                    })

                self._start_time = time.monotonic()
                deadline = self._start_time + cfg.duration_seconds

                try:
                    # Worker pool: exactly max_concurrent coroutines, each runs queries
                    # back-to-back. No semaphore needed — natural backpressure.
                    workers = [
                        asyncio.create_task(self._worker(session, query_data, deadline))
                        for _ in range(cfg.max_concurrent)
                    ]
                    await asyncio.gather(*workers, return_exceptions=True)

                finally:
                    # Always restore admin defaults and clear dirty flag
                    if token:
                        await self._restore_defaults(session, token)
                        try:
                            db.clear_state("config_dirty")
                        except Exception as exc:
                            log.warning("Failed to clear config_dirty state: %s", exc)

            final_status = "aborted" if self._abort.is_set() else "completed"
            try:
                db.update_run(self.run_id, final_status, self.snapshot())
            except Exception as exc:
                log.warning("Failed to persist final run state: %s", exc)
            log.info("Load test %s finished: %s", self.run_id, final_status)
        finally:
            self._done.set()  # always unblock the SSE generator
