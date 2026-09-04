import hashlib
import logging
import os
import threading
from pathlib import Path
from urllib.parse import urlparse

import requests
from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import StreamingResponse

log_handle = logging.getLogger(__name__)

router = APIRouter(tags=["pdf-proxy"])

# Browsers block pdf.js from reading a cross-origin PDF response unless the
# host sends CORS headers -- the external hosts scan_config.json points at
# (vitragvani.com, atmadharma.org, etc.) don't. This proxy fetches server-side,
# where CORS doesn't apply, and re-serves the bytes with permissive headers of
# its own. It is deliberately NOT an open proxy: an unvalidated url= param
# here would be an SSRF vector, so only known hosts are fetchable.
#
# swalakshya.me is included because citations often carry the URL shortener's
# own link (see backend/shortener), which 302s onward to one of the external
# hosts below -- requests' allow_redirects follows that hop server-side. The
# shortener only ever maps codes to file_url values already present in our
# own OpenSearch index (populated exclusively from
# cataloguesearch-configs/**/scan_config.json at crawl time), so that
# redirect target is bounded by data we control, not user input -- the
# redirect hop itself isn't re-validated against this allowlist.
ALLOWED_HOSTS = {
    "swalakshya.me",
    "chat.swalakshya.me",
    "vitragvani.com",
    "www.vitragvani.com",
    "vitragelibrary.org",
    "atmadharma.org",
    "ptst.in",
    "storage.googleapis.com",
}

FETCH_TIMEOUT_SECONDS = 60
CHUNK_SIZE = 65536
CACHE_DIR = Path(os.getenv("PDF_PROXY_CACHE_DIR", "/tmp/pdf_proxy_cache"))

# Response headers pdf.js needs to actually see, not just receive -- Range/
# Content-Range/Content-Length aren't on the CORS default-exposed header list,
# so a cross-origin caller can get a perfectly valid 206 response and still
# have no visibility into it client-side without this. Easy to miss; this is
# a well-known pdf.js + CORS + Range gotcha.
EXPOSE_HEADERS = "Content-Range, Accept-Ranges, Content-Length"


def _cache_path(url: str) -> Path:
    digest = hashlib.sha256(url.encode("utf-8")).hexdigest()
    return CACHE_DIR / f"{digest}.pdf"


def _parse_range(range_header: str, file_size: int) -> tuple[int, int]:
    # "bytes=START-END", END optional (means "to end of file")
    try:
        _, _, rng = range_header.partition("=")
        start_s, _, end_s = rng.partition("-")
        start = int(start_s) if start_s else 0
        end = min(int(end_s), file_size - 1) if end_s else file_size - 1
    except ValueError:
        raise HTTPException(status_code=416, detail="invalid range")
    if start > end or start >= file_size or start < 0:
        raise HTTPException(status_code=416, detail="range not satisfiable")
    return start, end


def _serve_from_cache(dest: Path, range_header: str | None) -> StreamingResponse:
    """Warm-cache path: the document is already on local disk, so Range
    requests (what pdf.js uses for per-page fetching once it knows a server
    supports them) are just a seek + bounded read -- instant, and correct
    regardless of whether the *original* upstream host actually supports
    Range itself."""
    file_size = dest.stat().st_size

    if not range_header:
        def stream_full():
            with open(dest, "rb") as f:
                while True:
                    chunk = f.read(CHUNK_SIZE)
                    if not chunk:
                        break
                    yield chunk

        return StreamingResponse(
            stream_full(),
            media_type="application/pdf",
            headers={
                "Content-Length": str(file_size),
                "Accept-Ranges": "bytes",
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Expose-Headers": EXPOSE_HEADERS,
                "Cache-Control": "public, max-age=86400",
            },
        )

    start, end = _parse_range(range_header, file_size)
    length = end - start + 1

    def stream_range():
        with open(dest, "rb") as f:
            f.seek(start)
            remaining = length
            while remaining > 0:
                chunk = f.read(min(CHUNK_SIZE, remaining))
                if not chunk:
                    break
                remaining -= len(chunk)
                yield chunk

    return StreamingResponse(
        stream_range(),
        status_code=206,
        media_type="application/pdf",
        headers={
            "Content-Range": f"bytes {start}-{end}/{file_size}",
            "Content-Length": str(length),
            "Accept-Ranges": "bytes",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Expose-Headers": EXPOSE_HEADERS,
            "Cache-Control": "public, max-age=86400",
        },
    )


def _stream_and_cache(url: str, dest: Path) -> StreamingResponse:
    """Cold-cache path: this document has never been requested before. Streams
    upstream bytes to the client as they arrive (so pdf.js's onProgress can
    show real progress on this first view) while simultaneously writing them
    to a temp file; renames into the cache location on success so every later
    request -- same document, same or a different viewer, with or without a
    Range header -- hits the fast warm path above instead. Does not honor an
    incoming Range header on this first pass (always fetches the whole file);
    pdf.js treats a 200 in response to a ranged request as "range not
    supported, fall back to full download," which is exactly accurate here."""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    tmp_path = dest.with_suffix(f".{os.getpid()}.{threading.get_ident()}.tmp")

    try:
        upstream = requests.get(url, stream=True, timeout=FETCH_TIMEOUT_SECONDS, allow_redirects=True)
    except requests.RequestException as err:
        log_handle.warning(f"pdf_proxy_fetch_failed url={url} error={err}")
        raise HTTPException(status_code=502, detail="failed to fetch source PDF") from err

    if upstream.status_code != 200:
        upstream.close()
        raise HTTPException(status_code=502, detail=f"source returned {upstream.status_code}")

    content_length = upstream.headers.get("Content-Length")

    def generate():
        wrote_ok = False
        try:
            with open(tmp_path, "wb") as f:
                for chunk in upstream.iter_content(chunk_size=CHUNK_SIZE):
                    if not chunk:
                        continue
                    f.write(chunk)
                    yield chunk
            wrote_ok = True
        finally:
            upstream.close()
            if wrote_ok:
                os.replace(tmp_path, dest)
            else:
                tmp_path.unlink(missing_ok=True)

    headers = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Expose-Headers": EXPOSE_HEADERS,
        "Cache-Control": "public, max-age=86400",
    }
    if content_length:
        headers["Content-Length"] = content_length

    return StreamingResponse(generate(), media_type="application/pdf", headers=headers)


@router.get("/pdf-proxy")
def proxy_pdf(request: Request, url: str = Query(..., description="A citation's file_url")):
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or parsed.hostname not in ALLOWED_HOSTS:
        raise HTTPException(status_code=400, detail="url host not allowed")

    dest = _cache_path(url)
    if dest.exists():
        return _serve_from_cache(dest, request.headers.get("range"))
    return _stream_and_cache(url, dest)
