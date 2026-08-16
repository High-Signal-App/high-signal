"""GLiNER entity extraction over Lab documents.

Plan 0007 acceptance criterion: every ingested document gets tagged with
companies, products, people, etc. GLiNER is the same model the
`python/ingest` pipeline already uses, so this incurs no new model footprint.

Install with:

    cd python/lab && uv sync --extra entities

Idempotent: only processes rows where the document has no `document_entities`
join yet (unless `--reindex`).
"""

from __future__ import annotations

import argparse
import sys
from typing import Iterable

from .db import connect

# GLiNER label set scoped to what's useful for Lab discovery; deliberately a
# small list — wider sets produce noisy false-positives without a tuner.
LABELS: tuple[str, ...] = (
    "company",
    "product",
    "person",
    "technology",
    "research lab",
    "open source project",
)
LABEL_TO_TYPE: dict[str, str] = {
    "company": "company",
    "product": "tool",
    "person": "person",
    "technology": "concept",
    "research lab": "company",
    "open source project": "repo",
}
DEFAULT_MODEL = "urchade/gliner_medium-v2.1"
MIN_TEXT_LEN = 400


def _load_model(name: str):
    try:
        from gliner import GLiNER  # type: ignore
    except ImportError:
        print(
            "gliner not installed. Run:\n"
            "    cd python/lab && uv sync --extra entities\n",
            file=sys.stderr,
        )
        raise
    return GLiNER.from_pretrained(name)


def _candidate_documents(
    conn, reindex: bool, limit: int | None
) -> list[tuple[int, str]]:
    where = (
        ""
        if reindex
        else """
        WHERE NOT EXISTS (
            SELECT 1 FROM document_entities de WHERE de.document_id = d.id
        )
        """
    )
    limit_clause = f"LIMIT {int(limit)}" if limit else ""
    with conn.cursor() as cur:
        cur.execute(
            f"""
            SELECT d.id,
                   COALESCE(d.title, '') || E'\n' || COALESCE(LEFT(d.extracted_text, 8000), '')
            FROM documents d
            {where}
            ORDER BY d.signal_score DESC NULLS LAST, d.discovered_at DESC
            {limit_clause}
            """
        )
        return [(int(row[0]), row[1] or "") for row in cur.fetchall() or []]


def _upsert_entity(conn, name: str, entity_type: str) -> int:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO entities (name, type) VALUES (%s, %s)
            ON CONFLICT (name, type) DO UPDATE SET name = EXCLUDED.name
            RETURNING id
            """,
            (name, entity_type),
        )
        return int(cur.fetchone()[0])


def _link_document_entity(conn, document_id: int, entity_id: int) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO document_entities (document_id, entity_id)
            VALUES (%s, %s)
            ON CONFLICT DO NOTHING
            """,
            (document_id, entity_id),
        )


def _dedupe_entities(spans: Iterable[dict]) -> list[tuple[str, str]]:
    seen: set[tuple[str, str]] = set()
    out: list[tuple[str, str]] = []
    for span in spans:
        raw_label = (span.get("label") or "").strip().lower()
        text = (span.get("text") or "").strip()
        if not text or not raw_label:
            continue
        if len(text) < 2 or len(text) > 80:
            continue
        entity_type = LABEL_TO_TYPE.get(raw_label, "concept")
        key = (text.lower(), entity_type)
        if key in seen:
            continue
        seen.add(key)
        out.append((text, entity_type))
    return out


def extract(
    model_name: str = DEFAULT_MODEL,
    limit: int | None = 100,
    reindex: bool = False,
) -> int:
    model = _load_model(model_name)
    processed = 0
    with connect() as conn:
        rows = _candidate_documents(conn, reindex=reindex, limit=limit)
        if not rows:
            print("entities: no documents need extraction")
            return 0
        for doc_id, text in rows:
            if len(text) < MIN_TEXT_LEN:
                continue
            try:
                spans = model.predict_entities(text, list(LABELS), threshold=0.45)
            except Exception as exc:
                print(f"[entities] doc {doc_id}: {exc}", file=sys.stderr)
                continue
            for name, entity_type in _dedupe_entities(spans):
                entity_id = _upsert_entity(conn, name, entity_type)
                _link_document_entity(conn, doc_id, entity_id)
            processed += 1
            if processed % 10 == 0:
                print(f"entities: {processed}/{len(rows)}")
    print(f"entities: processed {processed} documents")
    return processed


def main() -> None:
    parser = argparse.ArgumentParser(
        description="HighSignal Lab GLiNER entity extraction"
    )
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--limit", type=int, default=100)
    parser.add_argument(
        "--reindex",
        action="store_true",
        help="Re-extract for documents that already have entities.",
    )
    args = parser.parse_args()
    extract(model_name=args.model, limit=args.limit, reindex=args.reindex)


if __name__ == "__main__":
    main()
