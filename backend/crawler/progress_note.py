"""One-line "where am I" notes for the Discover UI.

The Discover runner (deploy/runner.py) starts discovery_cli.py as a subprocess and understands lines of
the form `@@PROGRESS {json}` (see deploy/progress.py). It sets EMIT_PROGRESS_NOTES=1 for that subprocess;
plain CLI runs leave it unset and print nothing extra.
"""
import json
import os

_MARKER = "@@PROGRESS "  # same string as deploy.progress.MARKER (backend must not import deploy)


def emit_progress_note(text: str) -> None:
    if os.environ.get("EMIT_PROGRESS_NOTES") == "1":
        print(_MARKER + json.dumps({"note": text}, ensure_ascii=False), flush=True)
