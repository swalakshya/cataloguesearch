"""In-memory latency statistics. No numpy — uses bisect for O(log n) inserts."""
import bisect
import math
from typing import Dict, List, Optional


class Stats:
    def __init__(self) -> None:
        self._ttfb: List[float] = []
        self._total: List[float] = []
        self.timeouts: int = 0
        self.errors: int = 0

    def record(self, ttfb_ms: Optional[float], total_ms: Optional[float], result_status: str) -> None:
        if result_status == "timeout":
            self.timeouts += 1
            return
        if result_status == "error":
            self.errors += 1
            return
        if ttfb_ms is not None:
            bisect.insort(self._ttfb, ttfb_ms)
        if total_ms is not None:
            bisect.insort(self._total, total_ms)

    def _percentile(self, sorted_list: List[float], p: float) -> Optional[float]:
        n = len(sorted_list)
        if n == 0:
            return None
        idx = min(math.ceil(p * n) - 1, n - 1)
        return round(sorted_list[max(idx, 0)], 2)

    def _mean(self, lst: List[float]) -> Optional[float]:
        if not lst:
            return None
        return round(sum(lst) / len(lst), 2)

    def _summarise(self, lst: List[float]) -> Dict:
        return {
            "mean":  self._mean(lst),
            "p95":   self._percentile(lst, 0.95),
            "p99":   self._percentile(lst, 0.99),
            "p999":  self._percentile(lst, 0.999),
        }

    def snapshot(self, elapsed_seconds: float, warmup_active: bool, running: bool) -> Dict:
        n = len(self._total)
        qps = round(n / elapsed_seconds, 2) if elapsed_seconds > 0 and not warmup_active else 0.0
        return {
            "elapsed_seconds": round(elapsed_seconds, 1),
            "warmup_active": warmup_active,
            "total_queries": n,
            "throughput_qps": qps,
            "ttfb": self._summarise(self._ttfb),
            "total_latency": self._summarise(self._total),
            "timeouts": self.timeouts,
            "errors": self.errors,
            "status": "running" if running else "completed",
        }
