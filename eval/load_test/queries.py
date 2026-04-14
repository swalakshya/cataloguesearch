"""Load and validate query files for the load test."""
import json
import os
import random
from typing import Dict, List, Optional, Tuple

_DEFAULT_PATH = os.path.join(os.path.dirname(__file__), "default_queries.json")


def load_queries(path: Optional[str] = None) -> Dict[str, List[str]]:
    target = path or _DEFAULT_PATH
    with open(target, encoding="utf-8") as fh:
        data = json.load(fh)
    validate(data)
    return data


def validate(data: object) -> None:
    if not isinstance(data, dict):
        raise ValueError("Query file must be a JSON object")
    for key in ("lexical_queries", "rrf_queries"):
        if key not in data:
            raise ValueError(f"Missing required key: '{key}'")
        if not isinstance(data[key], list):
            raise ValueError(f"'{key}' must be a list of strings")
        if not data[key]:
            raise ValueError(f"'{key}' must not be empty")
        if not all(isinstance(q, str) and q.strip() for q in data[key]):
            raise ValueError(f"All entries in '{key}' must be non-empty strings")


def pick_query(queries: Dict[str, List[str]], query_type: str) -> Tuple[str, str]:
    """Return (query_string, actual_type). For 'mixed', picks randomly from both lists."""
    if query_type == "lexical":
        return random.choice(queries["lexical_queries"]), "lexical"
    if query_type == "rrf":
        return random.choice(queries["rrf_queries"]), "rrf"
    # mixed
    pool = [("lexical", q) for q in queries["lexical_queries"]] + \
           [("rrf", q) for q in queries["rrf_queries"]]
    qt, q = random.choice(pool)
    return q, qt
