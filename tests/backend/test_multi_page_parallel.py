"""Parallel split OCR: numbering, boundaries, bounded rendering and recovery."""
import json
import threading
from types import SimpleNamespace
import pytest
from PIL import Image
from backend.crawler.advanced_pdf_processor import AdvancedPDFProcessor
from backend.crawler.multi_page_pdf_processor import MultiPagePDFProcessor

class Inner(AdvancedPDFProcessor):
    def __init__(self, root, workers=2):
        self._base_pdf_folder = str(root)
        self._base_ocr_folder = str(root / 'ocr')
        self._config = SimpleNamespace(OCR_MAX_WORKERS=workers)
        self._pytesseract_language_map = {'hi': 'hin'}
        self.rendered = []
    def _get_image(self, pdf, pages, config):
        assert len(pages) == 1
        self.rendered.extend(pages)
        return [Image.new('RGB', (20, 10))], pages

def setup(tmp_path, workers=2, **scan):
    pdf = tmp_path / 'book.pdf'
    pdf.touch()
    inner = Inner(tmp_path, workers)
    return pdf, inner, MultiPagePDFProcessor(inner, scan), tmp_path / 'ocr/book'

def mapping(output):
    return json.loads((output / 'page_mapping.json').read_text())

def test_concurrent_out_of_order_results_keep_numbering(tmp_path, monkeypatch):
    pdf, inner, processor, output = setup(tmp_path, book_start_page=22)
    second_finished = threading.Event()
    def ocr(args):
        page, _, lang, psm = args
        assert (lang, psm) == ('hin', 6)
        if page == 1:
            assert second_finished.wait(3), 'Second task did not run concurrently'
        if page == 2:
            second_finished.set()
        return page, [json.dumps({'page_num': page})]
    monkeypatch.setattr(AdvancedPDFProcessor, '_process_single_page', staticmethod(ocr))
    assert processor.process_pdf(str(pdf), {}, [22, 23])
    assert mapping(output) == {'1': 22, '2': 22, '3': 23, '4': 23}
    for page in range(1, 5):
        assert json.loads((output / f'page_{page:04d}.json').read_text())['page_num'] == page

def test_resume_only_missing_allowed_halves_and_repairs_mapping(tmp_path, monkeypatch):
    pdf, inner, processor, output = setup(tmp_path)
    output.mkdir(parents=True)
    cached = output / 'page_0001.json'
    cached.write_text('cached')
    seen = []
    def ocr(args):
        seen.append(args[0])
        return args[0], ['{}']
    monkeypatch.setattr(AdvancedPDFProcessor, '_process_single_page', staticmethod(ocr))
    assert processor.process_pdf(str(pdf), {}, [1, 2], {1, 2, 3})
    assert sorted(seen) == [2, 3]
    assert cached.read_text() == 'cached'
    assert not (output / 'page_0004.json').exists()
    assert mapping(output) == {'1': 1, '2': 1, '3': 2}
    inner.rendered.clear()
    assert processor.process_pdf(str(pdf), {}, [1, 2], {1, 2, 3})
    assert inner.rendered == []

@pytest.mark.parametrize('mode', ['exception', 'empty', 'write_failure'])
def test_partial_failure_preserves_success_and_retry(tmp_path, monkeypatch, mode):
    pdf, inner, processor, output = setup(tmp_path)
    def ocr(args):
        if args[0] == 2:
            if mode == 'exception':
                raise RuntimeError('failed')
            if mode == 'empty':
                return 2, []
        return args[0], ['{}']
    monkeypatch.setattr(AdvancedPDFProcessor, '_process_single_page', staticmethod(ocr))
    original_write = inner._write_output_to_file
    if mode == 'write_failure':
        monkeypatch.setattr(inner, '_write_output_to_file', lambda folder, results: original_write(folder, results) if results[0][0] != 2 else None)
    assert not processor.process_pdf(str(pdf), {}, [1])
    assert mapping(output) == {'1': 1}
    seen = []
    def retry(args):
        seen.append(args[0])
        return args[0], ['{}']
    monkeypatch.setattr(AdvancedPDFProcessor, '_process_single_page', staticmethod(retry))
    monkeypatch.setattr(inner, '_write_output_to_file', original_write)
    assert processor.process_pdf(str(pdf), {}, [1])
    assert seen == [2]
    assert mapping(output) == {'1': 1, '2': 1}

def test_right_start_and_one_worker(tmp_path, monkeypatch):
    pdf, inner, processor, output = setup(tmp_path, workers=1, book_start_page=5, book_start_side='right')
    monkeypatch.setattr(AdvancedPDFProcessor, '_process_single_page', staticmethod(lambda args: (args[0], ['{}'])))
    assert processor.process_pdf(str(pdf), {}, [5, 6])
    assert mapping(output) == {'1': 5, '2': 6, '3': 6}
    assert not (output / 'page_0000.json').exists()
