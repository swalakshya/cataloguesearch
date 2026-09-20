"""Turn what a job prints into real progress, so the UI shows bars instead of a wall of log.

Three sources, most to least authoritative:
  1. `@@PROGRESS {json}` marker lines, printed by our own scripts (create/restore snapshots) at each step.
  2. Tool-specific parsers (docker build output: "[service stage 4/9]" lines).
  3. In-place progress bars (pv, tqdm: "\\r"-terminated lines with "40%", "ETA", "111/300").

A step's progress is {"phase": {...}, "sub": {...}}:
  phase  where we are:   {"label", "index", "of", "done", "total", "unit"}  (index/of = "step 9 of 11")
  sub    live detail:    {"pct", "eta", "text"}                              (the current phase's own bar)
"""
import json
import re
from typing import Any, Dict, Optional

MARKER = "@@PROGRESS "

_PCT = re.compile(r"(?<![\d.])(\d{1,3}(?:\.\d+)?)\s?%")
_ETA = re.compile(r"ETA\s+(\d+:\d{2}(?::\d{2})?)")
_TQDM_ETA = re.compile(r"<\s*(\d+:\d{2}(?::\d{2})?)")
_COUNT = re.compile(r"(\d+)/(\d+)")


def parse_marker(line: str) -> Optional[Dict[str, Any]]:
    """`@@PROGRESS {"label": "...", "index": 3, "of": 11}` -> the dict, or None if it isn't one."""
    if not line.startswith(MARKER):
        return None
    try:
        data = json.loads(line[len(MARKER):])
    except ValueError:
        return None
    return data if isinstance(data, dict) else None


def parse_bar(text: str) -> Optional[Dict[str, Any]]:
    """Read a pv / tqdm style progress line. Only call this on in-place ("\\r") lines."""
    m = _PCT.search(text)
    if not m:
        return None
    pct = float(m.group(1))
    if not 0 <= pct <= 100:
        return None
    sub: Dict[str, Any] = {"pct": round(pct, 1), "text": re.sub(r"\s+", " ", text).strip()[:160]}
    eta = _ETA.search(text) or _TQDM_ETA.search(text)
    if eta:
        sub["eta"] = eta.group(1)
    return sub


# "#12 [cataloguesearch-api builder 3/7] RUN pip install ..."  /  "#9 [frontend 2/5] COPY ..."
_STAGE = re.compile(r"^#\d+ \[(?P<svc>[\w.-]+)(?: (?P<stage>[\w.-]+))? (?P<x>\d+)/(?P<y>\d+)\]")
_PUSHING = re.compile(r"^#\d+ .*(pushing|exporting to image|exporting layers)", re.IGNORECASE)


class DockerBuildProgress:
    """Follows `docker compose build --push` (plain output): build steps done of total, then pushing."""

    def __init__(self) -> None:
        self._stages: Dict[tuple, list] = {}  # (service, stage) -> [highest step seen, total steps]
        self._pushing = False

    def feed(self, line: str) -> Optional[Dict[str, Any]]:
        m = _STAGE.match(line)
        if m:
            key = (m["svc"], m["stage"] or "")
            x, y = int(m["x"]), int(m["y"])
            cur = self._stages.setdefault(key, [0, y])
            cur[0], cur[1] = max(cur[0], x), y
            done = sum(v[0] for v in self._stages.values())
            total = sum(v[1] for v in self._stages.values())
            # `total` only counts stages seen so far, so it can grow; that's fine for a "so far" bar
            return {"phase": {"label": f"Building {m['svc']}", "done": done, "total": total, "unit": "build steps"}}
        if not self._pushing and _PUSHING.match(line):
            self._pushing = True
            done = sum(v[1] for v in self._stages.values())
            return {"phase": {"label": "Exporting and pushing images", "done": done, "total": done, "unit": "build steps"}}
        return None
