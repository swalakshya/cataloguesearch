"""Offline checks for unique-download accounting and survey percentages."""

import csv
from pathlib import Path
import tempfile
import unittest

from analyze_atmadharma_layouts import catalog, reports


class SurveyTests(unittest.TestCase):
    def test_catalog_deduplicates_urls_without_losing_issue_references(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            path = root / "source.csv"
            with path.open("w", newline="") as handle:
                fields = ["Number", "English Month", "English Year", "Gujarati PDF", "Hindi PDF"]
                writer = csv.DictWriter(handle, fieldnames=fields)
                writer.writeheader()
                for number in ("1", "2"):
                    writer.writerow(dict(zip(fields, [number, "May", "1945", "https://example.com/a.pdf", "https://example.com/h.pdf"])))
            items = catalog(path, root)
            self.assertEqual(len(items), 2)
            self.assertEqual(items[0]["source_issue_numbers"], ["1", "2"])
            self.assertEqual(Path(items[0]["path"]).parent.name, "gujarati")

    def test_report_distinguishes_page_and_pdf_percentages_and_failures(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            base = {"language": "gujarati", "filename": "a.pdf", "url": "https://example.com/a.pdf",
                    "path": str(root / "a.pdf"), "source_issue_numbers": ["1"]}
            first = {**base, "download_status": "downloaded", "status": "complete", "total_pages": 4,
                     "pages": [{"page": i + 1, "mode": mode} for i, mode in enumerate(
                         ["single_column", "two_column", "single_column", "review"])]}
            second = {**base, "filename": "b.pdf", "url": "https://example.com/b.pdf",
                      "download_status": "failed", "download_error": "HTTP 404"}
            summary = reports(root, [first, second], [first, second], "detector-hash")
            stats = summary["statistics"]["all"]
            self.assertEqual(stats["expected_pdfs"], 2)
            self.assertEqual(stats["scanned_pdfs"], 1)
            self.assertEqual(stats["percent_pdfs_with_two_column_pages"], 100)
            self.assertEqual(stats["percent_pages_two_column"], 25)
            self.assertEqual(stats["percent_pages_review"], 25)
            self.assertEqual(len(summary["failures"]), 1)
            with (root / "reports/multi-column-pages.csv").open(encoding="utf-8-sig") as handle:
                rows = list(csv.DictReader(handle))
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0]["Page URL"], "https://example.com/a.pdf#page=2")


if __name__ == "__main__":
    unittest.main()
