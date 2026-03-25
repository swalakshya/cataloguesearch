# Indexing a New PDF — A Practical Guide

CatalogueSearch ingests PDF documents through a configurable pipeline: OCR (Tesseract or Gemini LLM), paragraph extraction, vector embedding, and indexing into OpenSearch. This guide walks through every decision you need to make when adding a new document.

All source PDFs and their configuration files live in the companion repository [cataloguesearch-configs](https://github.com/swalakshya/cataloguesearch-configs). You never touch the main `cataloguesearch` repo to add a document — only `cataloguesearch-configs`.

---

## Table of Contents

1. [Where files live](#1-where-files-live)
2. [config.json — document metadata](#2-configjson--document-metadata)
3. [scan_config.json — processing options](#3-scan_configjson--processing-options)
4. [Tesseract vs LLM parsing](#4-tesseract-vs-llm-parsing)
5. [Crop options](#5-crop-options)
6. [Multi-page PDFs (book spreads)](#6-multi-page-pdfs-book-spreads)
7. [Sub-sections](#7-sub-sections)
8. [Question and answer prefixes](#8-question-and-answer-prefixes)
9. [Stop words](#9-stop-words)
10. [Typo list](#10-typo-list)
11. [Processing and indexing](#11-processing-and-indexing)
12. [Where OCR and paragraph files are kept](#12-where-ocr-and-paragraph-files-are-kept)
13. [The Eval UI](#13-the-eval-ui)

---

## 1. Where config files live

`cataloguesearch-configs` organises documents in a two-level hierarchy:

```
cataloguesearch-configs/
├── Pravachans/                          # Discourse PDFs
│   ├── hindi/
│   │   └── <Anuyog>/
│   │       └── <Series>/               ← PDFs + config.json go here
│   └── gujarati/
│       └── <Anuyog>/
│           └── <Series>/
└── Granth/                             # Scripture PDFs
    └── llm_extract/
        └── hindi/
            └── <Anuyog>/
                └── <Name>/             ← PDFs + config.json go here
```

Each level of the folder tree can have its own `config.json` (for metadata) and `scan_config.json` (for processing options). Settings cascade from the root down to the leaf — leaf values override the values of the lower directory.

See the existing entries in [cataloguesearch-configs](https://github.com/swalakshya/cataloguesearch-configs) for real examples.

---

## 2. config.json — document metadata

Each folder can contain a `config.json` that contributes metadata fields to every PDF in that folder (and subfolders, unless overridden). Fields accumulate as you walk up the tree.

**Typical leaf-level config.json for a Pravachan series:**

```json
{
  "language": "hi",
  "Anuyog": "Dravyanuyog",
  "Series": "Paryay Vichar",
  "series_start_date": "1998-01-01"
}
```

**Typical leaf-level config.json for a scripture:**

```json
{
  "language": "hi",
  "Granth": "Samaysar",
  "Author": "Kundkund Acharya",
  "Teekakar": "Amrutchandra Acharya"
}
```

Fields you can set at any level:

| Field | Purpose                                                 |
|-------|---------------------------------------------------------|
| `language` | `hi` or `gu`                                            |
| `Anuyog` | Category (e.g. Dravyanuyog, Charnanuyog etc.)           |
| `Granth` | Scripture name (Granth only)                            |
| `Author` | Author name                                             |
| `Teekakar` | Commentator name (optional)                             |
| `Series` | Discourse series name (Pravachan only) (optional)       |
| `series_start_date` | ISO date string (yyyy-mm-dd)                            |
| `series_end_date` | ISO date string (yyyy-mm-dd)                 |
| `file_url` | Public URL to the original PDF (shows "View PDF" in UI) |

---

## 3. scan_config.json — processing options

A discourse series or a Granth can have multiple PDF files associated with it. The `scan_config.json` defines the configuration at an overall level, and per-PDF file.

`scan_config.json` controls how the PDF is processed. It has two layers:

- **`"default"`** — applies to all PDFs in this folder and subfolders
- **`"<filename-without-extension>"`** — applies to one specific PDF only, and overrides `default`

Following is the `scan_config` for a file `My_Book_Part1.pdf`.

```json
{
  "default": {
    "ocr_engine": "tesseract",
    "chunk_strategy": "advanced",
    "crop": { "top": 9, "bottom": 8 },
    "stop_words": ["विशेष"],
    "typo_list": [["प्रश्न :", "प्रश्न:"]]
  },
  "My_Book_Part1": {
    "start_page": 5,
    "end_page": 210,
    "file_url": "https://example.com/my-book.pdf",
    "question_prefix": ["प्रश्न"],
    "answer_prefix": ["उत्तर"]
  }
}
```

Full reference of all options:

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `ocr_engine` | string | `"tesseract"` | `"tesseract"` or `"llm"` — selects the OCR pipeline |
| `chunk_strategy` | string | `"advanced"` | `"advanced"` (Tesseract path) or `"llm"` (LLM path) |
| `crop` | object | `{}` | Percentage to strip before OCR. Keys: `top`, `bottom` (% of height), `left`, `right` (% of width) |
| `psm` | int | 3 | Tesseract page segmentation mode (only for Tesseract path) |
| `header_prefix` | array | `[]` | Lines starting with these strings are treated as headers/footers and excluded |
| `header_regex` | array | `[]` | Regex patterns that match header/footer lines |
| `question_prefix` | array | `[]` | Line prefixes that mark a question (e.g. `["प्रश्न"]`) |
| `answer_prefix` | array | `[]` | Line prefixes that mark an answer (e.g. `["उत्तर"]`) |
| `stop_words` | array | `[]` | Lines starting with these trigger a paragraph flush (e.g. commentary markers) |
| `verses` | array | `[]` | Verse block types to extract (LLM path only): `"hindi_verse"`, `"prakrit_verse"`, `"sanskrit_verse"` |
| `typo_list` | array | `[]` | `[pattern, replacement]` pairs applied as regex substitutions |
| `start_page` | int | 1 | First PDF page to process (file-specific only) |
| `end_page` | int | last | Last PDF page to process (file-specific only) |
| `page_list` | array | `[]` | Explicit list of page ranges: `[{"start": 1, "end": 5}, {"start": 100, "end": 150}]` |
| `multi_page` | bool | false | Set to `true` for scanned book spreads (two logical pages per physical page) |
| `book_start_page` | int | 1 | Which PDF page the book content begins on (multi-page only) |
| `book_start_side` | string | `"left"` | Which side of the spread holds the first logical page: `"left"` or `"right"` |
| `split_percentage` | int | 50 | Percentage from the left edge where the page is split (multi-page only) |
| `llm_model` | string | `"gemini-2.5-flash"` | Gemini model to use (LLM path only) |
| `llm_workers` | int | 6 | Parallel workers for LLM calls (LLM path only) |
| `ignore_bookmarks` | bool | false | Skip PDF bookmark extraction |
| `qa_merge` | bool | true | Whether to merge Q&A pairs into a single chunk |
| `sub_sections` | array | — | Divide one PDF into separate indexed sections (see §7) |
| `file_url` | string | — | Public URL to the source PDF |

---

## 4. Tesseract vs LLM parsing

The `ocr_engine` setting selects the pipeline:

### Tesseract (`"ocr_engine": "tesseract"`)

Best for **clearly typeset, structured documents** such as discourses, Q&A booklets, and printed books with consistent formatting. Tesseract is fast, free, and works offline.

**Pipeline:** PDF → page images → Tesseract OCR → line-level JSON with bounding boxes → `AdvancedParagraphGenerator` merges lines into paragraphs.

```json
{
  "default": {
    "ocr_engine": "tesseract",
    "chunk_strategy": "advanced"
  }
}
```

Tuning tips:
- Adjust `crop` to remove running headers, footers and page numbers before OCR runs for more accurate OCR.
- If recognition is poor, try changing `psm` (Tesseract page segmentation mode). `psm: 6` works well for single-column text; `psm: 3` (default) for mixed layouts.

### LLM / Gemini (`"ocr_engine": "llm"`)

Best for **scriptures (Granth)** with mixed scripts (Devanagari prose, Sanskrit/Prakrit verses, chapter headings). Gemini returns typed blocks, which lets the pipeline separate prose from verse chunks.

**Pipeline:** PDF → page images → Gemini API → typed block list → `GranthParagraphGenerator` splits prose paragraphs and verse chunks.

```json
{
  "default": {
    "ocr_engine": "llm",
    "chunk_strategy": "llm",
    "verses": ["hindi_verse", "prakrit_verse", "sanskrit_verse"],
    "stop_words": ["विशेष"],
    "question_prefix": ["प्रश्न"],
    "answer_prefix": ["उत्तर"]
  }
}
```

Verse chunks are indexed **without** vector embeddings (they're meant to be found by exact keyword search). All prose chunks get embeddings as usual.

---

## 5. Crop options

Headers, footers, and page numbers at the edges of a scanned page confuse the paragraph assembler. Crop them out before OCR runs.

```json
{
  "crop": {
    "top": 8,
    "bottom": 6
  }
}
```

Values are **percentages of the page height** — `8` means strip the top 8% of the image before passing it to OCR. Start with 6–9% for top and bottom, then use the Eval UI (see §13) to check whether headers are still leaking through.

You can set a different crop per-file by adding a `"<filename>"` key alongside `"default"`:

```json
{
  "default": {
    "crop": { "top": 8, "bottom": 6, "left": 0, "right": 0 }
  },
  "Samaysar_Vol2": {
    "crop": { "top": 12, "bottom": 8 }
  }
}
```

---

## 6. Multi-page PDFs (book spreads)

Some scanned books have **two logical pages side-by-side on each physical PDF page** (a book spread). Enable `multi_page` to split each physical page vertically before OCR.

```json
{
  "default": {
    "multi_page": true,
    "book_start_page": 1,
    "book_start_side": "left",
    "split_percentage": 50
  }
}
```

- **`book_start_page`** — the PDF page number where the actual content starts (skip any cover pages).
- **`book_start_side`** — which half of the first content spread holds logical page 1: `"left"` or `"right"`.
- **`split_percentage`** — where to draw the vertical split, as a percentage from the left edge. `50` means the centre; adjust if the gutter is off-centre.

The crawler produces one `page_XXXX.json` file per **logical** page and writes a `page_mapping.json` so the UI can link search results back to the correct PDF page.

---

## 7. Sub-sections

When a single PDF contains distinct sections that should be indexed as **separate documents** (e.g. to assign different metadata, or to allow filtering by section), use `sub_sections`.

```json
{
  "My_Combined_Book": {
    "sub_sections": [
      {
        "name": "Part 1 — Introduction",
        "start_page": 1,
        "start_side": "left",
        "end_page": 80,
        "end_side": "right"
      },
      {
        "name": "Part 2 — Main Text",
        "start_page": 81,
        "start_side": "left",
        "end_page": 350,
        "end_side": "right"
      }
    ]
  }
}
```

Each sub-section is crawled and indexed independently. `start_side` / `end_side` matter only for multi-page spreads (they indicate which half of the spread the section starts/ends on). For regular PDFs you can omit them.

**Important:** sub-sections are file-specific — they go under the filename key, not under `"default"`.

---

## 8. Question and answer prefixes

For Q&A style documents (pravachan transcripts, catechisms, commentary books), tag the line prefixes that introduce a question or an answer. The paragraph assembler keeps Q&A pairs together and marks them so they can be styled differently in search results.

```json
{
  "default": {
    "question_prefix": ["प्रश्न", "शंका", "Q:"],
    "answer_prefix": ["उत्तर", "समाधान", "A:"]
  }
}
```

Prefixes are matched at the **start of a line** after normalisation. A colon after the prefix is fine — `"प्रश्न:"` and `"प्रश्न :"` are both recognised as long as the prefix itself is listed (and any space-before-colon typo is fixed via `typo_list`).

Gujarati example from existing configs:

```json
{
  "question_prefix": ["શ્રોતા:", "મુમુક્ષુ:", "શંકા:", "પ્રશ્ન:"],
  "answer_prefix": ["પૂજ્ય ગુરુદેવશ્રી:", "સમાધાન:", "ઉત્તર:"]
}
```

---

## 9. Stop words

Stop words mark the **start of a commentary block** or a special note that should not flow into the preceding paragraph. When the assembler encounters a line beginning with a stop word, it flushes the current paragraph buffer before starting a new one.

```json
{
  "stop_words": ["विशेष", "टिप्पणी", "नोट", "Note"]
}
```

Typical use: footnotes, editorial remarks, or special annotations printed inline with the main text.

---

## 10. Typo list

The typo list is applied as a sequence of **regex substitutions** on each line of text before paragraph assembly. Use it to fix systematic OCR errors or normalise punctuation inconsistencies.

```json
{
  "typo_list": [
    ["प्रश्न :", "प्रश्न:"],
    ["उत्तर :", "उत्तर:"],
    ["ं([^\u0900-\u097F])", "ं $1"]
  ]
}
```

Each entry is `[pattern, replacement]`. Patterns follow Python `re` syntax. Keep the list small — these run on every line of every page.

---

## 11. Processing and indexing

All commands are run from the root of the `cataloguesearch` repo with the virtualenv active.

### Step 1 — Dry run

Always start with a dry run. This runs the full OCR and paragraph-generation pipeline and prints what would be indexed, without writing anything to OpenSearch.

```bash
source venv/bin/activate
python scripts/discovery_cli.py discover \
  --process-folder /path/to/cataloguesearch-configs/Pravachans/hindi/Dravyanuyog/My_Series \
  --crawl --index --dry-run
```

Check the output for:
- Correct page counts
- Sensible paragraph counts
- No obvious OCR garbage in the text preview

### Step 2 — Index for real

```bash
python scripts/discovery_cli.py discover \
  --process-folder /path/to/cataloguesearch-configs/Pravachans/hindi/Dravyanuyog/My_Series \
  --crawl --index --no-dry-run
```

### Metadata-only re-index

If you've only changed `config.json` (metadata fields) and don't want to re-run OCR and embedding generation:

```bash
python scripts/discovery_cli.py discover \
  --process-folder /path/to/folder \
  --crawl --index --no-dry-run --reindex-metadata-only
```

### Cleanup / re-index from scratch

To remove all traces of a document (OpenSearch entries, local text files, SQLite state) before re-indexing with changed settings:

```bash
python scripts/discovery_cli.py discover \
  --cleanup /path/to/cataloguesearch-configs/Pravachans/hindi/Dravyanuyog/My_Series/My_Book.pdf
```

Then run the full index command again.

---

## 12. Where OCR and paragraph files are kept

Intermediate files are written to paths configured in `configs/config.yaml`:

```
~/cataloguesearch/
├── ocr/
│   └── <relative-path-to-pdf-without-extension>/
│       ├── page_0001.json     # Raw OCR output (one file per logical page)
│       ├── page_0002.json
│       └── page_mapping.json  # Present only for multi-page PDFs
└── text/
    └── <relative-path-to-pdf-without-extension>/
        ├── page_0001.txt      # Extracted paragraphs (one paragraph per line)
        ├── page_0002.txt
        └── verses_0005.json   # Verse chunks (LLM path only, one file per verse page)
```

The `<relative-path>` mirrors the structure inside `cataloguesearch-configs/`. For example:

```
ocr/Pravachans/hindi/Dravyanuyog/My_Series/My_Book/page_0001.json
text/Pravachans/hindi/Dravyanuyog/My_Series/My_Book/page_0001.txt
```

These files are safe to delete and regenerate at any time — the cleanup command does this for you.

### OCR JSON format (Tesseract path)

```json
{
  "page_num": 1,
  "lines": [
    { "text": "प्रवचन १", "x_start": 400, "x_end": 600, "confidence": 94 }
  ]
}
```

### OCR JSON format (LLM path)

```json
[
  { "type": "chapter_heading", "text": "अध्याय १" },
  { "type": "hindi_verse",     "text": "जल है तो कल है" },
  { "type": "hindi_text",      "text": "यह सूत्र बताता है कि..." }
]
```

---

## 13. The Eval UI

The Eval UI is a local developer tool for inspecting OCR output, tuning crop settings, and testing paragraph generation — without running a full index cycle.

### Starting the eval server

It requires starting the backend `eval` service and the frontend service.

**Eval API (port 8001):**

```bash
source venv/bin/activate
uvicorn eval.api:app --host 0.0.0.0 --port 8001 --reload
```

**Frontend (port 3000):**

```bash
cd frontend && npm start
```

Then open **http://localhost:3000/eval** in your browser.

### What you can do

| Feature                  | How to use it                                                                                                                                    |
|--------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------|
| **OCR preview**          | Upload a PDF and pick a page range. Inspect the raw OCR text for the corresponding page. Useful for checking the OCR quality and crop settings.  |
| **Paragraph generation** | Run the paragraph assembler on already-OCR'd JSON files. Lets you tweak `stop_words`, `question_prefix`, and `typo_list` without re-running OCR. |
| **LLM OCR (scripture)**  | Send a page image to Gemini and inspect the typed block output before committing to a full run.                                                  |
| **Bookmark extraction**  | Test the LLM-based bookmark extraction that populates metadata.                                                                                  |
| **Batch OCR**            | Queue a whole folder of pages for OCR; download results as a ZIP.                                                                                |
  | **ParaClassifier**     | Lets you make para classification changes to the Gemini output for minor corrections here and there |  
The Eval UI is the right place to iterate on `crop`, `psm`, `stop_words`, and `typo_list` settings before running the full pipeline.