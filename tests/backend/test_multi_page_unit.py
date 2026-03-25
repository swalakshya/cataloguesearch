"""
Unit tests for MultiPagePDFProcessor.

Covers branches not exercised by the E2E test:
  - Resume-safe early return when all logical page files already exist
  - LLM branch: _ocr_and_write → _ocr_llm (uses real LLMPDFProcessor / Gemini API)
  - _load_page_mapping with corrupt JSON → returns {}
  - _save_page_mapping IOError → no exception raised
"""

import json
import os
import tempfile

import fitz
import pytest
from PIL import Image

from backend.config import Config
from backend.crawler.advanced_pdf_processor import AdvancedPDFProcessor
from backend.crawler.llm_pdf_processor import LLMPDFProcessor
from backend.crawler.multi_page_pdf_processor import MultiPagePDFProcessor
from tests.backend.base import *  # brings in module-scoped autouse `initialise` fixture

_DATA_DIR    = os.path.join(os.path.dirname(__file__), "../data/multi_page_pdf")
_BANGALORE_PDF = os.path.join(_DATA_DIR, "bangalore_hindi.pdf")


# ── helpers ────────────────────────────────────────────────────────────────────

class _FakeInner:
    """Minimal stand-in inner processor — has the path attributes that
    MultiPagePDFProcessor reads in process_pdf, but no OCR capability."""

    def __init__(self, base_pdf: str, base_ocr: str):
        self._base_pdf_folder = base_pdf
        self._base_ocr_folder = base_ocr

    def get_output_file_extension(self) -> str:
        return ".json"


def _half_image(pdf_path: str, page_num: int = 1, side: str = "left") -> Image.Image:
    """Render a PDF page at 150 DPI and return one vertical half."""
    doc = fitz.open(pdf_path)
    page = doc.load_page(page_num - 1)
    pix  = page.get_pixmap(dpi=150)
    img  = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
    doc.close()
    w, h = img.size
    mid  = w // 2
    return img.crop((0, 0, mid, h)) if side == "left" else img.crop((mid, 0, w, h))


# ── fixtures ───────────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def config(initialise):
    return Config()


# ═══════════════════════════════════════════════════════════════════════════════
# Resume-safe skip
# ═══════════════════════════════════════════════════════════════════════════════

class TestResumeSafety:
    """process_pdf returns True immediately when all logical output files exist."""

    def test_skips_when_all_pages_cached(self, initialise):
        with tempfile.TemporaryDirectory() as tmpdir:
            pdf_dir = os.path.join(tmpdir, "pdfs")
            ocr_dir = os.path.join(tmpdir, "ocr")
            os.makedirs(pdf_dir)

            import shutil
            pdf_path = os.path.join(pdf_dir, "bangalore_hindi.pdf")
            shutil.copy(_BANGALORE_PDF, pdf_path)

            scan_config = {
                "multi_page":       True,
                "book_start_side":  "left",
                "language":         "hi",
            }
            inner     = _FakeInner(pdf_dir, ocr_dir)
            processor = MultiPagePDFProcessor(inner, scan_config)

            # Pre-create all 8 logical page files (bangalore has 4 PDF pages → 8 logical)
            output_dir = os.path.join(ocr_dir, "bangalore_hindi")
            os.makedirs(output_dir)
            for lp in range(1, 9):
                open(os.path.join(output_dir, f"page_{lp:04d}.json"), "w").close()

            # Should return True via the early-return path without calling _get_image
            # (which would fail since _FakeInner has no such method)
            result = processor.process_pdf(pdf_path, scan_config, [1, 2, 3, 4])
            assert result is True


# ═══════════════════════════════════════════════════════════════════════════════
# LLM branch — _ocr_and_write → _ocr_llm
# ═══════════════════════════════════════════════════════════════════════════════

class TestLLMPath:
    """
    Exercises _ocr_and_write with a LLMPDFProcessor inner, which routes through
    _ocr_llm.  Uses the real Gemini API (keys must be present in the environment).
    """

    def test_ocr_and_write_llm_produces_json_file(self, config):
        with tempfile.TemporaryDirectory() as tmpdir:
            scan_config = {"language": "hi"}
            inner     = LLMPDFProcessor(config)
            processor = MultiPagePDFProcessor(inner, scan_config)

            image  = _half_image(_BANGALORE_PDF, page_num=1, side="left")
            result = processor._ocr_and_write(image, 1, scan_config, tmpdir)

            assert result is True
            out_file = os.path.join(tmpdir, "page_0001.json")
            assert os.path.exists(out_file)
            with open(out_file, encoding="utf-8") as fh:
                data = json.load(fh)
            assert "page_num" in data or isinstance(data, list)  # valid LLM output


# ═══════════════════════════════════════════════════════════════════════════════
# _load_page_mapping error handling
# ═══════════════════════════════════════════════════════════════════════════════

class TestLoadPageMapping:
    """_load_page_mapping falls back to {} when the file contains invalid JSON."""

    def test_corrupt_json_returns_empty_dict(self, initialise):
        with tempfile.TemporaryDirectory() as tmpdir:
            mapping_path = os.path.join(tmpdir, "page_mapping.json")
            with open(mapping_path, "w") as fh:
                fh.write("{this is not valid json")

            processor = MultiPagePDFProcessor(_FakeInner("/a", "/b"), {})
            result    = processor._load_page_mapping(tmpdir)
            assert result == {}


# ═══════════════════════════════════════════════════════════════════════════════
# _save_page_mapping error handling
# ═══════════════════════════════════════════════════════════════════════════════

class TestSavePageMapping:
    """_save_page_mapping swallows IOError and does not propagate it."""

    def test_ioerror_does_not_raise(self, initialise):
        processor = MultiPagePDFProcessor(_FakeInner("/a", "/b"), {})
        # Directory does not exist — open() will raise FileNotFoundError (subclass of IOError)
        # The method must catch it silently.
        processor._save_page_mapping("/nonexistent/directory/that/cannot/exist", {"1": 1})
        # Reaching here without an exception means the test passes


# ═══════════════════════════════════════════════════════════════════════════════
# _logical_pages and expand_pages ordering
# ═══════════════════════════════════════════════════════════════════════════════

class TestLogicalPageOrdering:
    """
    Reading order within every spread is always left → right (lower → higher
    logical page number), regardless of book_start_side.
    """

    def _make(self, book_start_page, book_start_side):
        cfg = {"book_start_page": book_start_page, "book_start_side": book_start_side}
        return MultiPagePDFProcessor(_FakeInner("/a", "/b"), cfg)

    def test_left_start_logical_pages(self):
        p = self._make(book_start_page=1, book_start_side="left")
        assert p._logical_pages(1) == (1, 2)
        assert p._logical_pages(2) == (3, 4)
        assert p._logical_pages(3) == (5, 6)

    def test_right_start_logical_pages(self):
        # book_start_page=5, book_start_side="right":
        #   PDF 5 → left=0 (no left page), right=1
        #   PDF 6 → left=2, right=3
        #   PDF 7 → left=4, right=5
        p = self._make(book_start_page=5, book_start_side="right")
        assert p._logical_pages(5) == (0, 1)
        assert p._logical_pages(6) == (2, 3)
        assert p._logical_pages(7) == (4, 5)

    def test_left_start_expand_pages_order(self):
        p = self._make(book_start_page=1, book_start_side="left")
        assert p.expand_pages([1, 2, 3]) == [1, 2, 3, 4, 5, 6]

    def test_right_start_expand_pages_order(self):
        # PDF 5 → [1]; PDF 6 → [2, 3]; PDF 7 → [4, 5]
        p = self._make(book_start_page=5, book_start_side="right")
        assert p.expand_pages([5, 6, 7]) == [1, 2, 3, 4, 5]

    def test_right_start_expand_pages_with_bounds_order(self):
        p = self._make(book_start_page=5, book_start_side="right")
        # Full range: same as expand_pages
        result = p.expand_pages_with_bounds([5, 6, 7], 5, "right", 7, "right")
        assert result == [1, 2, 3, 4, 5]

    def test_right_start_expand_pages_with_bounds_start_trim(self):
        # start_side="right" on PDF 6 → skip left=2, start from right=3
        p = self._make(book_start_page=5, book_start_side="right")
        result = p.expand_pages_with_bounds([6, 7], 6, "right", 7, "right")
        assert result == [3, 4, 5]
