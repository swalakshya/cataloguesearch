import json
import logging
import os
import os.path
import shutil
import sys
import traceback
from datetime import datetime, timezone

from opensearchpy import OpenSearch, helpers

from backend.common.embedding_models import get_embedding_model_factory
from backend.common.opensearch import delete_documents_by_document_id, update_metadata_index, refresh_pravachan_series_metadata
from backend.config import Config
from backend.crawler.pdf_factory import create_pdf_processor
from backend.crawler.paragraph_generator.factory import create_paragraph_generator
from backend.crawler.paragraph_generator.language_meta import get_language_meta

# Setup logging for this module
log_handle = logging.getLogger(__name__)

class IndexGenerator:
    """
    Handles text chunking, vector embedding generation, and indexing into OpenSearch.
    Supports pluggable chunking and embedding algorithms.
    """

    def __init__(self, config: Config, opensearch_client: OpenSearch):
        self._config = config
        self._opensearch_config_path = config.OPENSEARCH_CONFIG_PATH
        self._index_name = config.OPENSEARCH_INDEX_NAME
        self._metadata_index_name = config.OPENSEARCH_METADATA_INDEX_NAME
        self._opensearch_settings = {}
        self._embedding_model_name = config.EMBEDDING_MODEL_NAME
        self._opensearch_client = opensearch_client

        self._index_keys_per_lang = {
            "hi": "text_content_hindi",
            "gu": "text_content_gujarati"
        }


    def index_document(
        self, document_id: str, original_filename: str,
        ocr_dir: str, output_text_dir: str, pages_list: list[int], metadata: dict,
        scan_config: dict, page_to_pravachan_data: dict[int, dict],
        reindex_metadata_only: bool = False, dry_run: bool = True,
        pdf_processor=None, clean_output_dir: bool = True):
        log_handle.info(
            f"Indexing document: {document_id}, reindex_metadata_only: {reindex_metadata_only}, "
            f"Dry Run: {dry_run}")

        chunk_strategy = scan_config.get("chunk_strategy")

        # Use the provided processor (created by SingleFileProcessor) or fall back to
        # creating one here for standalone callers (scripts, tests).
        if pdf_processor is None:
            pdf_processor = create_pdf_processor(self._config, chunk_strategy, scan_config)

        # For multi-page PDFs, expand PDF page numbers to logical page numbers.
        # For regular processors (and test stubs) this is an identity operation.
        expand_fn = getattr(pdf_processor, 'expand_pages', None)
        effective_pages = expand_fn(pages_list) if expand_fn else pages_list

        # Read OCR data using appropriate processor (text files or JSON files)
        raw_data = pdf_processor.read_paragraphs(ocr_dir, effective_pages)

        # Convert metadata dates from DD-MM-YYYY to YYYY-MM-DD for OpenSearch
        # (same logic as used for pravachan dates below)
        metadata = metadata.copy()  # Don't mutate original
        for date_field in ["series_start_date", "series_end_date"]:
            if date_field in metadata and metadata[date_field]:
                try:
                    date_obj = datetime.strptime(metadata[date_field], "%d-%m-%Y")
                    metadata[date_field] = date_obj.strftime("%Y-%m-%d")
                except ValueError:
                    log_handle.warning(
                        f"Invalid date format for metadata.{date_field}: {metadata[date_field]}"
                    )

        language = metadata.get("language", "hi")
        language_meta = get_language_meta(language, scan_config)

        # Create appropriate paragraph generator based on chunk_strategy / ocr_engine
        paragraph_gen = create_paragraph_generator(self._config, language_meta, chunk_strategy, scan_config)

        # Generate paragraphs from raw data
        processed_paras = paragraph_gen.generate_paragraphs(raw_data, scan_config)

        if clean_output_dir and os.path.exists(output_text_dir):
            shutil.rmtree(output_text_dir)
        os.makedirs(output_text_dir, exist_ok=True)

        # Write paragraphs to the text directory
        self._write_paragraphs(output_text_dir, processed_paras, metadata)

        if dry_run:
            log_handle.info(
                f"[DRY RUN] Would index document to OpenSearch and save state for "
                f"{original_filename}"
            )
            return

        timestamp = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
        if reindex_metadata_only:
            self._reindex_metadata_only(document_id, metadata, page_to_pravachan_data, timestamp)
            return

        # --- Full Re-indexing Logic ---
        # Delete existing chunks for this document_id before reindexing.
        # Using document_id (not original_filename) ensures that when a PDF has sub-sections,
        # only the current sub-section's chunks are removed — siblings are left untouched.
        log_handle.info(f"Deleting existing chunks for document_id {document_id} before reindexing")
        try:
            delete_documents_by_document_id(self._config, document_id)
        except Exception as e:
            log_handle.error(f"Failed to delete existing chunks for document_id {document_id}: {e}")
            # Continue with indexing even if deletion fails, as it's a safety measure

        page_mapping = self._load_page_mapping(ocr_dir)
        pages_set = set(effective_pages)
        page_text_paths = []
        for root, _, files in os.walk(output_text_dir):
            for file_name in files:
                if not file_name.lower().endswith(".txt"):
                    continue
                full_path = os.path.join(root, file_name)
                page_num = self._get_page_num(full_path)
                if page_num is not None and page_num in pages_set:
                    page_text_paths.append(full_path)
        page_text_paths = sorted(page_text_paths)
        paras = self._get_paras(page_text_paths)

        chunks = self._create_chunks_from_paras(
            paras, document_id, original_filename, metadata,
            page_to_pravachan_data, timestamp, page_mapping
        )
        log_handle.info(f"Created {len(chunks)} initial chunks for document {document_id}.")

        # 3. Add embeddings in parallel
        chunks_with_embeddings = self._add_embeddings_parallel(chunks)

        # 4. Index chunks into OpenSearch using the bulk helper for efficiency
        self._bulk_index_chunks(chunks_with_embeddings)

        # 5. Update the metadata index with the new metadata
        update_metadata_index(self._config, self._opensearch_client, metadata)
        if metadata.get("category") == "Pravachan":
            refresh_pravachan_series_metadata(self._config, self._opensearch_client)

        log_handle.info(
            f"Finished full indexing for document {document_id}: total_chunks: {len(chunks)}.")


    def _write_paragraphs(self, output_dir, paragraphs, metadata=None):
        page_paras = {}
        for page_num, para in paragraphs:
            if page_num not in page_paras:
                page_paras[page_num] = []
            page_paras[page_num].append(para)

        page_nums = sorted(page_paras.keys())
        for page_num in page_nums:
            para_list = page_paras[page_num]
            fname = f"{output_dir}/page_{page_num:04d}.txt"
            content = "\n----\n".join(para_list)
            try:
                with open(fname, 'w', encoding='utf-8') as fh:
                    fh.write(content)
            except IOError:
                traceback.print_exc()
                log_handle.error(f"Failed to write {fname}")
            if metadata is not None:
                meta_fname = f"{output_dir}/page_{page_num:04d}_meta.json"
                try:
                    with open(meta_fname, 'w', encoding='utf-8') as fh:
                        json.dump({"metadata": metadata, "paragraphs": para_list},
                                  fh, ensure_ascii=False, indent=2)
                except IOError:
                    traceback.print_exc()
                    log_handle.error(f"Failed to write {meta_fname}")

    def _reindex_metadata_only(self, document_id, metadata, page_to_pravachan_data, timestamp):
        """Handles the logic for updating metadata and pravachan fields of existing documents."""
        try:
            query = {"query": {"term": {"document_id": document_id}}, "size": 10000}
            response = self._opensearch_client.search(index=self._index_name, body=query)
            hits = response['hits']['hits']
            log_handle.info(
                f"Found {len(hits)} existing chunks for document {document_id} "
                f"for metadata update."
            )

            update_actions = []
            for hit in hits:
                doc_id = hit['_id']
                page_number = hit['_source'].get('page_number')

                # Get pravachan data for this page
                pravachan_data = page_to_pravachan_data.get(page_number, {})
                pravachan_number = pravachan_data.get('pravachan_no')
                date_str = pravachan_data.get('date')  # Format: DD-MM-YYYY

                # Convert date from DD-MM-YYYY to YYYY-MM-DD for OpenSearch
                date_iso = None
                if date_str:
                    try:
                        date_obj = datetime.strptime(date_str, "%d-%m-%Y")
                        date_iso = date_obj.strftime("%Y-%m-%d")
                    except ValueError:
                        log_handle.warning(f"Invalid date format for page {page_number}: {date_str}")

                action = {
                    "_op_type": "update",
                    "_index": self._index_name,
                    "_id": doc_id,
                    "doc": {
                        "metadata": metadata,
                        "chunk_labels": {
                            "pravachan_number": pravachan_number,
                            "date": date_iso,
                            "gatha": pravachan_data.get('gatha'),
                            "kalash": pravachan_data.get('kalash'),
                            "shlok": pravachan_data.get('shlok'),
                            "doha": pravachan_data.get('doha'),
                            "kavya": pravachan_data.get('kavya'),
                            "sutra": pravachan_data.get('sutra'),
                        },
                        "timestamp_indexed": timestamp
                    }
                }
                update_actions.append(action)

            if update_actions:
                helpers.bulk(self._opensearch_client, update_actions)

            # Also update the dedicated metadata index
            update_metadata_index(self._config, self._opensearch_client, metadata)
            if metadata.get("category") == "Pravachan":
                refresh_pravachan_series_metadata(self._config, self._opensearch_client)

            log_handle.info(f"Metadata and pravachan fields re-indexed for document {document_id}.")
        except Exception as e:
            log_handle.error(f"Error during metadata-only re-indexing for {document_id}: {e}")

    def _create_chunks_from_paras(self, paras, document_id,
                                  original_filename, metadata,
                                  page_to_pravachan_data, timestamp,
                                  page_mapping: dict = None):
        """Converts a list of paragraphs into a list of chunk dictionaries."""
        page_mapping = page_mapping or {}
        chunks = []
        for i, (page_num, para_text) in enumerate(paras):
            chunk_id = f"{document_id}_p{page_num}_para{i}"

            # Get pravachan data for this page
            pravachan_data = page_to_pravachan_data.get(page_num, {})
            pravachan_number = pravachan_data.get('pravachan_no')
            date_str = pravachan_data.get('date')  # Format: DD-MM-YYYY

            # Convert date from DD-MM-YYYY to YYYY-MM-DD for OpenSearch
            date_iso = None
            if date_str:
                try:
                    date_obj = datetime.strptime(date_str, "%d-%m-%Y")
                    date_iso = date_obj.strftime("%Y-%m-%d")
                except ValueError:
                    log_handle.warning(f"Invalid date format for page {page_num}: {date_str}")

            chunk = {
                "chunk_id": chunk_id,
                "document_id": document_id,
                "original_filename": original_filename,
                "page_number": page_num,
                "pdf_page_number": page_mapping.get(str(page_num), page_num),
                "paragraph_id": i,
                "embedding_text": self._prepare_embedding_text(para_text),
                "metadata": metadata,
                "chunk_labels": {
                    "pravachan_number": pravachan_number,
                    "date": date_iso,
                    "gatha": pravachan_data.get('gatha'),
                    "kalash": pravachan_data.get('kalash'),
                    "shlok": pravachan_data.get('shlok'),
                    "doha": pravachan_data.get('doha'),
                    "kavya": pravachan_data.get('kavya'),
                    "sutra": pravachan_data.get('sutra'),
                },
                "timestamp_indexed": timestamp,
            }

            language = metadata.get("language", "hi")
            chunk["language"] = language

            # Default to Hindi for unsupported languages or English text
            lang_key = self._index_keys_per_lang.get(language, self._index_keys_per_lang["hi"])
            chunk[lang_key] = para_text

            chunks.append(chunk)
        return chunks

    def _add_embeddings_parallel(self, all_chunks: list[dict]) -> list[dict]:
        """Adds vector embeddings to chunks using efficient batch processing."""
        if not all_chunks:
            return []

        embedding_model = get_embedding_model_factory(self._config)

        # Extract the text to be embedded from all chunks
        texts_to_embed = [chunk["embedding_text"] for chunk in all_chunks]

        log_handle.info(f"Generating embeddings for {len(texts_to_embed)} chunks in batches...")

        # Generate all embeddings in a single, optimized batch call
        embeddings = embedding_model.get_embeddings_batch(
            texts_to_embed, batch_size=self._config.EMBEDDING_BATCH_SIZE)

        # Assign the generated embeddings back to their corresponding chunks
        for i, chunk in enumerate(all_chunks):
            chunk["vector_embedding"] = embeddings[i]
            del chunk["embedding_text"]  # Save space

        log_handle.info(
            f"Generated embeddings for {len(all_chunks)} chunks using "
            f"{self._config.EMBEDDING_MODEL_TYPE} model."
        )
        return all_chunks

    def _bulk_index_chunks(self, chunks: list[dict]):
        """Indexes a list of chunks into OpenSearch using the bulk API."""
        actions = [
            {
                "_index": self._index_name,
                "_id": chunk["chunk_id"],
                "_source": chunk
            }
            for chunk in chunks
        ]
        try:
            # Use streaming_bulk to get detailed error information
            success_count = 0
            failed_count = 0
            errors = []

            for ok, item in helpers.streaming_bulk(
                self._opensearch_client, actions, raise_on_error=False
            ):
                if ok:
                    success_count += 1
                else:
                    failed_count += 1
                    errors.append(item)
                    # Log EVERY error
                    log_handle.error(f"Failed to index chunk #{failed_count}: {item}")

            log_handle.info(
                f"Successfully indexed {success_count} chunks, failed to index {failed_count} chunks."
            )

            if failed_count > 0:
                log_handle.error(
                    f"FATAL: {failed_count} chunks failed to index. Exiting."
                )
                sys.exit(1)

        except Exception as e:
            log_handle.error(f"An exception occurred during bulk indexing: {e}")
            import traceback
            traceback.print_exc()
            sys.exit(1)

    def _get_paras(self, page_text_paths: list[str]) -> list[tuple[int, str]]:
        """
        Reads all paragraph files and returns a flattened list of (page_number, paragraph_text).
        """
        final_paras = []
        for page_text_path in page_text_paths:
            page_num = self._get_page_num(page_text_path)
            if page_num is None:
                continue

            try:
                with open(page_text_path, 'r', encoding='utf-8') as f:
                    content = f.read()
                    # FIX: Use the correct separator used in pdf_processor.py
                    paras = content.split("\n----\n")
                    for para in paras:
                        if para.strip():
                            final_paras.append((page_num, para.strip()))
            except IOError as e:
                log_handle.error(f"Could not read file {page_text_path}: {e}")
        return final_paras

    def _load_page_mapping(self, ocr_dir: str) -> dict:
        """
        Load page_mapping.json from ocr_dir if present.
        Returns a dict mapping logical page number (str) → PDF page number (int).
        Returns empty dict when absent (regular single-page-per-PDF documents).
        """
        path = os.path.join(ocr_dir, "page_mapping.json")
        if os.path.exists(path):
            try:
                with open(path, "r", encoding="utf-8") as fh:
                    return json.load(fh)
            except (IOError, json.JSONDecodeError) as e:
                log_handle.warning(f"Could not read page mapping {path}: {e}")
        return {}

    def _prepare_embedding_text(self, text: str) -> str:
        """Hook for subclasses to clean text before embedding. No-op by default."""
        return text

    def _get_page_num(self, file_path: str) -> int | None:
        """Extracts the page number from a filename like 'page_0123.txt'."""
        try:
            filename = os.path.basename(file_path)
            page_str = filename.removesuffix('.txt').removeprefix('page_')
            return int(page_str)
        except (ValueError, AttributeError):
            log_handle.warning(f"Could not parse page number from filename: {file_path}")
            return None
