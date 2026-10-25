#!/usr/bin/env python3
"""Export PTST's Vitrag Vigyan listing to CSV and JSON (standard library only)."""

import argparse
from collections import Counter
import csv
from datetime import datetime, timezone
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import re
from urllib.parse import quote, unquote, urljoin, urlsplit, urlunsplit
from urllib.request import Request, urlopen


SOURCE_URL = "https://ptst.in/pdf/vitrag_vigyan.php"
DEFAULT_OUTPUT = Path(__file__).resolve().parents[1] / "data/magazines"
COLUMNS = [
    "Source Row", "Name", "Author", "Title", "Date", "Date Precision",
    "English Month", "English Year", "Title Prefix", "Part (Title)",
    "Part (Filename)", "Language", "Patrika", "File Size (Source)",
    "PDF", "Filename", "Notes", "Source URL",
]
SOURCE_COLUMNS = ("Tittle", "Patrika", "File Size (KB)", "Download")
MONTH_ALIASES = {
    "january": 1, "february": 2, "febuary": 2, "feburary": 2, "fabuary": 2,
    "march": 3, "april": 4, "may": 5, "june": 6, "july": 7,
    "august": 8, "aug": 8, "september": 9, "october": 10,
    "november": 11, "nov": 11, "december": 12,
}
MONTH_NAMES = ["", "January", "February", "March", "April", "May", "June",
               "July", "August", "September", "October", "November", "December"]


class Listing(HTMLParser):
    """Read the labelled download rows, retaining duplicate titles and links."""

    def __init__(self, html):
        super().__init__(convert_charrefs=True)
        self.rows = []
        self.row = {}
        self.cell = None
        self.parts = []
        self.links = []
        self.feed(html)
        if not self.rows:
            raise ValueError("No magazine rows found; the archive layout may have changed")

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "tr":
            self.row = {}
        elif tag == "td":
            self.cell = attrs.get("data-title")
            self.parts, self.links = [], []
        elif tag == "a" and self.cell == "Download" and attrs.get("href"):
            self.links.append(attrs["href"])

    def handle_data(self, text):
        if self.cell:
            self.parts.append(text)

    def handle_endtag(self, tag):
        if tag == "td" and self.cell:
            if self.cell == "Download":
                if len(self.links) != 1:
                    raise ValueError("Expected exactly one download URL per magazine row")
                self.row[self.cell] = self.links[0]
            else:
                self.row[self.cell] = " ".join("".join(self.parts).split())
            self.cell = None
        elif tag == "tr" and "Tittle" in self.row:
            if set(self.row) != set(SOURCE_COLUMNS):
                raise ValueError(f"Unexpected magazine columns: {list(self.row)}")
            self.rows.append(self.row)
            self.row = {}


def pdf_url(href):
    parts = urlsplit(urljoin(SOURCE_URL, href))
    if parts.scheme not in ("http", "https") or not parts.path.lower().endswith(".pdf"):
        raise ValueError(f"Unexpected PDF link: {href}")
    # Spaces/brackets occur in source filenames. Encode them without changing
    # already encoded bytes or 'correcting' doubled .pdf.pdf suffixes.
    return urlunsplit((parts.scheme, parts.netloc, quote(parts.path, safe="/%:@!$&'()*+,;=-._~"), parts.query, parts.fragment))


def part_label(value):
    if re.search(r"sampad", value, re.IGNORECASE):
        return "Sampadkiya"
    for label, pattern in (("Vaishali Lekh", r"vaishali[\s-]+lekh"),
                           ("Visesh Program", r"visesh[\s-]+program"),
                           ("Center Page", r"center[\s-]+page"), ("News", r"\bnews\b")):
        if re.search(pattern, value, re.IGNORECASE):
            return label
    return "M" if re.search(r"[\[(]\s*M\s*[\])]", value, re.IGNORECASE) else ""


def normalize(row, number):
    title = row["Tittle"]
    url = pdf_url(row["Download"])
    filename = unquote(urlsplit(url).path.rsplit("/", 1)[-1])
    notes = []
    words = re.findall(r"[A-Za-z]+", title.lower())
    months = {MONTH_ALIASES[word] for word in words if word in MONTH_ALIASES}
    years = set(re.findall(r"(?<!\d)(?:19|20)\d{2}(?!\d)", title))
    month = months.pop() if len(months) == 1 else None
    year = years.pop() if len(years) == 1 else ""
    date = f"{year}-{month:02}" if year and month else ""
    if not date:
        notes.append("Date incomplete or ambiguous in source title; no century/year inferred")
    prefix = re.match(r"^(\d{1,2}(?:-[A-Z])?)-", title)
    prefix = prefix[1] if prefix else ""
    # The numeric title prefix resembles a month, but is not an issue number.
    if prefix and month and int(prefix.split('-')[0]) != month:
        notes.append("Numeric title prefix disagrees with month name; date uses month name")
    title_part, filename_part = part_label(title), part_label(filename)
    if title_part and filename_part and title_part != filename_part:
        notes.append("Title and PDF filename disagree on part label; both retained")
    return dict(zip(COLUMNS, [
        str(number), "Vitrag Vigyan", "", title, date, "month" if date else "",
        MONTH_NAMES[month] if month else "", year, prefix, title_part, filename_part,
        "mr" if re.search(r"\bmarathi\b", title, re.IGNORECASE) else "",
        row["Patrika"], row["File Size (KB)"], url, filename, "; ".join(notes), SOURCE_URL,
    ]))


def export(html, output_dir):
    source_rows = Listing(html).rows
    records = [normalize(row, i) for i, row in enumerate(source_rows, 1)]
    counts = Counter(row["PDF"] for row in records)
    for row in records:
        if counts[row["PDF"]] > 1:
            row["Notes"] = "; ".join(filter(None, [row["Notes"], "PDF URL appears in multiple source rows"]))
    dates = [row["Date"] for row in records if row["Date"]]
    summary = {
        "source_url": SOURCE_URL, "exported_at_utc": datetime.now(timezone.utc).isoformat(),
        "source_html_sha256": hashlib.sha256(html.encode("utf-8")).hexdigest(),
        "rows": len(records), "unique_pdf_links": len(counts),
        "duplicate_pdf_links": {url: count for url, count in counts.items() if count > 1},
        "rows_with_complete_month_date": len(dates),
        "rows_without_complete_date": [row["Source Row"] for row in records if not row["Date"]],
        "earliest_complete_date": min(dates) if dates else None,
        "latest_complete_date": max(dates) if dates else None,
        "notes": [
            "All rows are embedded in one HTML response; browser pagination does not require further requests.",
            "Editorials and supplements remain separate rows; duplicate downloads are retained and flagged.",
            "Dates come from title month names and four-digit years; no publication day is inferred.",
            "Title Prefix is preserved text, not a verified Ank/issue number.",
            "Author and lunar-calendar metadata are not supplied by this listing.",
            "Language is filled only where the title explicitly names it (Marathi); other PDFs are not language-verified.",
            "File size values and their KB label are copied verbatim; the apparent units are not verified.",
            "PDF URLs are extracted and escaped, not individually downloaded or availability-checked.",
        ],
    }
    output_dir.mkdir(parents=True, exist_ok=True)
    path = output_dir / "vitrag-vigyan.csv"
    with path.with_suffix(".csv.tmp").open("w", newline="", encoding="utf-8-sig") as handle:
        writer = csv.DictWriter(handle, fieldnames=COLUMNS)
        writer.writeheader()
        writer.writerows(records)
    path.with_suffix(".csv.tmp").replace(path)
    for name, value in (("vitrag-vigyan.json", records), ("vitrag-vigyan-export.json", summary)):
        path = output_dir / name
        path.with_suffix(".json.tmp").write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        path.with_suffix(".json.tmp").replace(path)
    return summary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--html-file", type=Path, help="Parse a saved archive HTML snapshot instead of fetching")
    args = parser.parse_args()
    if args.html_file:
        html = args.html_file.read_text(encoding="utf-8")
    else:
        request = Request(SOURCE_URL, headers={"User-Agent": "VitragVigyanMetadataExporter/1.0"})
        with urlopen(request, timeout=60) as response:
            html = response.read().decode(response.headers.get_content_charset() or "utf-8")
    print(json.dumps(export(html, args.output_dir), indent=2))


if __name__ == "__main__":
    main()
