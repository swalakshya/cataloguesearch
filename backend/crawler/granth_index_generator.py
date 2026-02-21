import json
import logging
import traceback

from opensearchpy import OpenSearch

from backend.config import Config
from backend.crawler.index_generator import IndexGenerator

log_handle = logging.getLogger(__name__)

_VERSE_BLOCK_TYPES = {"hindi_verse", "prakrit_verse", "sanskrit_verse"}


class GranthIndexGenerator(IndexGenerator):
    """
    IndexGenerator subclass for Granth (Jain scripture) LLM-extracted documents.

    Extends the base indexer to write verses_NNNN.json alongside the standard
    page_NNNN.txt paragraph files. Each verse file contains all verse blocks
    (hindi_verse, prakrit_verse, sanskrit_verse) for that page.

    Filtering of verse types for OpenSearch indexing is deferred to the indexing step
    and driven by scan_config["verses"].
    """

    def __init__(self, config: Config, opensearch_client: OpenSearch):
        super().__init__(config, opensearch_client)

    def index_document(self, document_id, original_filename,
                       ocr_dir, output_text_dir, pages_list, metadata,
                       scan_config, page_to_pravachan_data,
                       reindex_metadata_only=False, dry_run=True,
                       pdf_processor=None):
        # Run base indexing (paragraphs, OpenSearch, etc.)
        super().index_document(
            document_id, original_filename,
            ocr_dir, output_text_dir, pages_list, metadata,
            scan_config, page_to_pravachan_data,
            reindex_metadata_only, dry_run,
            pdf_processor=pdf_processor
        )

        # Skip verse writing when only updating metadata (no file output in that mode)
        if reindex_metadata_only:
            return

        # Write verse files — read raw blocks again since base class doesn't expose them
        from backend.crawler.pdf_factory import create_pdf_processor
        chunk_strategy = scan_config.get("chunk_strategy")
        processor = pdf_processor or create_pdf_processor(self._config, chunk_strategy, scan_config)
        raw_data = processor.read_paragraphs(ocr_dir, pages_list)
        self._write_verses(output_text_dir, raw_data)

    def _write_verses(self, output_dir: str, raw_data):
        """
        Write verses_NNNN.json to output_dir for each page that has verse blocks.

        Each file contains all verse blocks for that page:
            [{"type": "prakrit_verse", "text": "..."}, ...]

        Pages with no verse blocks produce no file.
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