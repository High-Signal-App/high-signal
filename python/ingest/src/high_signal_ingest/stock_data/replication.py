"""Private durable replication. Public repositories never receive raw-data artifacts."""

from __future__ import annotations

import base64
import hashlib
import json
from dataclasses import asdict
from typing import Iterator

from .models import Entity, Fact, Security, SourceRights
from .store import StockStore

CHUNK_BYTES = 256 * 1024
MAX_RECORDS = 100_000
MAX_TRANSFER_BYTES = 100 * 1024 * 1024


def records(store: StockStore) -> Iterator[dict]:
    for row in store.connection.execute(
        "SELECT kind,version_id,payload FROM identities ORDER BY sequence"
    ):
        yield {"kind": row["kind"], "id": row["version_id"], "payload": json.loads(row["payload"])}
    for row in store.connection.execute(
        "SELECT version_id,payload FROM source_rights ORDER BY sequence"
    ):
        yield {"kind": "rights", "id": row["version_id"], "payload": json.loads(row["payload"])}
    for row in store.connection.execute("SELECT * FROM evidence ORDER BY rowid"):
        chunks = []
        body = bytes(row["body"])
        for offset in range(0, len(body), CHUNK_BYTES):
            part = body[offset : offset + CHUNK_BYTES]
            identity = f"blob:{hashlib.sha256(part).hexdigest()}"
            chunks.append(identity)
            yield {
                "kind": "blob",
                "id": identity,
                "payload": {"base64": base64.b64encode(part).decode()},
            }
        metadata = asdict(store.evidence(row["id"]))
        yield {
            "kind": "evidence",
            "id": row["id"],
            "payload": {**metadata, "body_chunk_ids": chunks},
        }
    for row in store.connection.execute("SELECT id,payload FROM facts ORDER BY rowid"):
        yield {"kind": "fact", "id": row["id"], "payload": json.loads(row["payload"])}
    for row in store.connection.execute("SELECT id,payload FROM snapshots ORDER BY rowid"):
        yield {"kind": "snapshot", "id": row["id"], "payload": json.loads(row["payload"])}


def import_record(store: StockStore, record: dict) -> None:
    with store.transaction():
        _import_record(store, record)


def _import_record(store: StockStore, record: dict) -> None:
    kind, identity, value = record["kind"], record["id"], record["payload"]
    if kind == "blob":
        body = base64.b64decode(value["base64"], validate=True)
        if identity != f"blob:{hashlib.sha256(body).hexdigest()}":
            raise ValueError("replicated evidence chunk failed its content hash")
        store.connection.execute(
            "INSERT OR IGNORE INTO replication_chunks VALUES(?,?)", (identity, body)
        )
        return
    if kind == "entity":
        result = store.put_entity(Entity(**value))
    elif kind == "security":
        result = store.put_security(Security(**value))
    elif kind == "rights":
        rights = SourceRights(**value)
        existing = store.connection.execute(
            "SELECT 1 FROM source_rights WHERE version_id=?", (rights.version_id,)
        ).fetchone()
        result = rights.version_id if existing else store.put_rights(rights)
    elif kind == "evidence":
        parts = []
        for chunk in value["body_chunk_ids"]:
            row = store.connection.execute(
                "SELECT body FROM replication_chunks WHERE id=?", (chunk,)
            ).fetchone()
            if row is None:
                raise ValueError("replicated evidence chunk is missing")
            parts.append(bytes(row["body"]))
        body = b"".join(parts)
        if hashlib.sha256(body).hexdigest() != value["sha256"]:
            raise ValueError("replicated evidence failed its original hash")
        result = store.retain_evidence(
            **{
                k: value[k]
                for k in ("source_id", "url", "available_at", "ingested_at", "media_type")
            },
            body=body,
        ).id
    elif kind == "fact":
        result = store.put_fact(Fact(**value))
    elif kind == "snapshot":
        result = store.save_snapshot(value)
    else:
        raise ValueError("unknown replicated record kind")
    if result != identity:
        raise ValueError("replicated record identity does not match its content")


def restore(store: StockStore, client) -> set[str]:
    store.connection.execute(
        "CREATE TEMP TABLE IF NOT EXISTS replication_chunks(id TEXT PRIMARY KEY,body BLOB NOT NULL)"
    )
    cursor = 0
    identities: set[str] = set()
    transferred = 0
    while True:
        response = client.get(f"/admin/stock-data/records?after={cursor}")
        response.raise_for_status()
        batch = response.json()
        if not batch["records"]:
            return identities
        transferred += len(json.dumps(batch).encode())
        if (
            len(identities) + len(batch["records"]) > MAX_RECORDS
            or transferred > MAX_TRANSFER_BYTES
        ):
            raise ValueError("Private restore exceeds the qualified pilot transfer budget")
        with store.transaction():
            for record in batch["records"]:
                import_record(store, record)
                identities.add(record["id"])
        if batch["cursor"] <= cursor:
            raise ValueError("private stock history cursor failed to advance")
        cursor = batch["cursor"]


def replicate(store: StockStore, client, known: set[str]) -> int:
    pending, transferred = 0, 0
    for record in records(store):
        if record["id"] not in known:
            pending += 1
            transferred += len(json.dumps(record, ensure_ascii=False).encode())
            if pending > MAX_RECORDS or transferred > MAX_TRANSFER_BYTES:
                raise ValueError("Private replication exceeds the qualified pilot transfer budget")
    count, batch, size = 0, [], 0

    def send() -> None:
        nonlocal count, batch, size
        if not batch:
            return
        response = client.post("/admin/stock-data/records", json={"records": batch})
        response.raise_for_status()
        if response.json().get("accepted") != [r["id"] for r in batch]:
            raise ValueError("private stock history write was not fully acknowledged")
        known.update(r["id"] for r in batch)
        count += len(batch)
        batch, size = [], 0

    for record in records(store):
        if record["id"] in known:
            continue
        length = len(json.dumps(record, ensure_ascii=False).encode())
        if batch and (size + length > 900_000 or len(batch) >= 500):
            send()
        batch.append(record)
        size += length
    send()
    return count
