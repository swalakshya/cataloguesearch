"""Per-PDF physical-page overrides, native format routing and cache regression tests."""
import json
from pathlib import Path
from types import SimpleNamespace

import fitz
from PIL import Image
import pytest

from backend.common.auto_tesseract_config import ocr_directory, prepare_ocr_cache, recipe_current, validate_auto_pages
from backend.common.scan_config import get_scan_config
from backend.crawler.advanced_pdf_processor import AdvancedPDFProcessor
from backend.crawler.pdf_processor import PDFProcessor
from backend.crawler.pdf_factory import create_pdf_processor
from backend.crawler.hybrid_pdf_processor import HybridPDFProcessor
from backend.crawler.paragraph_generator.factory import create_paragraph_generator
from backend.crawler.paragraph_generator.language_meta import get_language_meta
from backend.crawler.llm_index_generator import LLMIndexGenerator
from backend.crawler.discovery import SingleFileProcessor
from backend.crawler.index_state import IndexState


@pytest.fixture
def env(tmp_path, monkeypatch):
    pdf_root = tmp_path / "pdf"
    pdf_root.mkdir()
    pdf = pdf_root / "issue.pdf"
    with fitz.open() as doc:
        for _ in range(5):
            doc.new_page()
        doc.save(pdf)
    config = SimpleNamespace(BASE_PDF_PATH=str(pdf_root), BASE_OCR_PATH=str(tmp_path / "ocr"),
        BASE_TEXT_PATH=str(tmp_path / "text"), TESSDATA_DIR=None, OCR_ENGINE="tesseract",
        CHUNK_STRATEGY="advanced", OCR_MAX_WORKERS=1, DEFAULT_LLM_MODEL="test-model", LLM_MODE="batch")
    calls = []

    def ocr(args):
        page, image, language = args[:3]
        psm = args[3] if len(args) == 4 else 6
        calls.append((page, psm))
        return page, [json.dumps({"page_num": page, "metadata": {"prose_left_margin": 20, "prose_right_margin": 580},
            "lines": [{"text": f"This is the content for physical page {page}.", "x_start": 20, "x_end": 580,
                       "y_start": 120, "height": 10, "line_num": 0}]})]

    class InlinePool:
        def __init__(self, **kwargs): pass
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def map(self, function, tasks): return map(function, tasks)

    monkeypatch.setattr("backend.crawler.pdf_processor.ProcessPoolExecutor", InlinePool)
    monkeypatch.setattr(AdvancedPDFProcessor, "_process_single_page", staticmethod(ocr))
    monkeypatch.setattr(PDFProcessor, "_get_image", lambda self, file, pages, cfg: (
        [Image.new("RGB", (600, 800), "white") for page in pages], pages))
    return SimpleNamespace(config=config, pdf=pdf, root=pdf_root, calls=calls)


def test_loader_preserves_old_configs_and_loads_per_issue_list(env):
    path = env.root / "scan_config.json"
    path.write_text(json.dumps({"default": {"ocr_engine": "tesseract", "psm": 7},
                                "issue": {"start_page": 2, "end_page": 4}}))
    plain = get_scan_config(str(env.pdf), str(env.root))
    assert "auto_tesseract_pages" not in plain
    assert plain["psm"] == 7
    data = json.loads(path.read_text())
    data["issue"]["auto_tesseract_pages"] = [4, 2, 4]
    path.write_text(json.dumps(data))
    mixed = get_scan_config(str(env.pdf), str(env.root))
    assert mixed["auto_tesseract_pages"] == [2, 4]
    assert mixed["ocr_engine"] == "tesseract"


@pytest.mark.parametrize("pages", [[True], ["2"], [-1], [0], "2", None])
def test_invalid_page_lists_fail(pages):
    with pytest.raises(ValueError, match="auto_tesseract_pages"):
        validate_auto_pages({"auto_tesseract_pages": pages})


@pytest.mark.parametrize("settings", [
    {"auto_tesseract_pages": [6]}, {"auto_tesseract_pages": [1], "start_page": 2},
    {"auto_tesseract_pages": [4], "end_page": 3}, {"auto_tesseract_pages": [2], "skip_pdf_pages": [2]},
    {"auto_tesseract_pages": [2], "multi_page": True},
])
def test_invalid_physical_page_selection_fails(settings):
    with pytest.raises(ValueError): validate_auto_pages(settings, num_pages=5)


def test_loader_rejects_pdf_specific_pages_in_defaults(env):
    (env.root / "scan_config.json").write_text(json.dumps({"default": {"auto_tesseract_pages": [2]}}))
    with pytest.raises(ValueError, match="per PDF"):
        get_scan_config(str(env.pdf), str(env.root))


def test_real_processor_routes_only_included_pages_and_keeps_psm(env):
    cfg = {"ocr_engine": "tesseract", "psm": 7, "language": "hi", "start_page": 2,
           "end_page": 4, "auto_tesseract_pages": [3]}
    processor = create_pdf_processor(env.config, scan_config=cfg)
    assert processor.process_pdf(str(env.pdf), cfg, [1, 2, 3, 4, 5])
    assert env.calls == [(2, 7), (4, 7), (3, 3)]
    directory = ocr_directory(env.pdf, env.config)
    assert sorted(p.name for p in directory.glob("page_*.json")) == ["page_0002.json", "page_0003.json", "page_0004.json"]
    data = processor.read_paragraphs(str(directory), [2, 3, 4])
    assert data[0]["page_num"] == 2
    assert data[1][0] == 3 and data[1][1]["ocr_mode"] == "auto_tesseract"
    assert data[2]["page_num"] == 4
    assert processor.process_pdf(str(env.pdf), cfg, [2, 3, 4])
    assert len(env.calls) == 3  # cache hit


def test_cache_changes_and_override_removal_regenerate_instead_of_reusing_auto(env):
    cfg = {"psm": 7, "language": "hi", "auto_tesseract_pages": [2]}
    create_pdf_processor(env.config, scan_config=cfg).process_pdf(str(env.pdf), cfg, [1, 2, 3])
    cfg = {**cfg, "auto_tesseract_pages": [3]}
    assert not recipe_current(env.pdf, cfg, env.config)
    create_pdf_processor(env.config, scan_config=cfg).process_pdf(str(env.pdf), cfg, [1, 2, 3])
    assert env.calls[-3:] == [(1, 7), (2, 7), (3, 3)]
    cfg = {"psm": 7, "language": "hi"}  # remove the key entirely
    regular = create_pdf_processor(env.config, scan_config=cfg)
    assert not isinstance(regular, HybridPDFProcessor)
    regular.process_pdf(str(env.pdf), cfg, [1, 2, 3])
    assert env.calls[-3:] == [(1, 7), (2, 7), (3, 7)]
    assert recipe_current(env.pdf, cfg, env.config)
    data = regular.read_paragraphs(str(ocr_directory(env.pdf, env.config)), [1, 2, 3])
    assert all("ocr_mode" not in page for page in data)


def test_normal_processor_does_not_acquire_a_new_recipe(env):
    cfg = {"psm": 7}
    assert not prepare_ocr_cache(env.pdf, cfg, env.config)
    assert not ocr_directory(env.pdf, env.config).exists()
    assert not isinstance(create_pdf_processor(env.config, scan_config=cfg), HybridPDFProcessor)


def test_llm_regular_pages_keep_native_blocks_and_batch_pending_status(env):
    calls = []
    class RegularLLM:
        def process_pdf(self, pdf, cfg, pages):
            calls.append(list(pages))
            directory = ocr_directory(pdf, env.config)
            for p in pages:
                (directory / f"page_{p:04d}.json").write_text(json.dumps([{"type": "hindi_text", "text": f"This is the regular LLM content for page {p}."}]))
            return len(calls) > 1  # emulate a pending batch followed by collection
        def read_paragraphs(self, directory, pages):
            return [(p, json.loads((Path(directory) / f"page_{p:04d}.json").read_text())) for p in pages]
    processor = HybridPDFProcessor(RegularLLM(), env.config)
    cfg = {"ocr_engine": "llm", "language": "hi", "auto_tesseract_pages": [2]}
    assert not processor.process_pdf(str(env.pdf), cfg, [1, 2, 3])
    assert processor.process_pdf(str(env.pdf), cfg, [1, 2, 3])
    assert calls == [[1, 3], [1, 3]]
    assert env.calls == [(2, 3)]
    data = processor.read_paragraphs(str(ocr_directory(env.pdf, env.config)), [1, 2, 3])
    assert data[0][1][0]["type"] == "hindi_text"
    gen = create_paragraph_generator(env.config, get_language_meta("hi", cfg), scan_config=cfg)
    paragraphs = gen.generate_paragraphs(data, cfg)
    assert [page for page, text in paragraphs] == [1, 2, 3]


def test_verse_extraction_continues_after_an_auto_page(tmp_path):
    generator = object.__new__(LLMIndexGenerator)
    generator._write_verses(str(tmp_path), [
        (1, {"ocr_mode": "auto_tesseract"}),
        (2, [{"type": "sanskrit_verse", "text": "verse"}]),
    ])
    assert json.loads((tmp_path / "verses_0002.json").read_text())[0]["text"] == "verse"


def test_discovery_checksum_detects_recipe_changes_with_same_page_selection(env):
    processor = object.__new__(SingleFileProcessor)
    processor._file_path = str(env.pdf)
    processor._config = env.config
    processor._index_state = SimpleNamespace(calculate_ocr_checksum=lambda *a: "legacy-checksum")
    processor._scan_config = {"language": "hi", "auto_tesseract_pages": [2]}
    first = processor._calculate_ocr_checksum("issue.pdf", [1, 2, 3])
    prepare_ocr_cache(env.pdf, processor._scan_config, env.config)
    processor._scan_config["auto_tesseract_pages"] = [3]
    assert processor._calculate_ocr_checksum("issue.pdf", [1, 2, 3]) != first
    processor._scan_config = {"language": "hi"}
    assert processor._calculate_ocr_checksum("issue.pdf", [1, 2, 3]) not in (first, "legacy-checksum")


def test_discovery_process_resumes_and_reprocesses_changed_overrides(env, monkeypatch, tmp_path):
    path = env.root / "scan_config.json"
    cfg = {"default": {"ocr_engine": "tesseract", "psm": 7, "language": "hi"},
           "issue": {"start_page": 1, "end_page": 3, "auto_tesseract_pages": [2]}}
    path.write_text(json.dumps(cfg))
    state = IndexState(str(tmp_path / "state.sqlite"))
    monkeypatch.setattr(SingleFileProcessor, "_get_metadata", lambda self: {"language": "hi"})
    monkeypatch.setattr(SingleFileProcessor, "_generate_text_files", lambda self: None)
    def run():
        SingleFileProcessor(env.config, str(env.pdf), SimpleNamespace(), state, "test-time").process()
    run()
    assert env.calls == [(1, 7), (3, 7), (2, 3)]
    run()
    assert len(env.calls) == 3
    cfg["issue"]["auto_tesseract_pages"] = [3]
    path.write_text(json.dumps(cfg))
    run()
    assert env.calls[-3:] == [(1, 7), (2, 7), (3, 3)]


@pytest.mark.parametrize("mode", ["online", "batch"])
def test_factory_keeps_the_configured_llm_for_regular_pages(env, monkeypatch, mode):
    class RegularLLM: pass
    monkeypatch.setattr("backend.crawler.pdf_factory.LLMPDFProcessor", lambda *a, **k: RegularLLM())
    monkeypatch.setattr("backend.crawler.pdf_factory.LLMPDFOfflineProcessor", lambda *a, **k: RegularLLM())
    env.config.LLM_WORKERS = 1
    cfg = {"ocr_engine": "llm", "llm_mode": mode}
    assert isinstance(create_pdf_processor(env.config, scan_config=cfg), RegularLLM)
    hybrid = create_pdf_processor(env.config, scan_config={**cfg, "auto_tesseract_pages": [2]})
    assert isinstance(hybrid, HybridPDFProcessor)
    assert isinstance(hybrid.regular_processor, RegularLLM)


def test_paragraph_regions_do_not_merge_and_keep_physical_page(env):
    cfg = {"auto_tesseract_pages": [3]}
    def region(text, left, right):
        return {"page_num": 3, "metadata": {"prose_left_margin": left, "prose_right_margin": right},
                "lines": [{"text": text, "x_start": left, "x_end": right, "line_num": 0}]}
    data = [(3, {"ocr_mode": "auto_tesseract", "regions": [
        region("यह अनुच्छेद केवल बाएँ स्तंभ की सामग्री है।", 20, 280),
        region("यह अनुच्छेद केवल दाएँ स्तंभ की सामग्री है।", 320, 580)]})]
    generator = create_paragraph_generator(env.config, get_language_meta("hi", cfg), scan_config=cfg)
    assert generator.generate_paragraphs(data, cfg) == [
        (3, "यह अनुच्छेद केवल बाएँ स्तंभ की सामग्री है।"),
        (3, "यह अनुच्छेद केवल दाएँ स्तंभ की सामग्री है।")]
