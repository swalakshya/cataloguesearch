"""Eval-only layout detection and column-aware OCR response regression checks."""

import io
import json
from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image, ImageDraw
import pytest

from eval.auto_tesseract import detect_layout, order_regions
from eval import api


def text_page(columns=1):
    image = Image.new("RGB", (600, 800), "white")
    draw = ImageDraw.Draw(image)
    for y in range(100, 700, 18):
        for x in range(40, 555, 11):
            if columns == 2 and 275 < x < 320:
                continue
            draw.rectangle((x, y, x + 5, y + 7), fill="black")
    return image


def line(text, x, y, end, number=0):
    return {"text": text, "x_start": x, "x_end": end, "y_start": y,
            "height": 10, "line_num": number}


@pytest.mark.parametrize("columns,mode", [(1, "single_column"), (2, "two_column")])
def test_detects_prose_layout(columns, mode):
    result = detect_layout(text_page(columns))
    assert result["mode"] == mode
    if columns == 2:
        assert 45 < result["split_percent"] < 55


def test_table_rules_require_review_instead_of_silent_column_split():
    image = text_page(2)
    draw = ImageDraw.Draw(image)
    draw.line((300, 100, 300, 700), fill="black", width=2)
    draw.line((40, 100, 560, 100), fill="black", width=2)
    result = detect_layout(image)
    assert result["mode"] == "review"
    assert any("Table" in warning for warning in result["warnings"])


def test_columns_keep_spanning_text_page_number_and_all_lines():
    original = {"page_num": 16, "lines": [
        line("heading", 40, 80, 560, 0),
        line("left one", 40, 120, 270, 1), line("right one", 330, 120, 560, 2),
        line("left two", 40, 160, 270, 3), line("right two", 330, 160, 560, 4),
        line("footer", 40, 720, 560, 5),
    ]}
    regions = order_regions(original, {"mode": "two_column", "split_percent": 50}, 600)
    assert [r["label"] for r in regions] == ["Full width", "Left column", "Right column", "Full width"]
    lines = [line for region in regions for line in region["lines"]]
    assert [line["text"] for line in lines] == ["heading", "left one", "left two", "right one", "right two", "footer"]
    assert all(region["page_num"] == 16 for region in regions)
    assert regions[1]["metadata"]["prose_right_margin"] == 270
    assert regions[2]["metadata"]["prose_left_margin"] == 330
    assert [line["line_num"] for line in lines] == list(range(6))
    assert original["lines"][2]["text"] == "right one"  # caller's OCR data is unchanged


def test_review_preserves_tesseract_order_and_blank_page_is_supported():
    lines = [line("left", 40, 200, 270), line("right", 330, 100, 560)]
    regions = order_regions({"page_num": 1, "lines": lines}, {"mode": "review"}, 600)
    assert [line["text"] for line in regions[0]["lines"]] == ["left", "right"]
    assert order_regions({"page_num": 1, "lines": []}, {"mode": "single_column"}, 600) == []


@pytest.mark.parametrize("auto_layout,expected_psm", [(True, 3), (False, 6)])
def test_ocr_endpoint_upload_preserves_page_and_uses_region_margins(tmp_path, monkeypatch, auto_layout, expected_psm):
    config = SimpleNamespace(BASE_PDF_PATH=str(tmp_path), BASE_OCR_PATH=str(tmp_path), TESSDATA_DIR=None)
    monkeypatch.setattr(api, "Config", lambda *_a, **_k: config)
    calls = []

    def ocr(args):
        page, image, language, psm = args
        calls.append((page, psm))
        data = {"page_num": page, "metadata": {"prose_left_margin": 40, "prose_right_margin": 560},
                "lines": [line("ડાબી બાજુનું લખાણ.", 40, 120, 270, 0),
                          line("જમણી બાજુનું લખાણ.", 330, 120, 560, 1)]}
        return page, [json.dumps(data)]

    monkeypatch.setattr(api.AdvancedPDFProcessor, "_process_single_page", staticmethod(ocr))
    app = FastAPI()
    app.include_router(api.router)
    buffer = io.BytesIO()
    text_page(2).save(buffer, format="PNG")
    response = TestClient(app).post("/eval/ocr", data={
        "language": "guj", "auto_layout": str(auto_layout).lower(), "page_number": "16",
    }, files={"image": ("page.png", buffer.getvalue(), "image/png")})
    assert response.status_code == 200, response.text
    result = response.json()
    assert calls == [(16, expected_psm)]
    assert result["ocr_json"]["page_num"] == 16
    if auto_layout:
        assert result["layout"]["mode"] == "two_column"
        assert result["preview_image"]
        assert len(result["ocr_json"]["regions"]) == 2
        assert len(result["paragraphs"]) == 2
        assert result["scan_config"]["eval_layout"] == "auto"
    else:
        assert result["layout"] is None
        assert result["preview_image"] is None
