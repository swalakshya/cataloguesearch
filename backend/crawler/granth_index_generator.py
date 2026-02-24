import json
import logging
import os
import re
import traceback
from datetime import datetime, timezone

from opensearchpy import OpenSearch

from backend.config import Config
from backend.crawler.index_generator import IndexGenerator

log_handle = logging.getLogger(__name__)

_VERSE_BLOCK_TYPES = {"hindi_verse", "prakrit_verse", "sanskrit_verse"}


class GranthIndexGenerator(IndexGenerator):
    """
    IndexGenerator subclass for Granth (Jain scripture) LLM-extracted documents.

    Paragraph path (pages_*.txt):
        Handled entirely by the base class — text + vector embeddings + metadata.

    Verse path (verses_*.json):
        Written by _write_verses() then indexed as text-only chunks (no embeddings).
        Only verse types listed in scan_config["verses"] are indexed into OpenSearch.
    """

    # Matches [...] non-greedily — nested brackets are not handled (by design).
    _BRACKET_RE = re.compile(r'\[.*?\]', re.DOTALL)

    def __init__(self, config: Config, opensearch_client: OpenSearch):
        super().__init__(config, opensearch_client)

    def _prepare_embedding_text(self, text: str) -> str:
        """Strip square-bracket content (glosses, transliterations) and normalize spacing."""
        cleaned = self._BRACKET_RE.sub('', text)
        return ' '.join(cleaned.split())

    def index_document(self, document_id, original_filename,
                       ocr_dir, output_text_dir, pages_list, metadata,
                       scan_config, page_to_pravachan_data,
                       reindex_metadata_only=False, dry_run=True,
                       pdf_processor=None, clean_output_dir=True):
        # Base class handles paragraphs: write files, embed, index, metadata_index update
        super().index_document(
            document_id, original_filename,
            ocr_dir, output_text_dir, pages_list, metadata,
            scan_config, page_to_pravachan_data,
            reindex_metadata_only, dry_run,
            pdf_processor=pdf_processor,
            clean_output_dir=clean_output_dir
        )

        # Metadata-only mode touches neither files nor verse chunks
        if reindex_metadata_only:
            return

        # Write verses_NNNN.json files (re-read raw blocks since base class doesn't expose them)
        from backend.crawler.pdf_factory import create_pdf_processor
        chunk_strategy = scan_config.get("chunk_strategy")
        processor = pdf_processor or create_pdf_processor(self._config, chunk_strategy, scan_config)
        raw_data = processor.read_paragraphs(ocr_dir, pages_list)
        self._write_verses(output_text_dir, raw_data)

        log_handle.info("Metadata that will be indexed: %s", metadata)

        if dry_run:
            return

        # Index verse chunks into OpenSearch (text-only, no vector embeddings)
        verse_types = scan_config.get("verses", [])
        if not verse_types:
            log_handle.info("No verse types configured in scan_config. Skipping verse indexing.")
            return

        timestamp = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
        verse_data = self._read_verse_files(output_text_dir, verse_types, pages_list)
        verse_chunks = self._create_chunks_from_verses(
            verse_data, document_id, original_filename,
            metadata, page_to_pravachan_data, timestamp
        )
        if verse_chunks:
            self._bulk_index_chunks(verse_chunks)
            log_handle.info("Indexed %d verse chunks for %s.", len(verse_chunks), document_id)
        else:
            log_handle.info("No verse chunks to index for %s.", document_id)

    def _write_verses(self, output_dir: str, raw_data):
        """
        Write verses_NNNN.json to output_dir for each page that has verse blocks.

        Each file contains all verse blocks for that page:
            [{"type": "prakrit_verse", "text": "..."}, ...]

        Pages with no verse blocks produce no file.
        scan_config["verses"] filtering is deferred to the OpenSearch indexing step.
        """
        for page_num, data in raw_data:
            if not isinstance(data, list):
                return  # plain-text OCR — not block format, nothing to do
            verses = [b for b in data if b.get("type") in _VERSE_BLOCK_TYPES]
            if not verses:
                continue
            fname = f"{output_dir}/verses_{page_num:04d}.json"
            try:
                with open(fname, 'w', encoding='utf-8') as fh:
                    json.dump(verses, fh, ensure_ascii=False, indent=2)
            except IOError:
                traceback.print_exc()
                log_handle.error(f"Failed to write {fname}")

    def _read_verse_files(self, output_text_dir: str, verse_types: list,
                          pages_list: list[int] = None) -> list[tuple[int, list[dict]]]:
        """
        Read verses_NNNN.json files from output_text_dir, keeping only blocks
        whose type is in verse_types (from scan_config["verses"]).

        When pages_list is provided, only verse files whose page number is in
        pages_list are read — prevents picking up sibling sub-sections' verse files
        when multiple sub-sections share the same output_text_dir.

        Returns List[Tuple[page_num, List[dict]]] — only pages with matching verses.
        """
        verse_type_set = set(verse_types)
        pages_set = set(pages_list) if pages_list is not None else None
        result = []

        try:
            files = sorted(
                f for f in os.listdir(output_text_dir)
                if f.startswith("verses_") and f.endswith(".json")
            )
        except OSError:
            log_handle.error(f"Could not list directory: {output_text_dir}")
            return result

        for fname in files:
            try:
                page_num = int(fname[len("verses_"):-len(".json")])
            except ValueError:
                continue

            if pages_set is not None and page_num not in pages_set:
                continue

            fpath = os.path.join(output_text_dir, fname)
            try:
                with open(fpath, 'r', encoding='utf-8') as fh:
                    blocks = json.load(fh)
            except (IOError, json.JSONDecodeError) as e:
                log_handle.error(f"Could not read {fpath}: {e}")
                continue

            filtered = [b for b in blocks if b.get("type") in verse_type_set]
            if filtered:
                result.append((page_num, filtered))

        return result

    def _create_chunks_from_verses(self, verse_data, document_id, original_filename,
                                   metadata, page_to_pravachan_data, timestamp):
        """
        Create chunk dicts for each verse block.

        Verses are stored as text-only (no vector_embedding) with a verse_type field.
        chunk_id uses the _verse suffix to avoid collision with paragraph chunk IDs.
        """
        chunks = []
        language = metadata.get("language", "hi")
        lang_key = self._index_keys_per_lang.get(language, self._index_keys_per_lang["hi"])

        i = 0
        for page_num, verses in verse_data:
            pravachan_data = page_to_pravachan_data.get(page_num, {})
            pravachan_number = pravachan_data.get('pravachan_no')
            date_str = pravachan_data.get('date')

            date_iso = None
            if date_str:
                try:
                    date_obj = datetime.strptime(date_str, "%d-%m-%Y")
                    date_iso = date_obj.strftime("%Y-%m-%d")
                except ValueError:
                    log_handle.warning(f"Invalid date format for page {page_num}: {date_str}")

            for verse in verses:
                verse_text = verse.get("text", "").strip()
                if not verse_text:
                    continue

                chunk = {
                    "chunk_id": f"{document_id}_p{page_num}_verse{i}",
                    "document_id": document_id,
                    "original_filename": original_filename,
                    "page_number": page_num,
                    "verse_id": i,
                    "verse_type": verse.get("type"),
                    "metadata": metadata,
                    "pravachan_number": pravachan_number,
                    "date": date_iso,
                    "gatha": pravachan_data.get('gatha'),
                    "kalash": pravachan_data.get('kalash'),
                    "shlok": pravachan_data.get('shlok'),
                    "timestamp_indexed": timestamp,
                    "language": language,
                    lang_key: verse_text,
                }
                chunks.append(chunk)
                i += 1

        return chunks
