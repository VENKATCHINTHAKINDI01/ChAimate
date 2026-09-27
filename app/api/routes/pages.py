"""The two web apps: the customer's table page and the staff dashboard."""
import re
import time

from fastapi import APIRouter, Response
from fastapi.responses import RedirectResponse

from app.core.config import TEMPLATES_DIR

router = APIRouter(include_in_schema=False)


@router.get("/", include_in_schema=False)
def home():
    """The Deccan House website when it has been built; otherwise straight to the table app."""
    from app.core.config import FRONTEND_DIST
    if (FRONTEND_DIST / "index.html").exists():
        return Response((FRONTEND_DIST / "index.html").read_bytes(), media_type="text/html")
    return RedirectResponse("/table?t=1")


ASSET_VERSION = str(int(time.time()))   # changes on every server start → browsers fetch fresh CSS/JS


def _page(name: str) -> Response:
    html = (TEMPLATES_DIR / name).read_text(encoding="utf-8")
    html = re.sub(r'(/static/[\w./-]+\.(?:css|js))"', rf'\1?v={ASSET_VERSION}"', html)
    return Response(html, media_type="text/html")


@router.get("/table")
def table_page():
    return _page("table.html")


@router.get("/staff")
def staff_page():
    return _page("staff.html")
