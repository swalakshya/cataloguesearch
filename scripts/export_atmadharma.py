#!/usr/bin/env python3
"""Export the Vitragvani Atmadharma archive without downloading its PDFs.

Uses only the Python standard library. See data/magazines/README.md.
"""

import argparse
import csv
from datetime import datetime, timezone
from html.parser import HTMLParser
import http.cookiejar
import json
from pathlib import Path
import re
import time
from urllib.parse import urlencode, urljoin, urlparse, unquote
from urllib.request import HTTPCookieProcessor, Request, build_opener


SOURCE_URL = "https://www.vitragvani.com/atmadharam_patrika/atmadharam_patrika.aspx"
DEFAULT_OUTPUT = Path(__file__).resolve().parents[1] / "data/magazines"
COLUMNS = [
    "Number", "Gujarati Month", "Vikram Samvat", "Veer Samvat",
    "English Month", "English Year", "Year", "Gujarati PDF", "Hindi PDF",
    "Gujarati Date", "Hindi Date", "Hindi Year", "Hindi Number", "Source URL",
]
SOURCE_COLUMNS = [
    "No.", "Gujrati Month", "Vikram Samvat", "Veer Samvat",
    "English Month", "English Year", "Year", "PDF(Guj)", "PDF(Hin)",
]


class ArchivePage(HTMLParser):
    """Read labelled table cells and ASP.NET state, ignoring surrounding tables."""

    def __init__(self, html):
        super().__init__(convert_charrefs=True)
        self.hidden = {}
        self.rows = []
        self.text = []
        self.row = {}
        self.cell = None
        self.cell_text = []
        self.cell_link = ""
        self.next_target = None
        self.feed(html)
        count = re.search(r"of\s+(\d+)\s+record\(s\) displayed", " ".join(self.text))
        if not count or not self.rows:
            raise ValueError("Archive table or total count missing; site layout may have changed")
        self.total = int(count[1])

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "input" and attrs.get("type") == "hidden" and attrs.get("name"):
            self.hidden[attrs["name"]] = attrs.get("value", "")
        if tag == "tr":
            self.row = {}
        if tag == "td":
            self.cell = attrs.get("data-title")
            self.cell_text = []
            self.cell_link = ""
        if tag == "a":
            href = attrs.get("href", "")
            if self.cell in ("PDF(Guj)", "PDF(Hin)"):
                self.cell_link = urljoin(SOURCE_URL, href)
            if attrs.get("id") == "ContentPlaceHolder1_lnkBottombtnNext":
                match = re.search(r"__doPostBack\('([^']+)'", href)
                if match:
                    self.next_target = match[1]

    def handle_data(self, data):
        self.text.append(data.strip())
        if self.cell:
            self.cell_text.append(data)

    def handle_endtag(self, tag):
        if tag == "td" and self.cell:
            value = " ".join("".join(self.cell_text).split())
            self.row[self.cell] = self.cell_link if self.cell.startswith("PDF(") else value
            self.cell = None
        if tag == "tr" and "No." in self.row:
            if set(self.row) != set(SOURCE_COLUMNS):
                raise ValueError(f"Unexpected table columns: {list(self.row)}")
            self.rows.append(self.row)
            self.row = {}


def normalize(row):
    result = dict(zip(COLUMNS[:9], (row[key] for key in SOURCE_COLUMNS)))
    result.update({
        "Gujarati Date": f"{row['Gujrati Month']} {row['Vikram Samvat']}",
        "Hindi Date": "", "Hindi Year": "", "Hindi Number": "",
        "Source URL": SOURCE_URL,
    })
    filename = unquote(urlparse(result["Hindi PDF"]).path).rsplit("/", 1)[-1]
    match = re.fullmatch(r"Year-(\d+)_Ank_(.+)\.pdf", filename, re.IGNORECASE)
    if match:
        result["Hindi Year"], result["Hindi Number"] = match.groups()
    for column in ("Gujarati PDF", "Hindi PDF"):
        if result[column] and urlparse(result[column]).scheme not in ("https", "http"):
            raise ValueError(f"Unexpected PDF URL: {result[column]}")
    return result


def collect(fetch, delay=0.5, snapshot_dir=None):
    html = fetch(None)
    records = []
    seen_pages = set()
    page_number = 0
    expected_total = None
    while True:
        page = ArchivePage(html)
        page_number += 1
        if expected_total is None:
            expected_total = page.total
        if page.total != expected_total:
            raise ValueError("Archive count changed during export; rerun for a consistent snapshot")
        signature = json.dumps(page.rows, sort_keys=True)
        if signature in seen_pages:
            raise ValueError("Pagination repeated a page; refusing to export incomplete data")
        seen_pages.add(signature)
        if snapshot_dir:
            snapshot_dir.mkdir(parents=True, exist_ok=True)
            (snapshot_dir / f"page-{page_number:03}.html").write_text(html, encoding="utf-8")
        records.extend(normalize(row) for row in page.rows)
        print(f"Page {page_number}: {len(records)}/{expected_total} rows", flush=True)
        if len(records) == expected_total:
            break
        if len(records) > expected_total or not page.next_target:
            raise ValueError("Pagination did not match the advertised record count")
        payload = dict(page.hidden)
        payload.update(__EVENTTARGET=page.next_target, __EVENTARGUMENT="")
        time.sleep(delay)
        html = fetch(payload)
    # Use the full source row, not the issue number alone: combined issues and
    # language-specific numbering must survive unchanged.
    if len({json.dumps(row, sort_keys=True) for row in records}) != len(records):
        raise ValueError("Duplicate source rows found; inspect the archive before exporting")
    return records, page_number


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--snapshot-dir", type=Path, help="Optional raw HTML snapshots for auditing")
    args = parser.parse_args()
    opener = build_opener(HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def fetch(payload):
        request = Request(
            SOURCE_URL, data=urlencode(payload).encode() if payload is not None else None,
            headers={"User-Agent": "AtmadharmaMetadataExporter/1.0", "Referer": SOURCE_URL},
        )
        with opener.open(request, timeout=60) as response:
            return response.read().decode(response.headers.get_content_charset() or "utf-8")

    records, pages = collect(fetch, snapshot_dir=args.snapshot_dir)
    summary = {
        "source_url": SOURCE_URL,
        "exported_at_utc": datetime.now(timezone.utc).isoformat(),
        "pages": pages, "rows": len(records),
        "gujarati_pdf_links": sum(bool(row["Gujarati PDF"]) for row in records),
        "hindi_pdf_links": sum(bool(row["Hindi PDF"]) for row in records),
        "unique_gujarati_pdf_links": len({row["Gujarati PDF"] for row in records if row["Gujarati PDF"]}),
        "unique_hindi_pdf_links": len({row["Hindi PDF"] for row in records if row["Hindi PDF"]}),
        "hindi_links_without_parsed_issue": sum(bool(row["Hindi PDF"]) and not row["Hindi Number"] for row in records),
        "notes": [
            "Hindi Date is blank: the source table has no separate Hindi date.",
            "Gujarati Date combines the source Gujarati month and Vikram Samvat; no day is provided.",
            "Hindi Year and Hindi Number are extracted only from matching PDF filenames.",
            "PDF links are copied from the source; PDFs have not been downloaded or all checked for availability.",
        ],
    }
    args.output_dir.mkdir(parents=True, exist_ok=True)
    csv_path = args.output_dir / "atmadharma.csv"
    # Write temporary files only after all pages and counts have been validated.
    with csv_path.with_suffix(".csv.tmp").open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=COLUMNS)
        writer.writeheader()
        writer.writerows(records)
    csv_path.with_suffix(".csv.tmp").replace(csv_path)
    for name, value in (("atmadharma.json", records), ("atmadharma-export.json", summary)):
        path = args.output_dir / name
        path.with_suffix(".json.tmp").write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        path.with_suffix(".json.tmp").replace(path)
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
