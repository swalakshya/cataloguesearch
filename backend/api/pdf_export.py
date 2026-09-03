"""Renders a bounded set of search results into a downloadable "Export to PDF" file
for Aagam Khoj (Pravachan / Granth / Books). Pure formatting only — the caller is
responsible for running the actual search and handing over the result dicts.
"""
import html
import logging
import re
from datetime import date
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from weasyprint import HTML

log_handle = logging.getLogger(__name__)

_ASSETS_DIR = Path(__file__).resolve().parent.parent / "assets"
_LOGO_URI = (_ASSETS_DIR / "images" / "swalakshya-logo.png").as_uri()
_FONTS_DIR = _ASSETS_DIR / "fonts"

_TAG_RE = re.compile(r"<[^>]+>")

# Columns per category. `None` marks the dynamic sub-section slot, whose header
# label and presence depend on the actual results (see _build_html).
_COLUMNS: Dict[str, List[Optional[str]]] = {
    "Pravachan": ["Granth", "Series", "Date", "Pravachan No.", "Answer Text", "PDF Link"],
    "Granth": ["Granth", "Author", "Answer Text", None, "Page No.", "PDF Link"],
    "Books": ["Book Name", "Author", "Page No.", None, "PDF Link"],
}


def _plain_text(snippet: Optional[str]) -> str:
    """Strips search-highlight HTML tags (e.g. <em>) and escapes the rest for a table cell."""
    return html.escape(_TAG_RE.sub("", snippet or "").strip())


def _pdf_link_cell(result: Dict[str, Any]) -> str:
    file_url = result.get("file_url")
    if not file_url:
        return ""
    page = result.get("pdf_page_number") or result.get("page_number")
    href = f"{file_url}#page={page}" if page else file_url
    return f'<a href="{html.escape(href, quote=True)}">View PDF</a>'


def _author(metadata: Dict[str, Any]) -> str:
    """Same fallback chain as /api/chunk in search_api.py -- Granth results store
    the author under different metadata keys depending on content type."""
    return str(
        metadata.get("Author")
        or metadata.get("Tikakaar")
        or metadata.get("Teekakar")
        or metadata.get("Bhasha Vachanika")
        or ""
    )


def _sub_section(result: Dict[str, Any]) -> Tuple[str, str]:
    """Returns (field label, name) for metadata.sub_section, or ("", "") if absent."""
    sub_section = (result.get("metadata") or {}).get("sub_section")
    if not sub_section:
        return "", ""
    return html.escape(str(sub_section.get("field", ""))), html.escape(str(sub_section.get("name", "")))


def _row_cells(category: str, result: Dict[str, Any]) -> List[str]:
    metadata = result.get("metadata") or {}
    chunk_labels = result.get("chunk_labels") or {}
    answer = _plain_text(result.get("content_snippet"))
    link = _pdf_link_cell(result)

    if category == "Pravachan":
        return [
            html.escape(str(metadata.get("Name", ""))),
            html.escape(str(metadata.get("Series", ""))),
            html.escape(str(chunk_labels.get("date", ""))),
            html.escape(str(chunk_labels.get("pravachan_number", ""))),
            answer,
            link,
        ]
    if category == "Granth":
        _, sub_name = _sub_section(result)
        return [
            html.escape(str(metadata.get("Name") or metadata.get("title") or "")),
            html.escape(_author(metadata)),
            answer,
            sub_name,
            html.escape(str(result.get("page_number", ""))),
            link,
        ]
    # Books
    _, sub_name = _sub_section(result)
    return [
        html.escape(str(metadata.get("Name", ""))),
        html.escape(str(metadata.get("Author", ""))),
        html.escape(str(result.get("page_number", ""))),
        sub_name,
        link,
    ]


def _build_html(category: str, query: str, results: List[Dict[str, Any]]) -> str:
    headers = list(_COLUMNS[category])
    keep_col = [True] * len(headers)

    if None in headers:
        sub_idx = headers.index(None)
        first_field_label = next((_sub_section(r)[0] for r in results if _sub_section(r)[0]), None)
        if first_field_label:
            headers[sub_idx] = first_field_label
            keep_col[sub_idx] = True
        else:
            # No result in this export carries a sub-section — drop the column entirely.
            keep_col[sub_idx] = False
            headers[sub_idx] = ""

    visible_headers = [h for h, keep in zip(headers, keep_col) if keep]
    header_html = "".join(f"<th>{h}</th>" for h in visible_headers)

    row_html_parts = []
    for result in results:
        cells = _row_cells(category, result)
        visible_cells = [c for c, keep in zip(cells, keep_col) if keep]
        row_html_parts.append("<tr>" + "".join(f"<td>{c}</td>" for c in visible_cells) + "</tr>")

    exported_on = date.today().strftime("%d %B %Y")

    return f"""<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>{_CSS}</style>
</head>
<body>
  <div class="header">
    <img src="{_LOGO_URI}" class="logo" alt="Swalakshya">
    <div>
      <div class="brand">Swalakshya Khoj</div>
      <div class="subtitle">{html.escape(category)} results &middot; exported {exported_on}</div>
    </div>
  </div>
  <div class="question">Query: {html.escape(query)}</div>
  <table>
    <thead><tr>{header_html}</tr></thead>
    <tbody>{"".join(row_html_parts)}</tbody>
  </table>
</body>
</html>"""


# Unicode-range per script, copied verbatim from Google Fonts' own @font-face
# output for these families. Without an explicit unicode-range, a renderer has
# no way to tell these per-script subset files apart within one family name and
# will pick just one for all text — this is required, not cosmetic.
_UNICODE_RANGES = {
    "latin": "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
    "latin-ext": "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF",
    "devanagari": "U+0900-097F, U+1CD0-1CF9, U+200C-200D, U+20A8, U+20B9, U+20F0, U+25CC, U+A830-A839, U+A8E0-A8FF, U+11B00-11B09",
    "gujarati": "U+0951-0952, U+0964-0965, U+0A80-0AFF, U+200C-200D, U+20B9, U+25CC, U+A830-A839",
}


def _font_face(family: str, file_stem: str, script: str) -> str:
    return f"""
@font-face {{
  font-family: '{family}';
  unicode-range: {_UNICODE_RANGES[script]};
  src: url('{(_FONTS_DIR / f"{file_stem}.woff2").as_uri()}') format('woff2');
}}"""


# Same font-family fallback stack the frontend uses (index.css / index.html), so
# rendered Devanagari/Gujarati text looks consistent with what's shown on screen:
# 'Noto Sans' covers Latin, falling back to the script-specific families for
# Devanagari/Gujarati text. One face per family/script (no weight variants —
# declaring the same file twice under different font-weight values was
# confusing WeasyPrint's font matching and corrupting glyph selection).
_FONT_FACES = (
    _font_face("Noto Sans", "NotoSans-latin", "latin")
    + _font_face("Noto Sans", "NotoSans-latin-ext", "latin-ext")
    + _font_face("Noto Sans Devanagari", "NotoSansDevanagari-devanagari", "devanagari")
    + _font_face("Noto Sans Gujarati", "NotoSansGujarati-gujarati", "gujarati")
)

# Colors copied from the app's active "Cobalt Slate" theme
# (frontend/src/theme/palettes.js, PALETTES.cobalt.light — light variant only,
# since this is a static/printed document). Keep these in sync by hand if that
# palette changes or DEFAULT_PALETTE switches away from 'cobalt'; see the
# palette-tokens.json suggestion for making this automatic instead.
_THEME = {
    "bg": "#F7F8FA",
    "surface": "#FFFFFF",
    "border": "#DFE3EA",
    "ink": "#1B2430",
    "ink_muted": "#5B6472",
    "brand": "#2454B8",
    "brand_tint": "#E9EEF8",  # ~10% brand mixed into white, for the question callout background
}

_CSS = f"""
{_FONT_FACES}

@page {{
  size: A4 landscape;
  margin: 1.4cm;
  @bottom-center {{ content: "Page " counter(page) " of " counter(pages); font-size: 9pt; color: {_THEME['ink_muted']}; }}
}}

* {{ font-family: 'Noto Sans', 'Noto Sans Devanagari', 'Noto Sans Gujarati', sans-serif; box-sizing: border-box; }}

body {{ margin: 0; font-size: 11pt; color: {_THEME['ink']}; }}

.header {{ display: flex; align-items: center; gap: 12px; margin-bottom: 6px; }}
.logo {{ width: 40px; height: 40px; }}
.brand {{ font-size: 19pt; font-weight: 700; color: {_THEME['brand']}; }}
.subtitle {{ font-size: 10.5pt; color: {_THEME['ink_muted']}; }}

.question {{
  font-size: 12.5pt; font-weight: 700; margin: 10px 0 14px;
  padding: 8px 10px; background: {_THEME['brand_tint']}; border-left: 3px solid {_THEME['brand']};
}}

table {{ width: 100%; border-collapse: collapse; }}
th, td {{ border: 1px solid {_THEME['border']}; padding: 6px 8px; text-align: left; vertical-align: top; font-size: 10pt; }}
th {{ background: {_THEME['brand']}; color: {_THEME['surface']}; font-weight: 700; }}
tr {{ break-inside: avoid; }}
tbody tr:nth-child(even) td {{ background: {_THEME['bg']}; }}
a {{ color: {_THEME['brand']}; text-decoration: none; }}
"""


def render_export_pdf(category: str, query: str, results: List[Dict[str, Any]]) -> bytes:
    """Renders up to len(results) rows into a PDF for the given category. Caller must
    already have capped `results` to the desired export count."""
    if category not in _COLUMNS:
        raise ValueError(f"Unsupported export category: {category}")
    html_doc = _build_html(category, query, results)
    return HTML(string=html_doc).write_pdf()
