#!/usr/bin/env python3
"""Measure safe, issue-specific edge crops using the existing Atmadharma PDFs.

Uses every included physical page, not a sample. Repeated first/last text rows
identify running headers/footers. Native text and illustration bounds protect
reading material; raster ink also protects content on scanned pages. A single
crop must fit the tightest page in an issue, so some headers may remain.
"""
import argparse
from collections import Counter
from concurrent.futures import ProcessPoolExecutor
import csv
import hashlib
import json
import math
from pathlib import Path
import re

VERSION = 7


def normalize(text):
    return re.sub(r'\s+', '', re.sub(r'\d', '#', text)).lower()


def rows_for_page(page):
    import fitz
    rows = []
    for block in page.get_text('dict', flags=fitz.TEXTFLAGS_DICT & ~fitz.TEXT_PRESERVE_IMAGES)['blocks']:
        for line in block.get('lines', []):
            spans = [s for s in line['spans'] if s['size'] >= 7]
            text = ''.join(s['text'] for s in spans).strip()
            if not text:
                continue
            y0 = min(s['bbox'][1] for s in spans) / page.rect.height * 100
            y1 = max(s['bbox'][3] for s in spans) / page.rect.height * 100
            rows.append({'top': y0, 'bottom': y1, 'text': text})
    rows.sort(key=lambda row: row['top'])
    grouped = []
    for row in rows:
        if grouped and abs(row['top'] - grouped[-1]['top']) < .35:
            grouped[-1]['bottom'] = max(grouped[-1]['bottom'], row['bottom'])
            grouped[-1]['text'] += ' ' + row['text']
        else:
            grouped.append(dict(row))
    return grouped


def raster_rows(page):
    import fitz
    import numpy as np
    scale = 650 / page.rect.height
    pix = page.get_pixmap(matrix=fitz.Matrix(scale, scale), colorspace=fitz.csGRAY, alpha=False)
    ink = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width) < 150
    # Ignore scan-edge dirt and long vertical frames, but preserve central text.
    ink = ink[:, int(pix.width * .07):int(pix.width * .93)]
    ink[:, ink.mean(axis=0) > .55] = False
    counts = ink.sum(axis=1)
    active = counts >= max(2, ink.shape[1] * .004)
    indices = np.flatnonzero(active)
    return [round(float(i) / pix.height * 100, 3) for i in indices]


def key_for_row(row):
    return (round(row['top'] * 2) / 2, normalize(row['text']))


def infer_crop(pages):
    occurrences = Counter()
    header_positions = Counter()
    footer_positions = Counter()
    def magazine_title(text):
        return bool(re.search(r'AaTm|ATMADHARM|आ\S*धर्म|આ\S*ધર્મ', re.sub(r'\s+', '', text), re.I))
    def date_line(text):
        return bool(re.search(r'जनवरी|फरवरी|मार्च|अप्रैल|मई|जून|जुलाई|अगस्त|सित[मं]|अ[कक्त]+ूबर|नव[मं]|दिस[मं]', text))
    def edge_metadata(text):
        return (magazine_title(text) or date_line(text) or bool(re.search(
            r'ATMADHARM|Regd\.?|Registration|Shree Kundkund|Printed|Published', text, re.I)))
    for page in pages:
        rows = page['rows']
        edge = []
        if rows and rows[0]['top'] < 16:
            edge.append(rows[0])
            if magazine_title(rows[0]['text']):
                header_positions[round(rows[0]['top'] * 2) / 2] += 1
        for row in rows[-4:]:
            if row['top'] > 78:
                if row is rows[-1] or date_line(row['text']):
                    edge.append(row)
                if date_line(row['text']):
                    footer_positions[round(row['top'] * 2) / 2] += 1
        occurrences.update(set(key_for_row(row) for row in edge if len(normalize(row['text'])) >= 4))
    threshold = max(2, math.ceil(len(pages) * .3))
    repeated = {key for key, count in occurrences.items() if count >= threshold}
    header_anchors = {position for position, count in header_positions.items() if count >= threshold}
    footer_anchors = {position for position, count in footer_positions.items() if count >= threshold}
    details = []
    for page in pages:
        rows = page['rows']
        header = rows[0] if rows and rows[0]['top'] < 16 and (
            (edge_metadata(rows[0]['text']) and key_for_row(rows[0]) in repeated)
            or (magazine_title(rows[0]['text']) and round(rows[0]['top'] * 2) / 2 in header_anchors)) else None
        footer_candidates = [row for row in rows[-4:] if row['top'] > 78 and (
            (edge_metadata(row['text']) and key_for_row(row) in repeated)
            or (date_line(row['text']) and round(row['top'] * 2) / 2 in footer_anchors))]
        footer = min(footer_candidates, key=lambda row: row['top']) if footer_candidates else None
        body = [row for row in rows if (header is None or row['top'] >= header['bottom'] - .2)
                and (footer is None or row['top'] < footer['top'] - .1)]
        first = min((row['top'] for row in body), default=100)
        last = max((row['bottom'] for row in body), default=0)
        if page['raster_rows'] is not None:
            lower = min(header['bottom'] + .15, first) if header else 0
            upper = max(footer['top'] - .15, last) if footer else 100
            pixels = [y for y in page['raster_rows'] if lower <= y <= upper]
            if pixels:
                first = min(pixels)
                last = max(pixels) + 100 / 650
        # Images are often stored as full-width strips with large white areas.
        # Their storage rectangles are not content bounds: use their rendered
        # ink, including picture ink, whenever raster measurements are available.
        for top, bottom in page['illustrations']:
            if page['raster_rows'] is None or (20 <= bottom - top < 95 and len(page['illustrations']) < 10):
                first = min(first, top)
                last = max(last, bottom)
        if first == 100 or last == 0:
            if not rows and page['raster_rows'] == []:
                details.append({'page': page['page'], 'first_body': 100, 'last_body': 0,
                                'header_bottom': None, 'footer_top': None, 'blank': True})
                continue
            first, last = 0, 100
        details.append({'page': page['page'], 'first_body': round(first, 3), 'last_body': round(last, 3),
                        'header_bottom': round(header['bottom'], 3) if header else None,
                        'footer_top': round(footer['top'], 3) if footer else None})
    # Keep a guard of roughly three pixels at inspection resolution, then move
    # each cut to whitespace shared by every page so no text row is sliced.
    if all(page.get('blank') for page in details):
        return {'crop': {'top': 0, 'bottom': 0}, 'pages': details,
                'headers_retained': [], 'footers_retained': []}
    top = max(0, min(15, min(p['first_body'] for p in details) - .4))
    bottom = max(0, min(22, 100 - max(p['last_body'] for p in details) - .4))
    crop = {'top': math.floor(top * 10) / 10, 'bottom': math.floor(bottom * 10) / 10}
    occupied = set()
    for page in pages:
        for position in page['raster_rows'] or []:
            occupied.update(round((position + delta) * 10) for delta in (-.1, 0, .1))
    for edge in ('top', 'bottom'):
        while crop[edge] > 0:
            line = crop[edge] if edge == 'top' else 100 - crop[edge]
            if round(line * 10) not in occupied:
                break
            crop[edge] = round(max(0, crop[edge] - .1), 1)
    clipped = [p['page'] for p in details if not p.get('blank') and ((crop['top'] > 0 and crop['top'] >= p['first_body'])
               or (crop['bottom'] > 0 and 100 - crop['bottom'] <= p['last_body']))]
    if clipped:
        raise ValueError(f'Crop intersects body bounds on pages {clipped}')
    retained_header, retained_footer = [], []
    for detail, source in zip(details, pages):
        pixels = source['raster_rows'] or []
        header_ink = [y for y in pixels if detail['header_bottom'] is not None and y < detail['header_bottom']]
        footer_ink = [y for y in pixels if detail['footer_top'] is not None and y > detail['footer_top']]
        if header_ink and crop['top'] <= max(header_ink):
            retained_header.append(detail['page'])
        if footer_ink and 100 - crop['bottom'] >= min(footer_ink):
            retained_footer.append(detail['page'])
    return {'crop': crop, 'pages': details, 'headers_retained': retained_header, 'footers_retained': retained_footer}


def analyze(job):
    import fitz
    pdf, included, cache = job
    path = Path(pdf)
    stat = path.stat()
    fingerprint = [stat.st_size, stat.st_mtime_ns, included]
    target = Path(cache) / (hashlib.sha256(pdf.encode()).hexdigest() + '.json')
    if target.exists():
        old = json.loads(target.read_text())
        if old.get('fingerprint') == fingerprint and old.get('source_pages'):
            if old.get('algorithm_version') == VERSION:
                return old
            if any(p['raster_rows'] is None for p in old['source_pages']):
                with fitz.open(path) as doc:
                    for page in old['source_pages']:
                        if page['raster_rows'] is None:
                            page['raster_rows'] = raster_rows(doc[page['page'] - 1])
            result = {**old, 'algorithm_version': VERSION, **infer_crop(old['source_pages'])}
            target.write_text(json.dumps(result, ensure_ascii=False))
            return result
    pages = []
    with fitz.open(path) as doc:
        for number in included:
            page = doc[number - 1]
            rows = rows_for_page(page)
            images = page.get_image_info()
            illustrations = []
            for image in images:
                x0, y0, x1, y1 = image['bbox']
                if (x1 - x0) * (y1 - y0) > page.rect.width * page.rect.height * .75:
                    continue
                else:
                    illustrations.append((y0 / page.rect.height * 100, y1 / page.rect.height * 100))
            pages.append({'page': number, 'rows': rows, 'illustrations': illustrations,
                          'raster_rows': raster_rows(page)})
    result = {'filename': path.name, 'fingerprint': fingerprint, 'algorithm_version': VERSION,
              'source_pages': pages, **infer_crop(pages)}
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(result, ensure_ascii=False))
    return result


def calibrate(args):
    scan_path = args.folder / 'scan_config.json'
    scan = json.loads(scan_path.read_text())
    original_crops = {key: entry.get('crop') for key, entry in scan.items() if key != 'default'}
    jobs = []
    for key, entry in scan.items():
        if key == 'default':
            continue
        included = sorted(set(range(entry['start_page'], entry['end_page'] + 1)) - set(entry.get('skip_pdf_pages', [])))
        jobs.append((str(args.folder / 'pdfs' / (key + '.pdf')), included, str(args.cache)))
    results = []
    with ProcessPoolExecutor(max_workers=args.workers) as pool:
        for i, result in enumerate(pool.map(analyze, jobs), 1):
            results.append(result)
            if i % 25 == 0 or i == len(jobs):
                print(f'Crop analysis: {i}/{len(jobs)} PDFs', flush=True)
    report = []
    for result in results:
        key = Path(result['filename']).stem
        entry = scan[key]
        notes = []
        if result['crop']['top'] == 0 or result['crop']['bottom'] == 0:
            notes.append('zero edge retained: inspect limiting page before increasing crop')
        if result['headers_retained'] or result['footers_retained']:
            notes.append('some headers/footers retained to preserve a uniform safe crop')
        report.append({'Filename': result['filename'], 'Language': entry['language'],
                       'Top Crop %': result['crop']['top'], 'Bottom Crop %': result['crop']['bottom'],
                       'Pages Checked': len(result['pages']),
                       'Limiting Top Page': min(result['pages'], key=lambda p: p['first_body'])['page'],
                       'Limiting Bottom Page': max(result['pages'], key=lambda p: p['last_body'])['page'],
                       'Headers Retained Pages': ','.join(map(str, result['headers_retained'])),
                       'Footers Retained Pages': ','.join(map(str, result['footers_retained'])),
                       'Review Notes': '; '.join(notes),
                       'PDF URL': entry['file_url']})
        if args.apply:
            entry['crop'] = {**entry.get('crop', {}), **result['crop']}
    with (args.folder / 'crop-analysis.csv').open('w', encoding='utf-8-sig', newline='') as handle:
        writer = csv.DictWriter(handle, fieldnames=list(report[0]))
        writer.writeheader()
        writer.writerows(report)
    if args.apply:
        current = json.loads(scan_path.read_text())
        # Preserve other settings edited in eval while the inspection ran.
        for result in results:
            key = Path(result['filename']).stem
            if current[key].get('crop') != original_crops[key]:
                raise ValueError(f'{key}: crop changed during inspection; rerun before applying')
            for field in ('file_url', 'start_page', 'end_page', 'skip_pdf_pages'):
                if current[key].get(field) != scan[key].get(field):
                    raise ValueError(f'{key}: {field} changed during crop inspection; rerun before applying')
            current[key]['crop'] = {**current[key].get('crop', {}), **result['crop']}
        current['default'].pop('crop', None)
        temp = scan_path.with_suffix('.json.tmp')
        temp.write_text(json.dumps(current, ensure_ascii=False, indent=2) + '\n')
        temp.replace(scan_path)
    print(json.dumps({'pdfs': len(report), 'pages_checked': sum(r['Pages Checked'] for r in report),
                      'applied': args.apply, 'crop_pairs': dict(Counter(str((r['Top Crop %'], r['Bottom Crop %'])) for r in report).most_common(12))}, indent=2))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--folder', type=Path, help='One edition folder; defaults to both AtmaDharma language editions')
    parser.add_argument('--cache', type=Path, default=Path('/tmp/atmadharma-crops'))
    parser.add_argument('--workers', type=int, default=6)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2] / 'cataloguesearch-configs/Magazines'
    folders = [args.folder] if args.folder else [root / language / 'AtmaDharma' for language in ('gujarati', 'hindi')]
    for folder in folders:
        calibrate(argparse.Namespace(**{**vars(args), 'folder': folder}))


if __name__ == '__main__':
    main()
