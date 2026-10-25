"""Offline checks: python3 -m unittest discover -s scripts -p test_export_vitrag_vigyan.py."""

import csv
import json
from pathlib import Path
import tempfile
import unittest

from export_vitrag_vigyan import Listing, SOURCE_COLUMNS, export, normalize


def row(title, filename="issue.pdf"):
    return dict(zip(SOURCE_COLUMNS, [title, "Vitrag_Vigyan_Patrika", "1234 (KB)",
                                    "../snatak/admin/docs/files_vitrag/" + filename]))


def html(*rows):
    return '<table id="example"><tbody>' + "".join(
        '<tr>' + "".join(f'<td data-title="{key}">{value}</td>' if key != 'Download'
                         else f'<td data-title="Download"><a href="{value}">PDF</a></td>'
                         for key, value in item.items()) + '</tr>' for item in rows
    ) + '</tbody></table>'


class ExportTests(unittest.TestCase):
    def test_source_rows_and_links_with_spaces_are_preserved(self):
        source = row("02-Vitrag-Vigyan-Patrika-Febuary-2010", "Febuary 2010 [M].pdf.pdf")
        result = normalize(Listing(html(source)).rows[0], 1)
        self.assertEqual(result["Date"], "2010-02")
        self.assertEqual(result["Title"], source["Tittle"])
        self.assertIn("Febuary%202010%20%5BM%5D.pdf.pdf", result["PDF"])
        self.assertEqual(result["Part (Filename)"], "M")
        self.assertEqual(result["Language"], "")

    def test_conflicting_prefix_is_not_used_as_month_or_issue_number(self):
        result = normalize(row("08-Vitrag-Vigyan-Patrika-September-2012"), 26)
        self.assertEqual(result["Date"], "2012-09")
        self.assertEqual(result["Title Prefix"], "08")
        self.assertIn("disagrees", result["Notes"])

    def test_editorial_title_and_filename_conflict_is_retained(self):
        result = normalize(row("07-Vitrag-Vigyan-Patrika-July -2013 (M)",
                               "07-Vitrag-Vigyan-Patrika-July 2013 (Sampadkiya).pdf"), 47)
        self.assertEqual(result["Part (Title)"], "M")
        self.assertEqual(result["Part (Filename)"], "Sampadkiya")
        self.assertIn("disagree on part", result["Notes"])

    def test_two_digit_year_and_missing_year_are_not_invented(self):
        for title in ("01-Vitrag-Vigyan-Patrika-January-09", "03-Vitrag-Vigyan-Patrika-Center-Page-March"):
            self.assertEqual(normalize(row(title), 1)["Date"], "")
        result = normalize(row("Marathi Veetrag Vigyan Nov 19"), 189)
        self.assertEqual((result["Language"], result["Date"]), ("mr", ""))

    def test_year_adjacent_to_part_and_letter_prefix(self):
        result = normalize(row("02-B-Vitrag-Vigyan-Patrika-February-2014Sampadkiya"), 1)
        self.assertEqual(result["Date"], "2014-02")
        self.assertEqual(result["Title Prefix"], "02-B")
        self.assertEqual(result["Part (Title)"], "Sampadkiya")

    def test_duplicate_download_rows_survive_and_csv_matches_json(self):
        with tempfile.TemporaryDirectory() as folder:
            dest = Path(folder)
            source = row("11-Vitrag-Vigyan-Patrika-November-2017")
            summary = export(html(source, source), dest)
            self.assertEqual((summary["rows"], summary["unique_pdf_links"]), (2, 1))
            with (dest / "vitrag-vigyan.csv").open(encoding="utf-8-sig", newline="") as handle:
                records = list(csv.DictReader(handle))
            self.assertEqual(records, json.loads((dest / "vitrag-vigyan.json").read_text()))
            self.assertTrue(all("multiple source rows" in record["Notes"] for record in records))

    def test_changed_layout_or_missing_download_fails(self):
        with self.assertRaises(ValueError):
            Listing("<html>No archive</html>")
        with self.assertRaises(ValueError):
            Listing(html(row("January-2020")).replace('<a href="../snatak/admin/docs/files_vitrag/issue.pdf">PDF</a>', ''))


if __name__ == "__main__":
    unittest.main()
