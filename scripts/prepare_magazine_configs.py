#!/usr/bin/env python3
"""Prepare Atmadharma issue configurations from downloaded, catalogued PDFs.

The inspection cache records native text for every page and OCR for selected
boundary pages. Exclusions and uncertain decisions are exported for review;
these rules are deliberately conservative about removing reading material.
All page numbers are physical, one-based PDF pages.
"""

import argparse
from concurrent.futures import ProcessPoolExecutor, as_completed
import csv
import hashlib
import json
import os
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + '.tmp')
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
    temp.replace(path)


def cache_path(cache, item):
    return Path(cache) / (hashlib.sha256(item['url'].encode()).hexdigest() + '.json')


def inspect_pdf(args):
    import fitz
    item, cache = args
    target = cache_path(cache, item)
    stat = Path(item['path']).stat()
    fingerprint = [stat.st_size, stat.st_mtime_ns]
    if target.exists():
        old = json.loads(target.read_text())
        if old.get('fingerprint') == fingerprint:
            return old
    pages = []
    with fitz.open(item['path']) as doc:
        for page in doc:
            text = page.get_text(sort=True)
            pages.append({'page': page.number + 1, 'text': text,
                          'indic_chars': sum('\u0900' <= c <= '\u0aff' for c in text)})
    result = {'item': item, 'fingerprint': fingerprint, 'total_pages': len(pages), 'pages': pages}
    write_json(target, result)
    return result


def ocr_page(args):
    os.environ['OMP_THREAD_LIMIT'] = '1'
    import fitz
    from PIL import Image
    import pytesseract
    item, cache, number = args
    target = cache_path(cache, item).with_name(cache_path(cache, item).stem + f'-p{number}-ocr.json')
    if target.exists():
        return json.loads(target.read_text())
    language = 'guj+hin' if item['language'] == 'gujarati' else 'mar+hin' if item['language'] == 'mr' else 'hin'
    with fitz.open(item['path']) as doc:
        page = doc[number - 1]
        pix = page.get_pixmap(matrix=fitz.Matrix(1600 / max(page.rect.width, page.rect.height),
                                               1600 / max(page.rect.width, page.rect.height)), alpha=False)
        image = Image.frombytes('RGB', [pix.width, pix.height], pix.samples)
        try:
            text = pytesseract.image_to_string(image, lang=language, config='--psm 3', timeout=40)
            result = {'url': item['url'], 'page': number, 'text': text, 'method': 'tesseract-psm3'}
        except RuntimeError as exc:
            result = {'url': item['url'], 'page': number, 'text': '', 'error': str(exc)}
    write_json(target, result)
    return result


def read_csv(path):
    with Path(path).open(encoding='utf-8-sig', newline='') as handle:
        return list(csv.DictReader(handle))


def classify_page(text, number, total, magazine, language, first_text=''):
    """Return an exclusion reason only when there is positive evidence.

    Legacy Gujarati glyph strings come from this publisher's embedded font;
    they are matched alongside real Unicode, rather than mistaken for English.
    """
    compact = re.sub(r'\s+', ' ', text).strip()
    head = compact[:650]
    if 'Shree Kundkund-Kahan Parmarthik Trust' in compact and 'Atmadharma is a magazine' in compact:
        return 'digitization notice'
    if 'Version History' in compact and 'First electronic version' in compact:
        return 'digitization notice'
    index_match = any(re.search(pattern, head, re.I) for pattern in (
        r'विषय\s*[-–]?\s*सूची', r'अनुक्रमणिका', r'विषयानुक्रम', r'इस\s+अंक\s+में',
        r'વિષય\s*સૂચિ', r'અનુક્રમણિકા', r'kÞvarI', r'ivØy\s*sUcI',
        r'AHk.*su\\ImaH Aavela leqo',
    ))
    # A few pages put news and a contents list side by side. Whole-page
    # exclusions must not throw away the news column along with the index.
    mixed_news = 'समाचार' in head[:200] and not head.startswith(('विषय', 'अनुक्रम'))
    if index_match and not mixed_news:
        return 'contents / index'
    if any(phrase in head for phrase in ('आद्य निवेदन', 'प्रारम्भिक निवेदन', 'प्रारंभिक निवेदन')):
        return 'introductory notice'
    if any(phrase in head for phrase in (
        'हमारे यहाँ प्राप्त प्रकाशन', 'हमारे यहां प्राप्त प्रकाशन', 'मूल्य सूची',
        'प्रकाशनों की सूची', 'पुस्तकों की सूची', 'સાહિત્યની યાદી', 'પ્રકાશનોની યાદી',
        'પુસ્તકોની યાદી', 'અહીંથી મળતું સાહિત્ય',
    )):
        return 'publication catalogue'
    if any(phrase in head[:350] for phrase in (
        'nvuH Ýkaxn', 'નવું પ્રકાશન', 'નવીન પ્રકાશન', 'હિન્દી ભાષામાં પ્રકાશિત થયું',
    )):
        return 'publication advertisement'
    if number >= total - 1 and len(compact) < 1900 and 'સમાચાર' not in head:
        book_heading = any(word in head[:350] for word in ('પુસ્તક', 'સાહિત્ય', 'ગ્રંથ', 'પ્રવચનો', 'શાસ્ત્રમાળા'))
        price = any(word in compact for word in ('કિંમત', 'મૂલ્ય', 'રૂ.', 'રૂા.', 'રૂ॥'))
        purchase = any(word in compact for word in ('મંગાવ', 'ટપાલ', 'પોસ્ટેજ', 'મળશે', 'મળે છે'))
        if book_heading and price and purchase:
            return 'publication advertisement'
    if number >= total - 1 and len(compact) < 3000 and 'સમાચાર' not in head:
        book_heading = any(word in head[:350] for word in ('પુસ્તક', 'સાહિત્ય', 'ગ્રંથ', 'પ્રવચન', 'શાસ્ત્ર'))
        sales_details = any(word in compact for word in ('પ્રાપ્તિસ્થાન', 'ટપાલ', 'પોસ્ટેજ'))
        if book_heading and compact.count('કિંમત') >= 2 and sales_details:
            return 'publication advertisement'
    if any(phrase in head for phrase in ('દાતાઓની યાદી', 'दानदाताओं की सूची', 'सहयोगियों की सूची')):
        return 'donor list'
    if ('iv>a=±g<h' in head and ('iv>a=±Ao' in compact or 'AWyas' in compact)):
        return 'school admission advertisement'
    if number == 2 and language == 'gujarati' and ('Atmadharma is a magazine' in first_text or 'Version History' in first_text):
        # This digital edition consistently inserts a trust notice before its cover.
        return 'magazine cover / masthead'
    if number <= 3:
        roles = sum(word in compact for word in ('संपादक', 'सम्पादक', 'प्रकाशक', 'कार्यालय', 'वार्षिक', 'व्यवस्थापक'))
        prose = sum(word in compact for word in ('होता है', 'करना', 'इसप्रकार', 'आत्मा', 'समझना', 'आचार्य', 'क्योंकि', 'धर्म तो'))
        if roles >= 4 and len(compact) < 2100 and prose < 2:
            return 'imprint / subscription information'
        if number == 1 and magazine == 'atmadharma' and language == 'hindi':
            return 'magazine cover / masthead'
    if number <= 4 and language == 'gujarati' and head.startswith('Aavte AHke'):
        return 'next issue promotional introduction'
    # Subscription requests at the end are excluded only with multiple signals.
    if number >= total - 1 and ('g‡ahk' in compact or 'gRahk' in compact) and 'ivnHit' in compact and 'maisk' in compact:
        return 'subscription notice'
    if number >= total - 1 and all(word in compact for word in ('લવાજમ', 'ગ્રાહક', 'વિનંતી')) and len(compact) < 1300:
        return 'subscription notice'
    return None


def cover_date(text):
    """Read an explicit Gregorian month/year; never convert a lunar year."""
    text = text.translate(str.maketrans('०१२३४५६७८९', '0123456789'))
    months = [('जनवरी', 1), ('फरवरी', 2), ('फ़रवरी', 2), ('फरबरी', 2), ('मार्च', 3),
              ('अप्रैल', 4), ('मई', 5), ('जून', 6), ('जुलाई', 7), ('अगस्त', 8),
              ('सितम्बर', 9), ('सितंबर', 9), ('अक्टूबर', 10), ('अक्तूबर', 10),
              ('नवम्बर', 11), ('नवंबर', 11), ('दिसम्बर', 12), ('दिसंबर', 12)]
    for name, month in months:
        match = re.search(re.escape(name) + r'\s*[:：,/–-]?\s*((?:19|20)\d{2})(?!\d)', text)
        if match:
            return f'{match[1]}-{month:02d}'
    return None


def issue_metadata(item, source_rows, first_page_text=''):
    language = {'gujarati': 'gu', 'hindi': 'hi'}.get(item['language'], item['language'])
    metadata = {'language': language, 'file_url': item['url'], 'metadata': {'source_rows': source_rows}}
    row = source_rows[0]
    # The source often supplies overlapping month/year ranges: retain them
    # faithfully instead of manufacturing a day or a single publication month.
    month = row['English Month']
    year = row['English Year']
    months = dict(zip(('jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'), range(1, 13)))
    precision = 'unknown'
    if month.lower()[:3] in months and re.match(r'^\d{4}', year):
        metadata['date'] = f"{year[:4]}-{months[month.lower()[:3]]:02d}"
        precision = 'range start (month)' if '-' in month or '-' in year else 'month'
    edition = 'Gujarati' if language == 'gu' else 'Hindi'
    metadata['metadata'].update({'date_precision': precision,
                                'gujarati_date': row['Gujarati Date'], 'hindi_date': row['Hindi Date'],
                                'vikram_samvat': row['Vikram Samvat'], 'veer_samvat': row['Veer Samvat'],
                                'ank': row[f'{edition} Number'] if edition == 'Hindi' else row['Number'],
                                'year': row['Hindi Year'] if edition == 'Hindi' else row['Year'],
                                'english_date_source': f'{month} {year}'.strip()})
    if language == 'hi':
        # English/Gujarati dates belong to the paired source row; the site
        # supplies no separate Hindi publication date. Do not misattribute it.
        metadata.pop('date', None)
        metadata['metadata']['date_precision'] = 'unknown (paired Gujarati date retained separately)'
        explicit_date = cover_date(first_page_text)
        if explicit_date:
            metadata['date'] = explicit_date
            metadata['metadata']['date_precision'] = 'month'
            metadata['metadata']['date_source'] = 'PDF cover (Gregorian month/year)'
    return metadata


def generate(args, items):
    from collections import Counter, defaultdict
    sources = {'atmadharma': read_csv(ROOT / 'data/magazines/atmadharma.csv')}
    flags = defaultdict(list)
    for row in read_csv(args.downloads / 'atmadharma/reports/multi-column-pages.csv'):
        flags[row['PDF URL']].append(int(row['PDF Page']))
    summary = {}
    write_json(args.configs / 'Magazines/config.json', {'category': 'Magazine'})
    for language, language_code in [('gujarati', 'gu'), ('hindi', 'hi')]:
        slug, title = 'atmadharma', 'AtmaDharma'
        edition_root = args.configs / 'Magazines' / language
        write_json(edition_root / 'config.json', {'language': language_code})
        folder = edition_root / title
        (folder / 'pdfs').mkdir(parents=True, exist_ok=True)
        (folder / 'pdfs/.gitkeep').touch()
        write_json(folder / 'config.json', {'Name': 'Atmadharma'})
        previous_scan = json.loads((folder / 'scan_config.json').read_text()) if (folder / 'scan_config.json').exists() else {}
        scan = {'default': {'ocr_engine': 'tesseract', 'psm': 6, 'ignore_bookmarks': True,
                            'pdf_subdirectory': 'pdfs'}}
        issues, decisions, review, table = {}, [], [], []
        counts = Counter()
        for item in sorted((i for i in items if i['magazine'] == slug and i['language'] == language), key=lambda i: i['filename']):
            record = json.loads(cache_path(args.cache, item).read_text())
            n = record['total_pages']
            excluded = {}
            for page in record['pages']:
                p = page['page']
                text = page['text']
                native_reason = classify_page(text, p, n, slug, item['language'], record['pages'][0]['text'])
                ocr_path = cache_path(args.cache, item).with_name(cache_path(args.cache, item).stem + f'-p{p}-ocr.json')
                method = 'native text'
                if ocr_path.exists():
                    ocr = json.loads(ocr_path.read_text())
                    if ocr.get('text', '').strip():
                        text = ocr['text']
                        method = 'tesseract boundary OCR'
                reason = native_reason or classify_page(text, p, n, slug, item['language'], record['pages'][0]['text'])
                if native_reason:
                    method = 'native text'
                if reason:
                    excluded[p] = reason
                    decisions.append({'Filename': item['filename'], 'PDF URL': item['url'], 'PDF Page': p,
                                      'Decision': 'exclude', 'Reason': reason, 'Method': method,
                                      'Page URL': item['url'] + f'#page={p}'})
                elif p <= 3 or p >= n - 1 or ('समाचार' in text[:400] and re.search(r'विषय\s*[-–]?\s*सूची', text[:1500])):
                    mixed_index = 'समाचार' in text[:400] and bool(re.search(r'विषय\s*[-–]?\s*सूची', text[:1500]))
                    review.append({'Filename': item['filename'], 'PDF URL': item['url'], 'PDF Page': p,
                                   'Decision': 'keep', 'Reason': 'mixed index/news: needs region-specific exclusion; news preserved' if mixed_index else 'reading material or ambiguous; retained to avoid text loss',
                                   'Method': method, 'Page URL': item['url'] + f'#page={p}'})
            kept = [p for p in range(1, n + 1) if p not in excluded]
            if not kept:
                raise ValueError(f'All pages excluded: {item["filename"]}')
            start, end = kept[0], kept[-1]
            skipped = sorted(p for p in excluded if start <= p <= end)
            auto = flags[item['url']]
            auto = sorted(p for p in auto if p in set(kept))
            key = Path(item['filename']).stem
            if key in issues:
                raise ValueError(f'Duplicate PDF key: {key}')
            scan[key] = {'file_url': item['url'], 'language': {'gujarati': 'gu', 'hindi': 'hi'}.get(item['language'], item['language']),
                         'start_page': start, 'end_page': end, 'auto_tesseract_pages': auto}
            if 'crop' in previous_scan.get(key, {}):
                scan[key]['crop'] = previous_scan[key]['crop']
            if skipped:
                scan[key]['skip_pdf_pages'] = skipped
            rows = [row for row in sources[slug] if item['url'] in (
                (row['Gujarati PDF'], row['Hindi PDF']) if slug == 'atmadharma' else (row['PDF'],))]
            cover_text = record['pages'][0]['text']
            first_ocr_path = cache_path(args.cache, item).with_name(cache_path(args.cache, item).stem + '-p1-ocr.json')
            if first_ocr_path.exists():
                cover_text += '\n' + json.loads(first_ocr_path.read_text()).get('text', '')
            issues[key] = issue_metadata(item, rows, cover_text)
            table.append({'Filename': item['filename'], 'Language': scan[key]['language'],
                          'Date': issues[key].get('date', ''), 'Date Precision': issues[key]['metadata']['date_precision'],
                          'English Date Source': issues[key]['metadata']['english_date_source'],
                          'Ank': issues[key]['metadata']['ank'], 'Year': issues[key]['metadata']['year'],
                          'Vikram Samvat': issues[key]['metadata']['vikram_samvat'],
                          'Veer Samvat': issues[key]['metadata']['veer_samvat'],
                          'PDF Pages': n, 'Start Page': start, 'End Page': end,
                          'Top Crop %': scan[key].get('crop', {}).get('top', ''),
                          'Bottom Crop %': scan[key].get('crop', {}).get('bottom', ''),
                          'Skip PDF Pages': ','.join(map(str, skipped)),
                          'Auto Tesseract Pages': ','.join(map(str, auto)), 'PDF URL': item['url']})
            # Hardlinks reuse the downloaded bytes without an additional 11 GB copy.
            destination = folder / 'pdfs' / item['filename']
            if not destination.exists():
                os.link(item['path'], destination)
            counts.update({'pdfs': 1, 'pages': n, 'included_pages': len(kept),
                           'excluded_pages': len(excluded), 'auto_tesseract_pages': len(auto),
                           'internal_skipped_pages': len(skipped)})
        write_json(folder / 'scan_config.json', scan)
        write_json(folder / 'issues.json', issues)
        with (folder / 'issues.csv').open('w', encoding='utf-8-sig', newline='') as handle:
            writer = csv.DictWriter(handle, fieldnames=list(table[0]))
            writer.writeheader()
            writer.writerows(table)
        for filename, rows in [('page-exclusions.csv', decisions), ('boundary-review.csv', review)]:
            with (folder / filename).open('w', encoding='utf-8-sig', newline='') as handle:
                writer = csv.DictWriter(handle, fieldnames=['Filename', 'PDF URL', 'PDF Page', 'Decision', 'Reason', 'Method', 'Page URL'])
                writer.writeheader()
                writer.writerows(rows)
        unavailable = [i for i in json.loads((args.downloads / slug / 'downloads.json').read_text()) if i.get('download_status') == 'failed']
        write_json(folder / 'unavailable.json', unavailable)
        counts['unavailable_pdfs'] = len(unavailable)
        summary[f'{language}/{title}'] = dict(counts)
    write_json(args.configs / 'Magazines/preparation-summary.json', summary)
    print(json.dumps(summary, indent=2), flush=True)


def run_jobs(worker, jobs, workers):
    results = []
    with ProcessPoolExecutor(max_workers=workers) as pool:
        futures = [pool.submit(worker, job) for job in jobs]
        for i, future in enumerate(as_completed(futures), 1):
            results.append(future.result())
            if i % 50 == 0 or i == len(futures):
                print(f'{worker.__name__}: {i}/{len(futures)}', flush=True)
    return results


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--downloads', type=Path, default=Path.home() / 'Downloads')
    parser.add_argument('--cache', type=Path, default=Path('/tmp/magazine-preparation'))
    parser.add_argument('--workers', type=int, default=6)
    parser.add_argument('--phase', choices=['inspect', 'ocr-atma', 'ocr-tail', 'generate'], required=True)
    parser.add_argument('--configs', type=Path, default=ROOT.parent / 'cataloguesearch-configs')
    args = parser.parse_args()
    items = []
    for name in ('atmadharma',):
        for item in json.loads((args.downloads / name / 'downloads.json').read_text()):
            if item.get('download_status') in ('downloaded', 'cached'):
                items.append({**item, 'magazine': name})
    if args.phase == 'inspect':
        run_jobs(inspect_pdf, [(item, str(args.cache)) for item in items], args.workers)
    elif args.phase in ('ocr-atma', 'ocr-tail'):
        jobs = []
        for item in items:
            if item['magazine'] != 'atmadharma':
                continue
            record = json.loads(cache_path(args.cache, item).read_text())
            if args.phase == 'ocr-tail':
                last = record['pages'][-1]
                if item['language'] == 'gujarati' or last['indic_chars'] < 50:
                    jobs.append((item, str(args.cache), record['total_pages']))
                continue
            first = record['pages'][0]
            if not classify_page(first['text'], 1, record['total_pages'], item['magazine'], item['language'], first['text']):
                jobs.append((item, str(args.cache), 1))
        run_jobs(ocr_page, jobs, args.workers)
    else:
        generate(args, items)


if __name__ == '__main__':
    main()
