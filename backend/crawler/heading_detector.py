"""
Per-document heading detection for the raw-OCR (Tesseract) pipeline.

Opt-in only, via scan_config's "header_detection": "surya" (see
classify_document_via_surya below and discovery.py's call site) -- plain
Tesseract documents get no heading detection at all and simply never have
`is_heading` set, which LineClassifier (advanced.py) treats as "never a
heading", identical to how the pipeline behaved before this module existed.

An earlier version of this module also had a density/MAD ink-outlier
heuristic as the default, non-opt-in path (classify_document/
classify_single_page, calibrated from AdvancedPDFProcessor's per-line
ink_density). That was removed: it's a relative statistical test with no
concept of "this page has zero real headings", so on ordinary uniform-style
prose pages it would still flag whatever lines happened to sit at the top of
the local distribution as false-positive headings. See git history if it's
ever wanted back as an explicit opt-in.
"""
import json
import logging
import os
from typing import Optional

import numpy as np

log_handle = logging.getLogger(__name__)


def _list_page_files(ocr_dir: str) -> list:
    return sorted(
        f for f in os.listdir(ocr_dir)
        if f.startswith("page_") and f.endswith(".json")
    )


def _load_page(ocr_dir: str, fname: str) -> Optional[dict]:
    """
    Returns the page dict, or None if unreadable / not the raw-OCR
    {"lines": [...]} schema this module works with. The LLM-OCR path (see
    llm_pdf_processor.py) writes a differently-shaped JSON (a bare list of
    typed blocks) and classifies its own headings during extraction -- it's
    simply not applicable here, not an error.
    """
    try:
        with open(os.path.join(ocr_dir, fname), 'r', encoding='utf-8') as f:
            data = json.load(f)
    except (IOError, json.JSONDecodeError) as e:
        log_handle.warning(f"heading_detector: failed to read {fname}: {e}")
        return None
    if not isinstance(data, dict) or "lines" not in data:
        return None
    return data


# ----------------------------------------------------------------------------
# Layout-model-based classification (Surya). Evaluated separately (19-page,
# 528-line, 4-book sample) against the median+MAD approaches above: Surya hit
# ~100% precision/recall where density/height topped out around 44% F1 even
# combined. Requires the `surya-ocr` package and a local inference backend
# (llama.cpp) -- see project memory for setup and licensing notes (model
# weights are OpenRAIL-M, free for personal/research/small-startup use).
# ----------------------------------------------------------------------------

# Surya layout labels treated as "heading-like". PageHeader/PageFooter are
# deliberately excluded -- that's running header/footer furniture, not a
# section heading, and Surya already distinguishes them from real content
# (unlike our old idx==0-is-always-furniture heuristic, which page 96 of
# Moksh Marg Prakashak proved wrong).
SURYA_HEADER_LABELS = {"SectionHeader", "Title"}

# Pages rendered and run through the layout model per batch, in
# classify_document_via_surya. Keeps peak memory bounded for large books
# (hundreds of 350dpi page images) while still giving Surya a batch instead
# of one page at a time -- eval/api.py's /ocr/surya only ever handles a
# single page, so it had no need for this.
DEFAULT_SURYA_BATCH_SIZE = 16

# Lazily-created Surya layout predictor -- created on first use, kept warm
# for the rest of the process (loading the model per page/document would be
# unusably slow). Shared by both this module and eval/api.py.
_surya_layout_predictor = None


def _get_surya_layout_predictor():
    global _surya_layout_predictor
    if _surya_layout_predictor is None:
        raise RuntimeError(
            "header_detection=surya is temporarily unsupported: the surya-ocr "
            "dependency was removed (see requirements-crawler.txt, 2026-09-18) "
            "because its httpx<0.28 ceiling blocked upgrading google-genai to a "
            "version with real Developer-API batch support. This code path is "
            "left in place for when that's revisited."
        )
        from surya.inference import SuryaInferenceManager
        from surya.layout import LayoutPredictor
        log_handle.info("Initializing Surya layout predictor (first use, may take a while)...")
        _surya_layout_predictor = LayoutPredictor(SuryaInferenceManager())
    return _surya_layout_predictor


def classify_via_surya_layout(lines: list, layout_bboxes: list) -> None:
    """
    Sets `is_heading` on each line dict based on whether its center point
    falls inside a Surya-detected SectionHeader/Title region.

    `layout_bboxes`: list of (label, (x0, y0, x1, y1)) tuples from Surya's
    layout output. MUST be computed from the exact same rendered image
    (same DPI, same crop) as `lines` -- Surya and Tesseract were run
    independently, so there is no shared coordinate system unless the same
    pixel data was handed to both. A mismatch here silently produces
    nonsense matches, not an error (see project memory: this exact bug
    happened once already, from a 300dpi vs 350dpi render mismatch).

    Matching by center point (not bbox overlap) is deliberate: Surya groups
    at region/paragraph granularity, coarser than Tesseract's per-line
    output, so one Surya region legitimately spans several Tesseract lines
    (e.g. a boxed chapter title + subtitle). Center-point containment
    absorbs that granularity difference and minor edge disagreements
    between the two independent detectors without needing exact alignment.
    """
    header_boxes = [bbox for label, bbox in layout_bboxes if label in SURYA_HEADER_LABELS]
    for line in lines:
        if "y_start" not in line:
            line["is_heading"] = line.get("is_heading", False)
            continue
        cx = (line["x_start"] + line["x_end"]) / 2
        cy = line["y_start"] + line["height"] / 2
        line["is_heading"] = any(
            bx0 <= cx <= bx1 and by0 <= cy <= by1
            for bx0, by0, bx1, by1 in header_boxes
        )


# ----------------------------------------------------------------------------
# Rule-line-framing detection (detector 2). Built because Surya can correctly
# *segment* a heading-shaped region and still mislabel it as plain "Text" --
# verified on Samaysaar Siddhi Part 3 p.100 ("कलश - ३४ पर प्रवचन", framed by a
# rule line above and below, isolated as its own region by Surya but tagged
# "Text"). Also covers multi-line boxed session-metadata headers (1-3 lines
# of date/gatha/shlok/pravachan numbers between two rules or a box's top/
# bottom edges) -- the same underlying signal catches both, since a box's
# edges are just another pair of near-full-width horizontal dark bands.
#
# This is independent of Surya entirely -- it only needs the grayscale image
# and each line's y-position, both already available. Deliberately does NOT
# try to pick "the one heading line" out of a multi-line framed block: every
# line enclosed between a rule pair is marked, because they're all part of
# the same header unit, not separable into heading + body.
# ----------------------------------------------------------------------------

# A genuine printed rule line covers nearly the full prose width in a very
# thin vertical band. Empirically (Samaysaar Siddhi Part 3 p.100): real rule
# rows measured 98.1-98.2% dark. Ordinary (non-bold) body text topped out at
# ~38% -- but a *bold* paragraph (a real, separately-confirmed convention in
# this corpus: the first paragraph of a new discourse session is often set
# bold) can spike to ~85% on a single coincidentally-dense row. 0.85 wasn't
# enough margin above that (found the hard way: it flagged the bold intro
# paragraph right after a real heading as a second rule line). 0.92 keeps
# comfortable distance from both the 85% bold-text ceiling and the 98% rule
# floor.
RULE_LINE_DARK_FRACTION = 0.92
# Max vertical gap between a rule-line pair to still be treated as "framing a
# header block" rather than two unrelated dividers with a whole section of
# unrelated content between them. Generous enough for a 3-line boxed header
# (each line ~60-90px per what we've measured) plus padding; not yet tuned
# against a large sample -- treat as a starting default, not a validated one.
RULE_LINE_MAX_GAP_PX = 400


def _find_rule_line_events(image, prose_left_margin: float, prose_right_margin: float,
                            dark_threshold: int = 128,
                            rule_dark_fraction: float = RULE_LINE_DARK_FRACTION) -> list:
    """
    Returns the y-midpoint of every detected rule-line band in `image`,
    scanning only the prose x-range (so page-margin decorations don't
    register). Adjacent dark rows are merged into one event.
    """
    x0, x1 = int(prose_left_margin), int(prose_right_margin)
    if x1 <= x0:
        return []
    gray = np.array(image.convert("L"))
    dark_fracs = (gray[:, x0:x1] < dark_threshold).mean(axis=1)
    is_rule_row = dark_fracs >= rule_dark_fraction

    events = []
    y = 0
    height = len(is_rule_row)
    while y < height:
        if is_rule_row[y]:
            start = y
            while y < height and is_rule_row[y]:
                y += 1
            events.append((start + y - 1) / 2)
        else:
            y += 1
    return events


def detect_rule_line_headings(lines: list, image, prose_left_margin: float,
                               prose_right_margin: float,
                               max_gap_px: float = RULE_LINE_MAX_GAP_PX) -> set:
    """
    Returns the set of line indices (into `lines`) whose vertical center
    falls between a pair of detected rule-line events that are close enough
    together to be "framing one header block" rather than unrelated dividers.
    """
    rule_events = _find_rule_line_events(image, prose_left_margin, prose_right_margin)
    heading_indices = set()
    for top, bottom in zip(rule_events, rule_events[1:]):
        gap = bottom - top
        if gap <= 0 or gap > max_gap_px:
            continue
        for idx, line in enumerate(lines):
            if "y_start" not in line:
                continue
            cy = line["y_start"] + line["height"] / 2
            if top < cy < bottom:
                heading_indices.add(idx)
    return heading_indices


def classify_via_surya_and_rules(lines: list, layout_bboxes: list, image,
                                  prose_left_margin: float, prose_right_margin: float) -> None:
    """
    Combines detector 1 (Surya layout) and detector 2 (rule-line framing) by
    simple OR: either signal firing is enough to mark a line as a heading.
    No weighted voting or arbitration -- the two detectors have different
    blind spots (Surya can miscategorize a region it did correctly isolate;
    rule-detection only fires when the page actually uses that convention),
    not cases of active disagreement, so a union is the whole combination
    rule. See classify_via_surya_layout and detect_rule_line_headings for
    what each one individually catches and why neither alone is enough.
    """
    classify_via_surya_layout(lines, layout_bboxes)
    rule_indices = detect_rule_line_headings(lines, image, prose_left_margin, prose_right_margin)
    for idx, line in enumerate(lines):
        if idx in rule_indices:
            line["is_heading"] = True


def classify_document_via_surya(ocr_dir: str, pdf_file: str, pdf_processor,
                                 scan_config: dict,
                                 batch_size: int = DEFAULT_SURYA_BATCH_SIZE) -> None:
    """
    Sets `is_heading` on every line using Surya's layout model + rule-line
    framing (classify_via_surya_and_rules). This is what scan_config's
    "header_detection": "surya" selects -- see discovery.py. Without it, no
    heading detection runs for Tesseract documents at all.

    OCR already discarded its in-memory page images, so this re-renders each
    page from `pdf_file` using `pdf_processor._get_image` with the SAME
    scan_config (crop/DPI) that produced the existing line positions --
    Surya's layout coordinates and Tesseract's line coordinates must share
    the same pixel space (see classify_via_surya_layout's docstring).

    Not supported for multi_page documents: page_XXXX.json filenames there
    are logical pages, not a 1:1 mapping to PDF pages, so re-rendering "page
    N" from the PDF wouldn't line up. Raises ValueError if scan_config has
    multi_page set.
    """
    if scan_config.get("multi_page"):
        raise ValueError(
            "header_detection=surya is not yet supported for multi_page documents")

    page_files = _list_page_files(ocr_dir)
    if not page_files:
        return

    # page_XXXX.json filenames are 1:1 with PDF page numbers (no multi_page split).
    page_numbers = sorted(int(f[5:9]) for f in page_files)

    layout_predictor = _get_surya_layout_predictor()
    classified = 0
    for i in range(0, len(page_numbers), batch_size):
        batch = page_numbers[i:i + batch_size]
        images, rendered_page_numbers = pdf_processor._get_image(pdf_file, batch, scan_config)
        if not images:
            continue

        layout_results = layout_predictor(images)

        for page_num, image, result in zip(rendered_page_numbers, images, layout_results):
            fname = f"page_{page_num:04d}.json"
            page = _load_page(ocr_dir, fname)
            if not page or not page.get("lines"):
                continue

            layout_bboxes = [(b.label, tuple(b.bbox)) for b in result.bboxes]
            metadata = page.get("metadata", {})
            classify_via_surya_and_rules(
                page["lines"], layout_bboxes, image,
                metadata.get("prose_left_margin", 0),
                metadata.get("prose_right_margin", 0),
            )
            with open(os.path.join(ocr_dir, fname), 'w', encoding='utf-8') as f:
                json.dump(page, f, ensure_ascii=False, indent=2)
            classified += 1

    log_handle.info(
        f"heading_detector: classified {classified}/{len(page_numbers)} pages in "
        f"{ocr_dir} via Surya layout model")
