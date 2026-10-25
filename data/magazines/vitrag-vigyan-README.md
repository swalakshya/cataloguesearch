# Vitrag Vigyan magazine catalog

Source: [PTST Vitrag Vigyan downloads](https://ptst.in/pdf/vitrag_vigyan.php).

- `vitrag-vigyan.csv`: spreadsheet-ready UTF-8 CSV with BOM.
- `vitrag-vigyan.json`: identical records for future ingestion.
- `vitrag-vigyan-export.json`: fetch time, counts, source HTML hash, duplicate URLs and date limitations.

The initial export contains **283 source rows and 282 unique PDF URLs**. All
entries are embedded in one HTML page; its browser pagination hides rows rather
than fetching additional pages. Original source order is retained.

## Refresh

From `cataloguesearch`, with Python 3 and no additional packages:

```sh
python3 scripts/export_vitrag_vigyan.py
```

Optional offline snapshot or output directory:

```sh
python3 scripts/export_vitrag_vigyan.py --html-file /tmp/vitrag-vigyan.html --output-dir /tmp/magazines
```

## Metadata rules

`Name` is Vitrag Vigyan. `Title`, `Patrika`, `File Size (Source)` and the decoded
`Filename` retain source values. `Source Row` is the position in this snapshot,
not a persistent issue identifier. `PDF` is the absolute download URL, with
spaces and brackets encoded for use in clients. Doubled `.pdf.pdf` suffixes are
retained, since they are part of the source URL.

`Date` uses `YYYY-MM`, with `Date Precision` set to `month`. It is extracted from
the title's month name and four-digit year. Common spelling variants such as
`Febuary`, `Feburary`, `Fabuary`, `Aug.` and `Nov` are normalized only in derived
fields. No day is inferred. Five initial rows have incomplete dates: three
titles use year `09`, a Marathi title uses `19`, and a center-page supplement
has no year. Their dates stay blank pending verification against the PDFs.

`Title Prefix` preserves leading labels such as `08` or `02-B`. These are not
verified Ank numbers. A conflicting prefix does not override the written month:
`08-...-September-2012` receives date `2012-09` and a note.

Editorials, supplements, and multiple parts are separate source records, not
assumed to be complete magazine issues. `Part (Title)` and `Part (Filename)`
extract recognizable labels independently; conflicting labels remain visible.
`M` remains the literal marker, without guessing its meaning. Common editorial
spellings beginning with `Sampad` normalize to `Sampadkiya` in these derived
fields. Source titles and filenames are unchanged.

Language is `mr` only where the title explicitly says Marathi; other entries
stay blank until their contents are checked. The listing supplies no author,
verified issue/volume number, or lunar-calendar dates. `Author` remains blank.
File sizes are copied with the site's KB label; the units are not independently
verified and are not converted.

One November 2017 PDF URL is listed twice; both source rows are retained and
flagged in `Notes`. Deduplicate URLs before future downloading/indexing, while
preserving editorial and supplementary files that have distinct URLs. This
export neither downloads all PDFs nor changes the search index or eval UI.

## Checks

```sh
python3 -m unittest discover -s scripts -p test_export_vitrag_vigyan.py
```
