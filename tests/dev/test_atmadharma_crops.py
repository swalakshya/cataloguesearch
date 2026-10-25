"""Protect text and illustrations when choosing one crop for a whole issue."""
from copy import deepcopy

from scripts.calibrate_atmadharma_crops import infer_crop


def issue():
    return [{'page': n, 'rows': [
        {'top': 6.9, 'bottom': 8.7, 'text': f'AaTm\\mR : 48 : {n}'},
        {'top': 9.5, 'bottom': 11.5, 'text': f'Body starts on page {n}'},
        {'top': 88, 'bottom': 92, 'text': f'Body ends on page {n}'},
        {'top': 95, 'bottom': 97, 'text': f'जून १९७७ {n}'},
    ], 'illustrations': [], 'raster_rows': [7.2, 7.5, 7.8, 10, 10.3, 88, 89, 90, 95.5, 96]}
        for n in (1, 2, 3)]


def test_remove_repeated_headers_and_footers_without_cutting_body():
    result = infer_crop(issue())
    assert 7.8 < result['crop']['top'] < 10
    assert 90.2 < 100 - result['crop']['bottom'] < 95.5
    assert result['headers_retained'] == result['footers_retained'] == []


def test_single_tight_page_limits_crop_for_entire_issue():
    pages = issue()
    pages[1]['illustrations'] = [(4.0, 98.0)]
    pages[1]['raster_rows'] += [4, 98]
    pages[1]['rows'] = pages[1]['rows'][1:]  # Picture begins above the first text row.
    crop = infer_crop(pages)['crop']
    assert crop['top'] < 4
    assert crop['bottom'] < 2


def test_raster_preserves_title_missing_from_native_text():
    pages = issue()
    for page in pages:
        page['rows'] = page['rows'][1:]
        page['raster_rows'] = [4, 4.5, 5, 10, 90, 95.5, 96]
    assert infer_crop(pages)['crop']['top'] < 4


def test_body_touching_edge_allows_zero_crop():
    pages = issue()
    pages[0]['illustrations'] = [(0, 100)]
    pages[0]['raster_rows'] += [0, 100]
    pages[0]['rows'] = pages[0]['rows'][1:-1]
    assert infer_crop(pages)['crop'] == {'top': 0, 'bottom': 0}


def test_blank_page_does_not_force_zero_crop():
    pages = issue()
    expected = infer_crop(pages)['crop']
    pages.append({'page': 4, 'rows': [], 'illustrations': [], 'raster_rows': []})
    assert infer_crop(pages)['crop'] == expected


def test_white_image_storage_strips_do_not_force_zero_crop():
    pages = issue()
    expected = infer_crop(pages)['crop']
    pages[1]['illustrations'] = [(0, 100)]
    assert infer_crop(pages)['crop'] == expected


def test_inputs_remain_unchanged():
    pages = issue()
    original = deepcopy(pages)
    infer_crop(pages)
    assert pages == original
