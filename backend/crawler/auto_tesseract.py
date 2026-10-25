"""Shared experimental single/two-column layout and reading-order helpers.

Tesseract PSM 3 supplies the text. Image gutters nominate columns; OCR lines
that span the gutter remain full-width regions instead of being cut in half.
All coordinates and page numbers continue to refer to the cropped PDF page.
"""

from copy import deepcopy

import numpy as np
from PIL import Image, ImageDraw


def auto_page_data(page_number, image, language):
    """Use the exact same PSM 3 extraction and region construction in eval and crawl."""
    import json
    from backend.crawler.advanced_pdf_processor import AdvancedPDFProcessor

    _, strings = AdvancedPDFProcessor._process_single_page((page_number, image, language, 3))
    data = json.loads(strings[0])
    data["ocr_mode"] = "auto_tesseract"
    data["layout"] = detect_layout(image)
    data["regions"] = order_regions(data, data["layout"], image.width)
    data["lines"] = [line for region in data["regions"] for line in region["lines"]]
    return data


def _gutter(ink):
    height, width = ink.shape
    density = float(ink[:, int(width * .15):int(width * .85)].mean())
    if density < .003:
        return 1.0, width // 2
    band = max(3, int(width * .012))
    projection = np.convolve(ink.mean(axis=0), np.ones(band) / band, mode="same")
    lo, hi = int(width * .42), int(width * .58)
    split = lo + int(np.argmin(projection[lo:hi]))
    return float(projection[split] / density), split


def _longest_run(values):
    edges = np.diff(np.r_[False, values, False].astype(int))
    starts, ends = np.flatnonzero(edges == 1), np.flatnonzero(edges == -1)
    return int((ends - starts).max()) if len(starts) else 0


def detect_layout(image):
    """Conservative gutter heuristic; ambiguity is exposed, never called certainty."""
    sample = image.convert("L")
    sample.thumbnail((1200, 1200))
    ink = np.asarray(sample) < 150
    height, width = ink.shape
    if min(height, width) < 80:
        return {"mode": "review", "columns": 1, "split_percent": None,
                "warnings": ["Image is too small for reliable layout detection."]}
    ratio, split = _gutter(ink[int(height * .10):int(height * .94)])
    upper, _ = _gutter(ink[int(height * .12):int(height * .48)])
    lower, _ = _gutter(ink[int(height * .50):int(height * .92)])
    # Interior rules help distinguish tables from the outer border of a page.
    vertical = max(_longest_run(ink[int(height * .12):int(height * .94), x])
                   for x in range(int(width * .22), int(width * .78)))
    horizontal = max(_longest_run(ink[y, int(width * .10):int(width * .90)])
                     for y in range(int(height * .12), int(height * .94)))
    warnings = []
    if vertical > height * .18 and horizontal > width * .30:
        warnings.append("Table-like ruling detected. Check the reading order and paragraph boundaries.")
    if min(upper, lower) < .20 and max(upper, lower) > .55:
        warnings.append("The layout changes within this page. Review the regions before using the text.")
    if .18 <= ratio <= .45:
        warnings.append("The central gutter is ambiguous; using whole-page Tesseract segmentation.")
    mode = "review" if warnings else "two_column" if ratio < .18 else "single_column"
    return {
        "mode": mode, "columns": 2 if mode == "two_column" else 1,
        "split_percent": round(100 * split / width, 1) if mode == "two_column" else None,
        "gutter_ink_ratio": round(ratio, 3), "warnings": warnings,
        "method": "Image gutter detection + Tesseract PSM 3; experimental",
    }


def _region(page_number, lines, label, region_id):
    lines = sorted(lines, key=lambda line: (line.get("y_start", 0), line["x_start"]))
    left = sorted(line["x_start"] for line in lines)
    right = sorted(line["x_end"] for line in lines)
    # Same robust margin calculation as AdvancedPDFProcessor, per region.
    lmargin = sum(left[:2]) / 2 if len(left) >= 4 else left[len(left) // 2]
    rmargin = sum(right[-2:]) / 2 if len(right) >= 4 else right[len(right) // 2]
    return {
        "page_num": page_number, "region_id": region_id, "label": label,
        "bbox": [min(left), min(line.get("y_start", 0) for line in lines), max(right),
                 max(line.get("y_start", 0) + line.get("height", 0) for line in lines)],
        "metadata": {"prose_left_margin": lmargin, "prose_right_margin": rmargin,
                     "avg_left_margin": sum(left) / len(left), "avg_right_margin": sum(right) / len(right)},
        "lines": lines,
    }


def order_regions(page_data, layout, image_width):
    """Keep spanning lines, then left/right columns within each horizontal band."""
    lines = deepcopy(page_data.get("lines", []))
    if not lines:
        return []
    if layout["mode"] != "two_column":
        # Keep PSM 3 order on review pages: a geometric sort would mix columns
        # or table panels. There is no claim of valid region margins here.
        region = _region(page_data["page_num"], lines, "Whole page", 1)
        region["lines"] = lines
        return [region]
    split = image_width * layout["split_percent"] / 100
    tolerance = image_width * .005
    spanning = sorted([line for line in lines
                       if line["x_start"] < split - tolerance and line["x_end"] > split + tolerance],
                      key=lambda line: line.get("y_start", 0))
    remaining = [line for line in lines if line not in spanning]
    groups = []

    def add_columns(band):
        for label, left_side in (("Left column", True), ("Right column", False)):
            column = [line for line in band if ((line["x_start"] + line["x_end"]) / 2 < split) == left_side]
            if column:
                groups.append((label, column))

    for span in spanning:
        above = [line for line in remaining if line.get("y_start", 0) < span.get("y_start", 0)]
        remaining = [line for line in remaining if line not in above]
        add_columns(above)
        groups.append(("Full width", [span]))
    add_columns(remaining)
    regions = [_region(page_data["page_num"], group, label, i + 1) for i, (label, group) in enumerate(groups)]
    line_number = 0
    for region in regions:
        for line in region["lines"]:
            line["line_num"] = line_number
            line["region_id"] = region["region_id"]
            line_number += 1
    return regions


def annotate_regions(image, regions):
    preview = image.convert("RGB").copy()
    draw = ImageDraw.Draw(preview)
    colors = ("#0284c7", "#d97706", "#9333ea")
    for i, region in enumerate(regions):
        color = colors[i % len(colors)]
        draw.rectangle(region["bbox"], outline=color, width=max(2, image.width // 350))
        draw.text((region["bbox"][0] + 3, max(0, region["bbox"][1] - 14)),
                  f'{region["region_id"]}: {region["label"]}', fill=color)
    return preview
