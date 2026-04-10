import logging
import fitz
from abc import ABC, abstractmethod
from typing import List, Dict, Any, Optional

log_handle = logging.getLogger(__name__)


class BookmarkExtractor(ABC):
    """
    Base class for extracting and parsing PDF bookmarks using LLMs.

    This class handles PDF bookmark extraction and delegates LLM-specific
    processing to subclasses.
    """

    def __init__(self):
        self._fallback_extractor = None
        self.system_prompt = """
You are a data extraction assistant. Extract the Pravachan Number, Date, Gatha, Kalash, and Shlok from bookmark titles.

You will receive a JSON array of objects. You MUST return a JSON array with the SAME number of items.

Each output object must have:
- index: the position number from the input
- pravachan_no: the extracted pravachan number, or null if not found
- date: the extracted date in DD-MM-YYYY format, or null if not found
- gatha: the extracted gatha number/range (e.g. "4", "65-66"), or null if not found
- kalash: the extracted kalash number/range (e.g. "219", "2-3"), or null if not found
- shlok: the extracted shlok number/range (e.g. "5", "2-14-15"), or null if not found

Gatha variants (case-insensitive): gatha, GATHA, gATHA, Gāthā, etc.
Kalash variants (case-insensitive): kalash, KALASH, Kalash, Kalaś, etc.
Shlok variants (case-insensitive): shlok, SHLOK, sHLOK, shloka, Sloka, etc.
Doha variants (case-insensitive): doha, DOHA, Doha etc.
Sutra variants (case-insensitive): sutra, Sutra, SUTRA etc.

Number normalization: replace commas with dashes ("2,3" → "2-3"), replace "&" with "-" ("65 & 66" → "65-66").

EXAMPLE - Process ALL items in the input array:
Input (3 items):
[
  {"index": 0, "page": 5,  "title": "Prav. no. 244-A on Kalash 219, Date: 07-11-1965"},
  {"index": 1, "page": 18, "title": "Gatha 65 & 66"},
  {"index": 2, "page": 32, "title": "sHLOK 2-14-15"},
  {"index": 3, "page": 48, "title": "Doha 3,4,5,6 and Sutra 4"}
]

Output (3 items - MUST match input length):
[
  {"index": 0, "page": 5,  "pravachan_no": "244-A", "date": "07-11-1965", "gatha": null, "kalash": "219", "shlok": null, "doha": null, "sutra": null},
  {"index": 1, "page": 18, "pravachan_no": null, "date": null, "gatha": "65-66", "kalash": null, "shlok": null, "doha": null, "sutra": null},
  {"index": 2, "page": 32, "pravachan_no": null, "date": null, "gatha": null, "kalash": null, "shlok": "2-14-15", "doha": null, "sutra": null},
  {"index": 3, "page": 48, "pravachan_no": null, "date": null, "gatha": null, "kalash": null, "shlok": null, "doha": "3-6", "sutra": 4}
]

CRITICAL: Output array length MUST equal input array length. Process every item.
Convert dates from formats like "26th Sep 1978" to DD-MM-YYYY format.
Return ONLY the JSON array, nothing else.
"""

    def parse_bookmarks(self, pdf_file: str, batch_size: int = 100) -> List[Dict[str, str]]:
        """
        Main function to extract bookmarks from PDF and parse them using LLM.

        Args:
            pdf_file: Path to the PDF file
            batch_size: Number of bookmarks to process per LLM call (default: 100)

        Returns:
            List of dictionaries with parsed bookmark data including:
            - page: Page number
            - level: Bookmark hierarchy level
            - title: Original bookmark title
            - pravachan_no: Extracted pravachan number
            - date: Extracted date
        """
        log_handle.info("Starting bookmark extraction for PDF: %s", pdf_file)

        # Step 1: Extract bookmarks from PDF
        bookmark_json = self._extract_bookmarks_from_pdf(pdf_file)

        if not bookmark_json.get('bookmarks'):
            log_handle.warning("No bookmarks found in PDF: %s", pdf_file)
            return []

        log_handle.info("Found %s bookmarks in PDF", bookmark_json['total'])

        # Step 2: Prepare indexed titles for LLM (include page for traceability in logs)
        bookmarks = bookmark_json['bookmarks']
        indexed_titles = [
            {"index": i, "page": item.get('page'), "title": item.get('title', '')}
            for i, item in enumerate(bookmarks)
        ]

        # Step 3: Process in batches to avoid timeouts
        all_extracted_data = []
        total_batches = (len(indexed_titles) + batch_size - 1) // batch_size

        log_handle.info("Processing %s bookmarks in %s batches of %s", len(indexed_titles), total_batches, batch_size)

        for batch_num in range(total_batches):
            start_idx = batch_num * batch_size
            end_idx = min((batch_num + 1) * batch_size, len(indexed_titles))
            batch = indexed_titles[start_idx:end_idx]

            log_handle.info("Processing batch %s/%s (%s bookmarks)", batch_num + 1, total_batches, len(batch))

            # Call LLM for this batch
            extracted_data = self.call_llm(batch)

            if not extracted_data:
                if self._fallback_extractor:
                    log_handle.warning(
                        "Primary LLM failed for batch %s/%s, trying fallback extractor",
                        batch_num + 1, total_batches
                    )
                    extracted_data = self._fallback_extractor.call_llm(batch)

            if not extracted_data:
                log_handle.error("Failed to extract data from LLM for batch %s/%s", batch_num + 1, total_batches)
                return []

            all_extracted_data.extend(extracted_data)
            log_handle.info("Successfully processed batch %s/%s", batch_num + 1, total_batches)

        log_handle.info("Successfully extracted data from all %s batches", total_batches)

        # Step 4: Merge extracted data back with original page numbers
        result = self._merge_results(bookmarks, all_extracted_data)
        log_handle.info("Bookmark extraction completed. Processed %s bookmarks", len(result))
        return result

    def _extract_bookmarks_from_pdf(self, pdf_path: str) -> Dict[str, Any]:
        """
        Extract bookmarks from a PDF file and return as JSON.

        Args:
            pdf_path: Path to the PDF file

        Returns:
            Dictionary with 'bookmarks' list and 'total' count
        """
        doc = fitz.open(pdf_path)
        toc = doc.get_toc(simple=True)  # Format: [level, title, page_number]
        doc.close()

        bookmarks = [
            {"level": level, "title": title, "page": page}
            for level, title, page in toc
        ]

        return {
            "bookmarks": bookmarks,
            "total": len(bookmarks)
        }

    def _merge_results(
        self,
        bookmarks: List[Dict[str, Any]],
        extracted_data: List[Dict[str, str]]
    ) -> List[Dict[str, str]]:
        """
        Merge extracted LLM data with original bookmark information.

        Args:
            bookmarks: Original bookmark data from PDF
            extracted_data: Data extracted by LLM

        Returns:
            List of merged bookmark data
        """
        final_output = []

        # Create a dictionary for quick lookup of extracted data using the index
        extracted_map = {item.get('index'): item for item in extracted_data}

        for i, original_item in enumerate(bookmarks):
            extracted_item = extracted_map.get(i)

            if extracted_item:
                final_output.append({
                    "page": original_item['page'],   # authoritative source
                    "level": original_item['level'],
                    "title": original_item['title'],
                    "pravachan_no": extracted_item.get('pravachan_no'),
                    "date": extracted_item.get('date'),
                    "gatha": extracted_item.get('gatha'),
                    "kalash": extracted_item.get('kalash'),
                    "shlok": extracted_item.get('shlok'),
                    "doha": extracted_item.get('doha'),
                    "sutra": extracted_item.get('sutra'),
                })
                log_handle.debug("index=%d page=%s → pravachan=%s date=%s gatha=%s kalash=%s shlok=%s doha=%s, sutra=%s",
                    i, original_item['page'],
                    extracted_item.get('pravachan_no'), extracted_item.get('date'),
                    extracted_item.get('gatha'), extracted_item.get('kalash'), extracted_item.get('shlok'), extracted_item.get('doha'), extracted_item.get('sutra')
                )

        return final_output

    @abstractmethod
    def call_llm(self, indexed_titles: List[Dict[str, Any]]) -> Optional[List[Dict[str, str]]]:
        """
        Call LLM to extract pravachan number and date from bookmark titles.

        This method must be implemented by subclasses.

        Args:
            indexed_titles: List of dictionaries with 'index' and 'title' keys

        Returns:
            List of dictionaries with 'index', 'pravachan_no', and 'date' keys
            Returns None if extraction fails
        """
        pass