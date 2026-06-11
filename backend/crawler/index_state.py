import sqlite3
import logging
import os
import json
import hashlib
from datetime import datetime

from backend.utils import json_dumps

log_handle = logging.getLogger(__name__)

class IndexState:
    def __init__(self, state_db_path: str):
        self.state_db_path = state_db_path
        self._init()

    def _init(self):
        """Initializes the SQLite DB and creates the state table if needed."""
        conn = sqlite3.connect(self.state_db_path)
        c = conn.cursor()
        c.execute("""
            CREATE TABLE IF NOT EXISTS indexed_files_state (
                document_id TEXT PRIMARY KEY,
                file_path TEXT,
                last_indexed_timestamp TEXT,
                file_checksum TEXT,
                config_hash TEXT,
                index_checksum TEXT,
                ocr_checksum TEXT,
                parsed_bookmarks TEXT
            )
        """)
        c.execute("""
            CREATE TABLE IF NOT EXISTS metadata_cache (
                metadata_key TEXT PRIMARY KEY,
                metadata_values TEXT,
                last_updated_timestamp TEXT
            )
        """)
        conn.commit()
        conn.close()

    def load_state(self) -> dict:
        """Loads the indexed state from the SQLite DB."""
        conn = sqlite3.connect(self.state_db_path)
        c = conn.cursor()
        c.execute(
            "SELECT document_id, file_path, last_indexed_timestamp, file_checksum, "
            "config_hash, index_checksum, ocr_checksum, parsed_bookmarks FROM indexed_files_state"
        )
        rows = c.fetchall()
        conn.close()
        state = {}
        for row in rows:
            state[row[0]] = {
                "file_path": row[1],
                "last_indexed_timestamp": row[2],
                "file_checksum": row[3],
                "config_hash": row[4],
                "index_checksum": row[5],
                "ocr_checksum": row[6] if len(row) > 6 else None,
                "parsed_bookmarks": row[7] if len(row) > 7 else None
            }
        return state

    def get_state(self, document_id: str) -> dict:
        """
        Retrieves the state of a document by its ID.
        Returns a dictionary with file_path, last_indexed_timestamp, file_checksum, and config_hash.
        If the document is not found, returns an empty dictionary.
        """
        conn = sqlite3.connect(self.state_db_path)
        c = conn.cursor()
        sql_query = """
            SELECT document_id, file_path, last_indexed_timestamp, file_checksum, config_hash, index_checksum, ocr_checksum, parsed_bookmarks
            FROM indexed_files_state WHERE document_id = ?
        """
        c.execute(sql_query, (document_id,))
        row = c.fetchone()
        conn.close()
        if row:
            return {
                "file_path": row[1],
                "last_indexed_timestamp": row[2],
                "file_checksum": row[3],
                "config_hash": row[4],
                "index_checksum": row[5],
                "ocr_checksum": row[6] if len(row) > 6 else None,
                "parsed_bookmarks": row[7] if len(row) > 7 else None
            }
        return {}

    def update_state(self, document_id: str, state: dict):
        """Inserts or updates a document's state in the DB."""
        conn = sqlite3.connect(self.state_db_path)
        c = conn.cursor()
        log_state = {**state}
        if "parsed_bookmarks" in log_state and log_state["parsed_bookmarks"]:
            import json as _json
            bookmarks = _json.loads(log_state["parsed_bookmarks"]) if isinstance(log_state["parsed_bookmarks"], str) else log_state["parsed_bookmarks"]
            log_state["parsed_bookmarks"] = f"<{len(bookmarks)} bookmarks>"
        log_handle.info(f"Storing state: {json_dumps(log_state)}")
        c.execute("""
            INSERT INTO indexed_files_state (document_id, file_path, last_indexed_timestamp, file_checksum, config_hash, index_checksum, ocr_checksum, parsed_bookmarks)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(document_id) DO UPDATE SET
                file_path=excluded.file_path,
                last_indexed_timestamp=excluded.last_indexed_timestamp,
                file_checksum=excluded.file_checksum,
                config_hash=excluded.config_hash,
                index_checksum=excluded.index_checksum,
                ocr_checksum=excluded.ocr_checksum,
                parsed_bookmarks=excluded.parsed_bookmarks
        """, (
            document_id,
            state.get("file_path"),
            state.get("last_indexed_timestamp"),
            state.get("file_checksum"),
            state.get("config_hash"),
            state.get("index_checksum", ""),
            state.get("ocr_checksum", ""),
            state.get("parsed_bookmarks")
        ))
        conn.commit()
        conn.close()

    def delete_state(self, document_id: str):
        """Deletes a document's state from the DB."""
        conn = sqlite3.connect(self.state_db_path)
        c = conn.cursor()
        c.execute("DELETE FROM indexed_files_state WHERE document_id = ?", (document_id,))
        conn.commit()
        conn.close()

    def garbage_collect(self, base_dir):
        """
        Deletes all the document_ids which no longer have files
        that exist in the filesystem.
        :return: [str] List of file paths that were deleted from the state.
        """

        conn = sqlite3.connect(self.state_db_path)
        c = conn.cursor()
        c.execute("SELECT document_id, file_path FROM indexed_files_state")
        rows = c.fetchall()
        deleted_files = []

        for row in rows:
            document_id, file_path = row
            # Sub-section states store file_path as "relative/path.pdf#field:name".
            # Strip the suffix to get the actual file path for existence check.
            actual_file_path = file_path.split('#')[0] if file_path and '#' in file_path else file_path
            if not os.path.exists(os.path.join(base_dir, actual_file_path)):
                c.execute("DELETE FROM indexed_files_state WHERE document_id = ?", (document_id,))
                deleted_files.append(file_path)

        conn.commit()
        conn.close()
        log_handle.info(f"Garbage Collect: Deleted {deleted_files} files from state.")
        return deleted_files

    def calculate_ocr_checksum(self, relative_file_path: str, ocr_pages: list[int]) -> str:
        """
        Calculates OCR checksum based on relative file path and list of pages OCRed.

        Args:
            relative_file_path: Relative path of the PDF file
            ocr_pages: List of page numbers that were OCRed

        Returns:
            String representing OCR checksum based on file path and pages
        """

        # Validate inputs
        if not relative_file_path:
            return ""

        if not isinstance(ocr_pages, list):
            return ""

        # Validate that all pages are positive integers
        valid_pages = []
        for page in ocr_pages:
            if isinstance(page, int) and page > 0:
                valid_pages.append(page)
            else:
                log_handle.warning(f"Invalid page number {page} in OCR pages list")

        if not valid_pages:
            return ""

        # Create checksum from relative path and sorted pages
        pages_str = ",".join(map(str, sorted(valid_pages)))
        checksum_input = f"{relative_file_path}:{pages_str}"

        return hashlib.sha256(checksum_input.encode('utf-8')).hexdigest()

    def invalidate_state(self, relative_file_path: str, crawl: bool = False, index: bool = False):
        """
        NULL out checksums for a file and all its sub-sections to force re-processing.

        crawl=True  → clears ocr_checksum  (forces re-crawl)
        index=True  → clears config_hash   (forces re-index)
        """
        fields = []
        if crawl:
            fields.append("ocr_checksum = NULL")
        if index:
            fields.append("config_hash = NULL")
        if not fields:
            return

        escaped = relative_file_path.replace('%', r'\%').replace('_', r'\_')
        conn = sqlite3.connect(self.state_db_path)
        c = conn.cursor()
        c.execute(
            f"UPDATE indexed_files_state SET {', '.join(fields)} "
            f"WHERE file_path = ? OR file_path LIKE ? ESCAPE '\\'",
            (relative_file_path, escaped + '#%')
        )
        affected = c.rowcount
        conn.commit()
        conn.close()
        log_handle.info(f"Invalidated state for '{relative_file_path}' "
                        f"(+sub-sections): {affected} row(s) affected. "
                        f"Fields cleared: {', '.join(fields)}")

    def invalidate_all_states(self, crawl: bool = False, index: bool = False):
        """
        NULL out checksums for every entry in the state DB.

        crawl=True  → clears ocr_checksum  (forces re-crawl of everything)
        index=True  → clears config_hash   (forces re-index of everything)
        """
        fields = []
        if crawl:
            fields.append("ocr_checksum = NULL")
        if index:
            fields.append("config_hash = NULL")
        if not fields:
            return

        conn = sqlite3.connect(self.state_db_path)
        c = conn.cursor()
        c.execute(f"UPDATE indexed_files_state SET {', '.join(fields)}")
        affected = c.rowcount
        conn.commit()
        conn.close()
        log_handle.info(f"Invalidated all states: {affected} row(s) affected. "
                        f"Fields cleared: {', '.join(fields)}")

    def get_files_without_bookmarks(self) -> list[str]:
        """
        Returns a list of file_path values from the DB where parsed_bookmarks
        is NULL or an empty JSON array.
        """
        conn = sqlite3.connect(self.state_db_path)
        c = conn.cursor()
        c.execute(
            "SELECT file_path FROM indexed_files_state "
            "WHERE parsed_bookmarks IS NULL OR parsed_bookmarks = '[]'"
        )
        rows = c.fetchall()
        conn.close()
        return [row[0] for row in rows if row[0]]

    def update_parsed_bookmarks(self, document_id: str, bookmarks: list) -> bool:
        """
        Updates only the parsed_bookmarks column for a given document_id.
        Does not touch any other column (config_hash, ocr_checksum, etc.).

        Args:
            document_id: The document's UUID
            bookmarks: List of parsed bookmark dicts to store

        Returns:
            True if a row was updated, False if document_id not found.
        """
        conn = sqlite3.connect(self.state_db_path)
        c = conn.cursor()
        c.execute(
            "UPDATE indexed_files_state SET parsed_bookmarks = ? WHERE document_id = ?",
            (json.dumps(bookmarks, ensure_ascii=False), document_id)
        )
        updated = c.rowcount > 0
        conn.commit()
        conn.close()
        if updated:
            log_handle.info(f"update_parsed_bookmarks: saved {len(bookmarks)} bookmark(s) for {document_id}")
        else:
            log_handle.warning(f"update_parsed_bookmarks: document_id {document_id} not found in DB")
        return updated

    def delete_index_state(self):
        """
        Deletes the entire index state from the SQLite DB.
        This is a destructive operation and should be used with caution.
        """
        conn = sqlite3.connect(self.state_db_path)
        c = conn.cursor()
        c.execute("DELETE FROM indexed_files_state")
        c.execute("DELETE FROM metadata_cache")
        conn.commit()
        conn.close()
        log_handle.info("Deleted all index state and metadata cache.")
