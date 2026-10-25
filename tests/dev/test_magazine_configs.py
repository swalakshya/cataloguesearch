"""Magazine manifests, download destinations and content exclusion safeguards."""
import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from backend.common.utils import get_merged_config
from backend.crawler.discovery import Discovery
from scripts.prepare_magazine_configs import classify_page, issue_metadata, cover_date


def dump(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value))


def test_issue_metadata_and_sidecar_precedence(tmp_path):
    folder = tmp_path / 'Magazines' / 'Atmadharma'
    pdf = folder / 'pdfs' / 'issue.pdf'
    pdf.parent.mkdir(parents=True)
    pdf.touch()
    dump(folder / 'config.json', {'Name': 'Atmadharma', 'category': 'Magazine'})
    dump(folder / 'issues.json', {'issue': {'language': 'gu', 'date': '1970-01', 'metadata': {'ank': 12}},
                                 'other': {'language': 'mr'}})
    merged = get_merged_config(str(pdf), str(tmp_path))
    assert merged == {'Name': 'Atmadharma', 'category': 'Magazine', 'language': 'gu',
                      'date': '1970-01', 'metadata': {'ank': 12}}
    dump(pdf.with_name('issue_config.json'), {'date': '1970-02'})
    assert get_merged_config(str(pdf), str(tmp_path))['date'] == '1970-02'


@pytest.mark.parametrize('subdirectory', ['.', 'pdfs'])
def test_downloader_uses_configured_destination(tmp_path, monkeypatch, subdirectory):
    dump(tmp_path / 'scan_config.json', {'default': {'pdf_subdirectory': subdirectory},
                                       'issue': {'file_url': 'https://example.org/issue.pdf'}})
    calls = []
    response = SimpleNamespace(raise_for_status=lambda: None, iter_content=lambda **kw: [b'%PDF-test'])
    def get(url, **kwargs):
        calls.append(url)
        return response
    monkeypatch.setattr('backend.crawler.discovery.requests.get', get)
    discovery = object.__new__(Discovery)
    discovery._download_missing_pdfs(str(tmp_path))
    assert (tmp_path / subdirectory / 'issue.pdf').read_bytes() == b'%PDF-test'
    discovery._download_missing_pdfs(str(tmp_path))
    assert len(calls) == 1


def test_download_subdirectory_cannot_escape(tmp_path, monkeypatch):
    dump(tmp_path / 'scan_config.json', {'default': {'pdf_subdirectory': '../outside'},
                                       'issue': {'file_url': 'https://example.org/issue.pdf'}})
    monkeypatch.setattr('backend.crawler.discovery.requests.get', lambda *a, **kw: pytest.fail('unsafe request'))
    object.__new__(Discovery)._download_missing_pdfs(str(tmp_path))


def test_news_beside_contents_is_preserved():
    assert classify_page('सोनगढ़ समाचार आवश्यकता है। विषय-सूची लेख १ २', 2, 30, 'atmadharma', 'hindi') is None
    assert classify_page('विषय-सूची\nलेख १\nकविता २', 2, 30, 'atmadharma', 'hindi') == 'contents / index'


def test_mixed_imprint_and_article_is_preserved():
    text = 'संपादक प्रकाशक कार्यालय वार्षिक\nआचार्य कहते हैं आत्मा को समझना है। यह करना होता है।'
    assert classify_page(text, 2, 36, 'vitrag-vigyan', 'hi') is None


@pytest.mark.parametrize('text', ['समाचार\nसभा में सभी लोग आये।', 'संपादकीय\nआत्मज्ञान पर विचार।', 'कविता\nप्रभु की वाणी।'])
def test_reading_material_is_preserved(text):
    assert classify_page(text, 1, 5, 'vitrag-vigyan', 'hi') is None


def test_hindi_date_is_not_invented_from_gujarati_pair():
    row = {'English Month': 'Nov-Dec', 'English Year': '1943', 'Gujarati Date': 'Magshar 2000',
           'Hindi Date': '', 'Vikram Samvat': '2000', 'Veer Samvat': '2470',
           'Hindi Number': '1', 'Number': '1', 'Hindi Year': '1', 'Year': '1'}
    item = {'magazine': 'atmadharma', 'language': 'hindi', 'url': 'https://example.org/issue.pdf'}
    metadata = issue_metadata(item, [row])
    assert 'date' not in metadata
    assert metadata['metadata']['english_date_source'] == 'Nov-Dec 1943'


def test_cover_date_requires_explicit_gregorian_year():
    assert cover_date('नवम्बर : १९५७ वर्ष तेरहवाँ') == '1957-11'
    assert cover_date('जनवरी 1977 अंक ८') == '1977-01'
    assert cover_date('कार्तिक २००० वीर संवत २४७०') is None
    assert cover_date('मई २४७०') is None


def test_discover_separates_language_first_magazine_editions(tmp_path, monkeypatch):
    import fitz
    from ingest import status
    db = tmp_path / 'state.db'
    db.touch()
    dump(tmp_path / 'Magazines/config.json', {'category': 'Magazine'})
    for language, code in [('gujarati', 'gu'), ('hindi', 'hi')]:
        edition = tmp_path / 'Magazines' / language / 'AtmaDharma'
        dump(edition.parent / 'config.json', {'language': code})
        dump(edition / 'config.json', {'Name': 'Atmadharma'})
        dump(edition / 'scan_config.json', {'default': {'ocr_engine': 'tesseract'},
                                           'issue': {'start_page': 1, 'end_page': 1, 'crop': {'top': 5, 'bottom': 4}}})
        pdf = edition / 'pdfs/issue.pdf'
        pdf.parent.mkdir()
        with fitz.open() as document:
            document.new_page()
            document.save(pdf)
        assert get_merged_config(str(pdf), str(tmp_path))['language'] == code
    class EmptyState:
        def __init__(self, path): pass
        def load_state(self): return {}
        def list_pending_batch_jobs(self): return []
    monkeypatch.setattr(status, '_load_config', lambda: SimpleNamespace(BASE_PDF_PATH=str(tmp_path), SQLITE_DB_PATH=str(db)))
    monkeypatch.setattr(status, 'IndexState', EmptyState)
    result = status.scan()
    magazine = next(c for c in result['categories'] if c['name'] == 'Magazine')
    assert {f['dir']: f['pending'] for f in magazine['folders']} == {
        'Magazines/gujarati/AtmaDharma': 1, 'Magazines/hindi/AtmaDharma': 1}
    assert all(folder['runnable'] for folder in magazine['folders'])
