#!/usr/bin/env python3
"""Download the Atmadharma catalog and estimate column layouts on every page.

Run using the project's Python environment (PyMuPDF, Pillow and NumPy required).
Downloads, per-PDF analysis caches and reports live under --output-dir.
"""

import argparse
from collections import Counter
from concurrent.futures import ProcessPoolExecutor, ThreadPoolExecutor, as_completed
import csv
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sys
import time
from urllib.parse import unquote, urlsplit
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
DETECTOR = ROOT / "backend/crawler/auto_tesseract.py"


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temp.replace(path)


def catalog(csv_path, output_dir):
    with csv_path.open(encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.DictReader(handle))
    files = {}
    paths = set()
    for row in rows:
        for language, column in (("gujarati", "Gujarati PDF"), ("hindi", "Hindi PDF")):
            url = row[column]
            if not url:
                continue
            if url not in files:
                filename = unquote(urlsplit(url).path.rsplit("/", 1)[-1])
                if filename in ("", ".", "..") or "/" in filename or "\\" in filename:
                    raise ValueError(f"Unsafe filename: {url}")
                path = output_dir / language / filename
                if str(path) in paths:
                    path = path.with_name(path.stem + "-" + hashlib.sha256(url.encode()).hexdigest()[:10] + ".pdf")
                paths.add(str(path))
                files[url] = {"url": url, "language": language, "filename": filename,
                              "path": str(path), "source_issue_numbers": [], "source_dates": []}
            files[url]["source_issue_numbers"].append(row["Number"])
            files[url]["source_dates"].append(f'{row["English Month"]} {row["English Year"]}')
    return list(files.values())


def valid_pdf(path):
    import fitz
    try:
        with fitz.open(path) as doc:
            return len(doc) > 0 and not doc.needs_pass
    except Exception:
        return False


def download(item):
    path = Path(item["path"])
    if path.exists() and valid_pdf(path):
        return {**item, "download_status": "cached", "bytes": path.stat().st_size}
    path.parent.mkdir(parents=True, exist_ok=True)
    partial = path.with_suffix(".pdf.part")
    error = ""
    for attempt in range(3):
        try:
            request = Request(item["url"], headers={"User-Agent": "AtmadharmaLayoutSurvey/1.0"})
            with urlopen(request, timeout=45) as response, partial.open("wb") as handle:
                while chunk := response.read(256 * 1024):
                    handle.write(chunk)
            if not valid_pdf(partial):
                raise ValueError("Downloaded response is not a readable, nonempty PDF")
            partial.replace(path)
            return {**item, "download_status": "downloaded", "bytes": path.stat().st_size}
        except Exception as exc:
            error = str(exc)
            partial.unlink(missing_ok=True)
            if attempt < 2:
                time.sleep(2 ** attempt)
    return {**item, "download_status": "failed", "download_error": error}


def analyze(item, cache_dir, detector_hash, render_height):
    import fitz
    from PIL import Image
    from eval.auto_tesseract import detect_layout

    path = Path(item["path"])
    cache_path = Path(cache_dir) / (hashlib.sha256(item["url"].encode()).hexdigest() + ".json")
    stat = path.stat()
    fingerprint = [stat.st_size, stat.st_mtime_ns, detector_hash, render_height]
    try:
        cached = json.loads(cache_path.read_text())
        if cached["fingerprint"] == fingerprint and cached.get("status") == "complete":
            return {**item, **cached}
    except (OSError, ValueError, KeyError):
        pass
    pages = []
    try:
        with fitz.open(path) as doc:
            total = len(doc)
            for i, page in enumerate(doc):
                try:
                    scale = render_height / max(page.rect.width, page.rect.height)
                    pix = page.get_pixmap(matrix=fitz.Matrix(scale, scale), colorspace=fitz.csGRAY, alpha=False)
                    image = Image.frombytes("L", (pix.width, pix.height), pix.samples)
                    layout = detect_layout(image)
                    pages.append({"page": i + 1, **layout})
                except Exception as exc:
                    pages.append({"page": i + 1, "mode": "error", "error": str(exc)})
        result = {"status": "complete" if all(p["mode"] != "error" for p in pages) else "partial",
                  "fingerprint": fingerprint, "total_pages": total, "pages": pages}
    except Exception as exc:
        result = {"status": "failed", "fingerprint": fingerprint, "error": str(exc), "pages": pages}
    write_json(cache_path, result)
    return {**item, **result}


def write_csv(path, rows, fields):
    temporary = path.with_suffix(".csv.tmp")
    with temporary.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)
    temporary.replace(path)


def reports(output_dir, results, wanted, detector_hash):
    report_dir = output_dir / "reports"
    report_dir.mkdir(parents=True, exist_ok=True)
    pdf_rows, page_rows = [], []
    for item in sorted(results, key=lambda r: (r["language"], r["filename"])):
        pages = item.get("pages", [])
        two = [p["page"] for p in pages if p["mode"] == "two_column"]
        review = [p["page"] for p in pages if p["mode"] == "review"]
        total = item.get("total_pages", 0)
        pdf_rows.append({"Language": item["language"], "Filename": item["filename"], "PDF URL": item["url"],
                         "Local File": item["path"], "Source Issue Numbers": "; ".join(item["source_issue_numbers"]),
                         "Total Pages": total, "Two-column Pages": "; ".join(map(str, two)),
                         "Two-column Count": len(two), "Two-column Percentage": round(100 * len(two) / total, 2) if total else "",
                         "Review Pages": "; ".join(map(str, review)), "Review Count": len(review),
                         "Status": item.get("status", item["download_status"]),
                         "Error": item.get("download_error", item.get("error", ""))})
        for page in pages:
            page_rows.append({"Language": item["language"], "Filename": item["filename"], "PDF URL": item["url"],
                              "Page URL": item["url"] + f'#page={page["page"]}', "PDF Page": page["page"],
                              "Layout": page["mode"], "Split Percentage": page.get("split_percent", ""),
                              "Gutter Ink Ratio": page.get("gutter_ink_ratio", ""),
                              "Warnings": "; ".join(page.get("warnings", [])), "Error": page.get("error", "")})
    pdf_fields = list(pdf_rows[0])
    page_fields = ["Language", "Filename", "PDF URL", "Page URL", "PDF Page", "Layout", "Split Percentage", "Gutter Ink Ratio", "Warnings", "Error"]
    write_csv(report_dir / "all-pdfs.csv", pdf_rows, pdf_fields)
    write_csv(report_dir / "multi-column-pdfs.csv", [r for r in pdf_rows if r["Two-column Count"]], pdf_fields)
    write_csv(report_dir / "all-pages.csv", page_rows, page_fields)
    write_csv(report_dir / "multi-column-pages.csv", [r for r in page_rows if r["Layout"] == "two_column"], page_fields)
    write_csv(report_dir / "review-pages.csv", [r for r in page_rows if r["Layout"] in ("review", "error")], page_fields)
    stats = {}
    for language in ("all", "gujarati", "hindi"):
        pr = [r for r in pdf_rows if language == "all" or r["Language"] == language]
        pg = [r for r in page_rows if language == "all" or r["Language"] == language]
        counts = Counter(r["Layout"] for r in pg)
        analyzed = sum(counts[m] for m in ("single_column", "two_column", "review"))
        scanned = sum(r["Status"] in ("complete", "partial") for r in pr)
        multi = sum(bool(r["Two-column Count"]) for r in pr)
        stats[language] = {
            "expected_pdfs": sum(language == "all" or r["language"] == language for r in wanted),
            "downloaded_pdfs": sum(r.get("download_status") != "failed" and (language == "all" or r["language"] == language) for r in results),
            "scanned_pdfs": scanned, "pdfs_with_two_column_pages": multi,
            "percent_pdfs_with_two_column_pages": round(100 * multi / scanned, 2) if scanned else 0,
            "analyzed_pages": analyzed, "single_column_pages": counts["single_column"],
            "two_column_pages": counts["two_column"], "review_pages": counts["review"], "page_errors": counts["error"],
            "percent_pages_two_column": round(100 * counts["two_column"] / analyzed, 2) if analyzed else 0,
            "percent_pages_review": round(100 * counts["review"] / analyzed, 2) if analyzed else 0,
        }
    failures = [r for r in pdf_rows if r["Status"] not in ("complete",)]
    summary = {"generated_at_utc": datetime.now(timezone.utc).isoformat(), "statistics": stats,
               "failures": failures, "detector_sha256": detector_hash,
               "method": "Image-based gutter/ruling heuristic, every page rendered at max dimension 1200; no Tesseract OCR performed.",
               "limitations": "Automated estimates, not human-verified counts. Tables, scans with borders, off-center gutters, illustrations, and mixed layouts can be missed or misclassified. Review pages are not counted as confirmed two-column pages.",
               "page_numbers": "Physical PDF page numbers, starting at 1; not printed magazine page numbers.",
               "denominators": "Page percentages use all successfully analyzed pages including review pages. PDF percentages use scanned unique PDFs. Repeated catalog URLs count once."}
    write_json(report_dir / "summary.json", summary)
    md = ["# Atmadharma automated column survey", "", summary["method"], "", summary["limitations"], "",
          summary["page_numbers"], "", "| Language | Scanned PDFs | PDFs with two columns | PDF % | Pages analyzed | Two-column pages | Page % | Review pages |",
          "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |"]
    for lang, s in stats.items():
        md.append(f'| {lang} | {s["scanned_pdfs"]} | {s["pdfs_with_two_column_pages"]} | {s["percent_pdfs_with_two_column_pages"]}% | {s["analyzed_pages"]} | {s["two_column_pages"]} | {s["percent_pages_two_column"]}% | {s["review_pages"]} |')
    md.extend(["", summary["denominators"], "", f"Failed/incomplete PDFs: {len(failures)}.", "", "## PDFs with detected two-column pages", ""])
    for r in pdf_rows:
        if r["Two-column Count"]:
            md.append(f'- [{r["Filename"]}]({r["PDF URL"]}) ({r["Language"]}): pages **{r["Two-column Pages"]}** — {r["Two-column Count"]}/{r["Total Pages"]} pages ({r["Two-column Percentage"]}%).')
    (report_dir / "report.md").write_text("\n".join(md) + "\n", encoding="utf-8")
    return summary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--csv", type=Path, default=ROOT / "data/magazines/atmadharma.csv")
    parser.add_argument("--output-dir", type=Path, default=Path.home() / "Downloads/atmadharma")
    parser.add_argument("--download-workers", type=int, default=6)
    parser.add_argument("--scan-workers", type=int, default=4)
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    wanted = catalog(args.csv, args.output_dir)
    write_json(args.output_dir / "catalog.json", wanted)
    print(f"Catalog: {len(wanted)} unique PDFs", flush=True)
    downloads = []
    start = time.monotonic()
    with ThreadPoolExecutor(max_workers=args.download_workers) as pool:
        futures = [pool.submit(download, item) for item in wanted]
        for future in as_completed(futures):
            downloads.append(future.result())
            if len(downloads) % 20 == 0 or len(downloads) == len(wanted):
                counts = Counter(r["download_status"] for r in downloads)
                print(f"Downloads {len(downloads)}/{len(wanted)}: {dict(counts)}; {time.monotonic()-start:.0f}s", flush=True)
                write_json(args.output_dir / "downloads.json", downloads)
    detector_hash = hashlib.sha256(DETECTOR.read_bytes()).hexdigest()
    ready = [r for r in downloads if r["download_status"] != "failed"]
    results = [r for r in downloads if r["download_status"] == "failed"]
    with ProcessPoolExecutor(max_workers=args.scan_workers) as pool:
        futures = [pool.submit(analyze, item, str(args.output_dir / ".layout-cache"), detector_hash, 1200) for item in ready]
        for i, future in enumerate(as_completed(futures), 1):
            results.append(future.result())
            if i % 20 == 0 or i == len(ready):
                pages = sum(len(r.get("pages", [])) for r in results)
                print(f"Scanned {i}/{len(ready)} PDFs; {pages} pages; {time.monotonic()-start:.0f}s", flush=True)
    summary = reports(args.output_dir, results, wanted, detector_hash)
    print(json.dumps(summary, ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    main()
