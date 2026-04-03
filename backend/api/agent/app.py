from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.docs import get_redoc_html, get_swagger_ui_html
from fastapi.responses import HTMLResponse

from backend.api.agent.router import router

_REDOC_JS = "https://cdn.jsdelivr.net/npm/redoc@2.1.3/bundles/redoc.standalone.js"
_SWAGGER_JS = "https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"
_SWAGGER_CSS = "https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css"

agent_app = FastAPI(
    title="Swalakshya Agent API",
    description=(
        "Public API for searching and navigating Jain texts in the Swalakshya corpus. "
        "Supports hybrid (semantic + lexical) search, paragraph navigation, "
        "similarity lookup, and filter discovery. "
        "Use `/search` to find relevant passages, `/navigate` to read surrounding context, "
        "`/find_similar` for related content, and `/get_filter_options` to enumerate "
        "valid filter values before querying."
    ),
    version="1.0.0",
    contact={
        "name": "Swalakshya",
        "url": "https://github.com/swalakshya/cataloguesearch",
    },
    license_info={
        "name": "Proprietary",
    },
    docs_url=None,
    redoc_url=None,
)

agent_app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

agent_app.include_router(router)


@agent_app.get("/docs", include_in_schema=False)
async def swagger_ui(req: Request) -> HTMLResponse:
    root_path = req.scope.get("root_path", "").rstrip("/")
    return get_swagger_ui_html(
        openapi_url=f"{root_path}/openapi.json",
        title="Swalakshya Agent API",
        swagger_js_url=_SWAGGER_JS,
        swagger_css_url=_SWAGGER_CSS,
    )


@agent_app.get("/redoc", include_in_schema=False)
async def redoc(req: Request) -> HTMLResponse:
    root_path = req.scope.get("root_path", "").rstrip("/")
    return get_redoc_html(
        openapi_url=f"{root_path}/openapi.json",
        title="Swalakshya Agent API",
        redoc_js_url=_REDOC_JS,
    )
