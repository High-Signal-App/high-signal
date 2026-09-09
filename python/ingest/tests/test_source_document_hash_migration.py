"""Exercise the observed production index drift with SQLite foreign keys on."""

import sqlite3
from pathlib import Path

import pytest


def test_hash_index_repair_preserves_documents_and_event_references():
    migration = (
        Path(__file__).resolve().parents[3]
        / "packages/db/migrations/0029_source_document_hash_index_repair.sql"
    ).read_text()
    with sqlite3.connect(":memory:") as db:
        db.executescript("""
            PRAGMA foreign_keys = ON;
            CREATE TABLE source_documents (
                id TEXT PRIMARY KEY, document_key TEXT NOT NULL, raw_hash TEXT
            );
            CREATE UNIQUE INDEX source_documents_document_key_idx
                ON source_documents(document_key);
            CREATE UNIQUE INDEX source_documents_raw_hash_idx ON source_documents(raw_hash);
            CREATE TABLE events (source_document_id TEXT REFERENCES source_documents(id));
            INSERT INTO source_documents VALUES ('old', 'ir:msft:old-url', 'same-hash');
            INSERT INTO source_documents VALUES ('redirected', 'ir:msft:new-url', 'older-hash');
            INSERT INTO events VALUES ('old'), ('redirected');
        """)
        upsert = """
            INSERT INTO source_documents VALUES ('new-id', 'ir:msft:new-url', 'same-hash')
            ON CONFLICT(document_key) DO UPDATE SET raw_hash=excluded.raw_hash
            RETURNING id
        """
        with pytest.raises(sqlite3.IntegrityError, match="source_documents.raw_hash"):
            db.execute(upsert)
        db.executescript(migration)
        assert db.execute(upsert).fetchone() == ("redirected",)
        assert db.execute("SELECT count(*) FROM source_documents").fetchone() == (2,)
        assert db.execute("SELECT * FROM events").fetchall() == [("old",), ("redirected",)]
        assert db.execute("PRAGMA foreign_key_check").fetchall() == []
        with pytest.raises(sqlite3.IntegrityError, match="source_documents.document_key"):
            db.execute("INSERT INTO source_documents VALUES ('duplicate', 'ir:msft:new-url', 'x')")
        db.executescript(migration)
        assert db.execute(upsert).fetchone() == ("redirected",)
