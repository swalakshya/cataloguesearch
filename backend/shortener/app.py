import logging
import os
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field

from backend.common.opensearch import get_opensearch_client
from backend.config import Config
from backend.shortener.core import ShortenerStore
from backend.shortener.opensearch_loader import fetch_file_urls

log_handle = logging.getLogger(__name__)


class BulkShortenRequest(BaseModel):
    long_urls: list[str] = Field(..., description="List of scan URLs")


class BulkShortenResponse(BaseModel):
    short_urls: dict[str, str]


def _short_url(base_url: str, code: str) -> str:
    return f"{base_url.rstrip('/')}/su/{code}"


def create_app(store: Optional[ShortenerStore] = None, base_url: Optional[str] = None) -> FastAPI:
    app = FastAPI(title="CatalogueSearch URL Shortener", version="1.0.0")

    app.state.store = store
    app.state.base_url = base_url or os.getenv("SHORTENER_BASE_URL", "https://swalakshya.me")

    @app.on_event("startup")
    async def load_urls():
        if app.state.store is not None:
            return
        config_path = os.getenv("CONFIG_PATH", "configs/config.yaml")
        config = Config(config_path)
        client = get_opensearch_client(config)
        urls = fetch_file_urls(client, index_name=config.OPENSEARCH_INDEX_NAME)
        base_len = int(os.getenv("SHORT_CODE_LEN", "7"))
        store_local = ShortenerStore(base_len=base_len)
        store_local.load(urls)
        app.state.store = store_local
        log_handle.info("shortener loaded %s urls", len(urls))

    @app.get("/health")
    async def health():
        return {"status": "ok"}

    @app.post("/shorten", response_model=BulkShortenResponse)
    async def shorten(payload: BulkShortenRequest):
        short_urls: dict[str, str] = {}
        for url in payload.long_urls:
            code = app.state.store.get_code(url)
            if code:
                short_urls[url] = _short_url(app.state.base_url, code)
        return {"short_urls": short_urls}

    @app.get("/su/{code}")
    async def redirect_short(code: str):
        url = app.state.store.get_url(code)
        if not url:
            raise HTTPException(status_code=404, detail="Short code not found")
        return RedirectResponse(url=url, status_code=302)

    @app.get("/su/{code}/{page}")
    async def redirect_short_page(code: str, page: int):
        if page <= 0:
            raise HTTPException(status_code=400, detail="Invalid page")
        url = app.state.store.get_url(code)
        if not url:
            raise HTTPException(status_code=404, detail="Short code not found")
        return RedirectResponse(url=f"{url}#page={page}", status_code=302)

    return app


app = create_app()
