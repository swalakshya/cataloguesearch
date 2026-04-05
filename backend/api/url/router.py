from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import RedirectResponse

router = APIRouter(tags=["url"])


@router.get("/url/{code}")
async def redirect_short(request: Request, code: str):
    url = request.app.state.shortener_store.get_url(code)
    if not url:
        raise HTTPException(status_code=404, detail="Short code not found")
    return RedirectResponse(url=url, status_code=302)


@router.get("/url/{code}/{page}")
async def redirect_short_page(request: Request, code: str, page: int):
    if page <= 0:
        raise HTTPException(status_code=400, detail="Invalid page")
    url = request.app.state.shortener_store.get_url(code)
    if not url:
        raise HTTPException(status_code=404, detail="Short code not found")
    return RedirectResponse(url=f"{url}#page={page}", status_code=302)
