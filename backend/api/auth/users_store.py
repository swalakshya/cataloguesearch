"""SQLite-backed store for user accounts.

Google login is all that's wired up today; password_hash and mobile_number
are reserved columns for the Phase-2 login methods so no later migration
is needed to add them.
"""
import os
import sqlite3
import time
import uuid
from typing import Any, Dict, Optional


class EmailConflictError(Exception):
    """Raised when an update would assign an email another row already owns."""


class UsersStore:
    def __init__(self, db_path: str):
        self.db_path = str(db_path)
        os.makedirs(os.path.dirname(os.path.abspath(self.db_path)), exist_ok=True)
        self._conn = sqlite3.connect(self.db_path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA journal_mode = WAL")
        self._conn.execute("PRAGMA synchronous = NORMAL")
        self._init_schema()

    def _init_schema(self) -> None:
        self._conn.executescript("""
            CREATE TABLE IF NOT EXISTS users (
                id              TEXT PRIMARY KEY,
                email           TEXT UNIQUE,
                name            TEXT,
                avatar_url      TEXT,
                google_sub      TEXT UNIQUE,
                password_hash   TEXT,
                mobile_number   TEXT UNIQUE,
                created_at      INTEGER NOT NULL,
                last_login_at   INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
            CREATE INDEX IF NOT EXISTS idx_users_google_sub ON users(google_sub);
        """)
        # given_name and settings_json were both added after the table already
        # shipped -- back-fill them on any DB file created before these
        # columns existed, rather than relying on CREATE TABLE IF NOT EXISTS
        # (a no-op against an existing table). Same migration pattern as
        # cataloguesearch-chat's session title column.
        existing_columns = {row["name"] for row in self._conn.execute("PRAGMA table_info(users)")}
        if "given_name" not in existing_columns:
            self._conn.execute("ALTER TABLE users ADD COLUMN given_name TEXT")
        if "settings_json" not in existing_columns:
            self._conn.execute("ALTER TABLE users ADD COLUMN settings_json TEXT")
        self._conn.commit()

    def get_by_id(self, user_id: str) -> Optional[Dict[str, Any]]:
        row = self._conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        return dict(row) if row else None

    def get_by_google_sub(self, google_sub: str) -> Optional[Dict[str, Any]]:
        row = self._conn.execute(
            "SELECT * FROM users WHERE google_sub = ?", (google_sub,)
        ).fetchone()
        return dict(row) if row else None

    def get_by_email(self, email: str) -> Optional[Dict[str, Any]]:
        row = self._conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
        return dict(row) if row else None

    def upsert_google_user(
        self,
        *,
        google_sub: str,
        email: str,
        name: str,
        avatar_url: Optional[str],
        given_name: Optional[str] = None,
    ) -> Dict[str, Any]:
        now = int(time.time())
        existing = self.get_by_google_sub(google_sub) or self.get_by_email(email)

        if existing:
            try:
                self._conn.execute(
                    """
                    UPDATE users
                    SET google_sub = :google_sub, email = :email, name = :name,
                        given_name = :given_name, avatar_url = :avatar_url, last_login_at = :now
                    WHERE id = :id
                    """,
                    {
                        "google_sub": google_sub,
                        "email": email,
                        "name": name,
                        "given_name": given_name,
                        "avatar_url": avatar_url,
                        "now": now,
                        "id": existing["id"],
                    },
                )
            except sqlite3.IntegrityError as exc:
                # google_sub matched an existing row, but the email Google
                # now reports for it is already owned by a *different* row
                # (their Google account's email changed, or a Phase-2
                # password/mobile account already holds it) -- surface a
                # clean, catchable error instead of a raw sqlite exception.
                self._conn.rollback()
                raise EmailConflictError(email) from exc
            self._conn.commit()
            return self.get_by_id(existing["id"])

        user_id = str(uuid.uuid4())
        self._conn.execute(
            """
            INSERT INTO users (id, email, name, given_name, avatar_url, google_sub, created_at, last_login_at)
            VALUES (:id, :email, :name, :given_name, :avatar_url, :google_sub, :now, :now)
            """,
            {
                "id": user_id,
                "email": email,
                "name": name,
                "given_name": given_name,
                "avatar_url": avatar_url,
                "google_sub": google_sub,
                "now": now,
            },
        )
        self._conn.commit()
        return self.get_by_id(user_id)

    def update_settings(self, user_id: str, settings_json: str) -> Optional[Dict[str, Any]]:
        """Overwrite the user's settings_json. Returns the updated row, or
        None if user_id doesn't exist (mirrors get_by_id's None-on-miss,
        rather than raising)."""
        if not self.get_by_id(user_id):
            return None
        self._conn.execute(
            "UPDATE users SET settings_json = ? WHERE id = ?", (settings_json, user_id)
        )
        self._conn.commit()
        return self.get_by_id(user_id)

    def query_count(self) -> int:
        return self._conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]

    def close(self) -> None:
        self._conn.close()
