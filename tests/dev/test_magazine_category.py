import json

from backend.api.agent.router import AgentSearchRequest, AgentFilterOptionsRequest, AgentMetadataOptionsRequest, _chunk_from_hit
from backend.api.pdf_export import _build_html
from backend.common.author_filters import filter_categories_for
from backend.common.catalogue import _row_for_directory


def test_agent_accepts_magazine_and_defaults_to_all_four():
    assert AgentSearchRequest(query='आत्मा', language='hi').content_type == ['Pravachan', 'Granth', 'Books', 'Magazine']
    assert AgentSearchRequest(query='આત્મા', language='gu', content_type=['Magazine']).content_type == ['Magazine']
    for model in (AgentFilterOptionsRequest, AgentMetadataOptionsRequest):
        assert model(language='gu', content_type='Magazine').content_type == 'Magazine'


def test_search_defaults_to_all_four_and_preserves_explicit_selection():
    from backend.api.search_api import SearchRequest
    request = SearchRequest(query='आत्मा', language='hindi')
    assert set(request.search_types) == {'Pravachan', 'Granth', 'Books', 'Magazine'}
    assert all(option['enabled'] for option in request.search_types.values())
    selected = {'Magazine': {'enabled': True, 'page_number': 2, 'page_size': 10}}
    assert SearchRequest(query='आत्मा', language='hindi', search_types=selected).search_types == selected


def test_magazine_filters_do_not_inherit_other_category_authors():
    filters = {'Name': ['Atmadharma'], '_books_authors': ['Book author'], '_magazine_authors': ['Editor'], 'Series': ['Other']}
    assert filter_categories_for('Magazine', filters) == {'Name': ['Atmadharma'], 'Author': ['Editor']}
    assert '_magazine_authors' not in filter_categories_for('Books', filters)


def test_agent_preserves_issue_date_and_physical_pdf_page():
    hit = {'_id': 'issue-chunk', '_source': {'metadata': {'category': 'Magazine', 'Name': 'Atmadharma',
        'date': '1977-06', 'metadata': {'ank': '42', 'year': '32'}}, 'page_number': 15, 'pdf_page_number': 16}}
    chunk = _chunk_from_hit(hit, 'hi')
    assert chunk['issue_number'] == '42'
    assert chunk['date'] == '1977-06'
    assert chunk['pdf_page_number'] == 16


def test_catalogue_counts_edition_issues_without_duplicate_pdf_folder(tmp_path):
    folder = tmp_path / 'Magazines/hindi/AtmaDharma'
    (folder / 'pdfs').mkdir(parents=True)
    for path, data in [(tmp_path / 'Magazines/config.json', {'category': 'Magazine'}),
                       (folder.parent / 'config.json', {'language': 'hi'}),
                       (folder / 'config.json', {'Name': 'Atmadharma'}),
                       (folder / 'issues.json', {'issue1': {}, 'issue2': {}})]:
        path.write_text(json.dumps(data))
    row = _row_for_directory(str(folder), str(tmp_path))
    assert row['issue_count'] == 2 and row['category'] == 'Magazine'
    assert _row_for_directory(str(folder / 'pdfs'), str(tmp_path)) is None


def test_export_includes_issue_and_direct_pdf_page():
    html = _build_html('Magazine', 'query', [{'metadata': {'Name': 'Atmadharma', 'date': '1977-06',
        'metadata': {'ank': '42'}}, 'file_url': 'https://example.org/issue.pdf',
        'page_number': 15, 'pdf_page_number': 16, 'content_snippet': 'Evidence'}])
    assert '1977-06' in html and '42' in html and 'Evidence' in html
    assert 'issue.pdf#page=16' in html
