"""Offline checks: python3 -m unittest discover -s scripts -p test_export_atmadharma.py."""

import unittest

from export_atmadharma import ArchivePage, SOURCE_COLUMNS, collect, normalize


def page(number="10-11", total=1, hindi="", next_button=False):
    values = [number, "Bhadarvo", "2000", "2470", "Aug", "1944", "1",
              '<a href="/files/test.pdf?path=uploads/a.pdf&amp;x=1">PDF</a>', hindi]
    cells = "".join(f'<td data-title="{key}">{value}</td>' for key, value in zip(SOURCE_COLUMNS, values))
    next_link = """<a id="ContentPlaceHolder1_lnkBottombtnNext"
        href="javascript:__doPostBack('next','')">Next</a>""" if next_button else ""
    return f'<input type="hidden" name="__VIEWSTATE" value="state&amp;value"><b>1</b> to <b>1</b> of <b>{total}</b> record(s) displayed<table><tr>{cells}</tr></table>{next_link}'


class ExportTests(unittest.TestCase):
    def test_combined_issue_missing_language_and_encoded_link(self):
        parsed = ArchivePage(page())
        row = normalize(parsed.rows[0])
        self.assertEqual(row["Number"], "10-11")
        self.assertEqual(row["Gujarati Date"], "Bhadarvo 2000")
        self.assertEqual(row["Hindi Date"], "")
        self.assertEqual(row["Hindi PDF"], "")
        self.assertTrue(row["Gujarati PDF"].endswith("a.pdf&x=1"))
        self.assertEqual(parsed.hidden["__VIEWSTATE"], "state&value")

    def test_hindi_number_is_independent(self):
        row = normalize(ArchivePage(page(number="20", hindi='<a href="/files/Year-1_Ank_1.pdf?path=x">PDF</a>')).rows[0])
        self.assertEqual((row["Number"], row["Hindi Year"], row["Hindi Number"]), ("20", "1", "1"))

    def test_pagination_posts_current_state(self):
        calls = []

        def fetch(payload):
            calls.append(payload)
            return page(number=str(len(calls)), total=2, next_button=True)

        rows, pages = collect(fetch, delay=0)
        self.assertEqual((len(rows), pages), (2, 2))
        self.assertEqual(calls[1]["__EVENTTARGET"], "next")
        self.assertEqual(calls[1]["__VIEWSTATE"], "state&value")

    def test_repeated_page_fails_instead_of_partial_export(self):
        with self.assertRaisesRegex(ValueError, "repeated"):
            collect(lambda payload: page(total=2, next_button=True), delay=0)

    def test_layout_change_fails(self):
        with self.assertRaises(ValueError):
            ArchivePage("<html>Service unavailable</html>")


if __name__ == "__main__":
    unittest.main()
