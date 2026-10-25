# Atmadharma magazine catalog

The separate [Vitrag Vigyan catalog](vitrag-vigyan-README.md) is exported from PTST.

Source: [Vitragvani Atmadharma Magazine](https://www.vitragvani.com/atmadharam_patrika/atmadharam_patrika.aspx).

`atmadharma.csv` is a UTF-8 CSV with a BOM for spreadsheet compatibility.
`atmadharma.json` contains the same records for future ingestion.
`atmadharma-export.json` records the fetch time, page count, row count and PDF-link counts.

## Refresh automatically

From the `cataloguesearch` directory, using Python 3 (no additional packages):

```sh
python3 scripts/export_atmadharma.py
```

Optional output location and raw HTML snapshots:

```sh
python3 scripts/export_atmadharma.py --output-dir /tmp/magazines --snapshot-dir /tmp/atmadharma-pages
```

The exporter follows the site's ASP.NET pagination using cookies and the current
page's hidden form state, with a pause between requests. It validates the total
row count and rejects repeated pages or duplicate rows before writing output.
A network error fails the run; rerun the command to start a fresh export.
PDF files are not downloaded. Link presence does not establish PDF availability.

## Columns and date limitations

The first nine columns follow the source table's order, with clearer column names:

| Column | Meaning |
| --- | --- |
| Number | Source `No.`; retained as text, including combined issues such as `10-11` |
| Gujarati Month | Source `Gujrati Month`, retaining its Roman spelling |
| Vikram Samvat | Year as shown in the source |
| Veer Samvat | Year as shown in the source |
| English Month | Source month or month range, preserved verbatim |
| English Year | Source year or year range, preserved verbatim |
| Year | Source publication year/volume, rather than a calendar year |
| Gujarati PDF | Absolute source download URL, or blank if absent |
| Hindi PDF | Absolute source download URL, or blank if absent |
| Gujarati Date | Display label combining Gujarati Month and Vikram Samvat; no day is supplied |
| Hindi Date | Blank: the source table does not supply an independent Hindi date |
| Hindi Year | Extracted from a Hindi filename matching `Year-N_Ank_M.pdf`; otherwise blank |
| Hindi Number | Extracted from the same filename; otherwise blank |
| Source URL | Archive page for provenance |

Dates are month-level labels, not ISO dates. No day or independent Hindi lunar
month has been inferred. PDF contents may provide additional metadata, but that
requires a separate extraction step. Hindi Year and Hindi Number are derived
from filenames, not verified against PDF covers. An unrecognized filename keeps
its URL and leaves those two derived fields blank.

## Future magazine indexing

This is a metadata catalog only; it does not change the search index or UI.
For a future `magazine` document type, expand each row into one document per
available language/PDF, retaining both the source row metadata and each
language's own issue numbering. Deduplicate by PDF URL before downloading or
indexing; do not assume the Gujarati and Hindi issue numbers match. Keep combined
issues as a single source record. Preserve the source download URLs, including
their query strings, and use the PDF link as provenance for OCR content.

Offline parser and pagination checks:

```sh
python3 -m unittest discover -s scripts -p test_export_atmadharma.py
```

## Download PDFs and survey column layouts

Using the project's Python environment (PyMuPDF, Pillow and NumPy installed):

```sh
python scripts/analyze_atmadharma_layouts.py --output-dir ~/Downloads/atmadharma
```

The command downloads each distinct Gujarati/Hindi URL once, keeping PDFs in
language subdirectories. Existing readable PDFs and matching per-file layout
caches are reused on subsequent runs. Downloads retry transient failures;
failed downloads and page errors remain explicit in the report.

`reports/multi-column-pdfs.csv` lists matching PDFs, source links, physical PDF
page numbers and per-PDF percentages. `multi-column-pages.csv` has a row and
page link per detected page. `all-pdfs.csv`, `all-pages.csv`, `review-pages.csv`,
`summary.json` and `report.md` retain full coverage and the aggregate percentages.

The survey uses the experimental image gutter/ruling detector from
`eval/auto_tesseract.py`, with every page rendered at a maximum dimension of
1200 pixels. It does not run Tesseract OCR. Counts are automated estimates:
table-like, mixed and ambiguous pages are recorded separately for review.
Page percentages include review pages in the denominator; PDF percentages use
successfully scanned unique PDFs. Physical PDF pages start at 1, independently
of the magazine's printed page numbers.
