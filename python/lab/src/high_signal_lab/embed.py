"""Local sentence-transformer embeddings → pgvector.

Uses `sentence-transformers/all-MiniLM-L6-v2` (384-dim, matches the schema's
`vector(384)` columns). Free, local, CPU-fine. Install with:

    cd python/lab && uv sync --extra embeddings

Idempotent: only embeds rows where `embedding IS NULL` unless `--reindex`.
After embeddings exist, ensures the HNSW index on `documents.embedding` is
present.
"""

from __future__ import annotations

import argparse
import sys

from .db import connect

MODEL_NAME = "sentence-transformers/all-MiniLM-L6-v2"
BATCH = 32


def _load_model():
    try:
        from sentence_transformers import SentenceTransformer  # type: ignore
    except ImportError:
        print(
            "sentence-transformers not installed. Run:\n"
            "    cd python/lab && uv sync --extra embeddings\n",
            file=sys.stderr,
        )
        raise
    return SentenceTransformer(MODEL_NAME)


def _ensure_indexes(conn) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS documents_embedding_idx
            ON documents USING hnsw (embedding vector_cosine_ops)
            """
        )
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS repos_embedding_idx
            ON repos USING hnsw (embedding vector_cosine_ops)
            """
        )


def _vector_literal(vec) -> str:
    # pgvector accepts "[v1,v2,...]" cast to vector.
    return "[" + ",".join(f"{float(x):.6f}" for x in vec) + "]"


def embed_documents(reindex: bool = False, limit: int | None = None) -> int:
    model = _load_model()
    updated = 0
    with connect() as conn:
        with conn.cursor() as cur:
            where = "" if reindex else "WHERE embedding IS NULL"
            limit_clause = f"LIMIT {int(limit)}" if limit else ""
            cur.execute(
                f"""
                SELECT id, COALESCE(short_summary, title, '') || E'\n' ||
                       COALESCE(LEFT(extracted_text, 4000), '')
                FROM documents
                {where}
                ORDER BY discovered_at DESC
                {limit_clause}
                """
            )
            rows = cur.fetchall()
        if not rows:
            print("embed: no rows to process")
            return 0
        for i in range(0, len(rows), BATCH):
            chunk = rows[i : i + BATCH]
            texts = [(r[1] or "").strip() or "(empty)" for r in chunk]
            vectors = model.encode(texts, normalize_embeddings=True).tolist()
            with conn.cursor() as cur:
                for (doc_id, _), vec in zip(chunk, vectors):
                    cur.execute(
                        "UPDATE documents SET embedding = %s::vector WHERE id = %s",
                        (_vector_literal(vec), doc_id),
                    )
            updated += len(chunk)
            print(f"embed: {updated}/{len(rows)}")
        with connect() as idx_conn:
            _ensure_indexes(idx_conn)
    return updated


def embed_repos(reindex: bool = False, limit: int | None = None) -> int:
    model = _load_model()
    updated = 0
    with connect() as conn:
        with conn.cursor() as cur:
            where = "" if reindex else "WHERE embedding IS NULL"
            limit_clause = f"LIMIT {int(limit)}" if limit else ""
            cur.execute(
                f"""
                SELECT id, COALESCE(description, '') || E'\n' || COALESCE(readme_summary, '')
                FROM repos
                {where}
                ORDER BY stars DESC
                {limit_clause}
                """
            )
            rows = cur.fetchall()
        if not rows:
            print("embed: no repo rows to process")
            return 0
        for i in range(0, len(rows), BATCH):
            chunk = rows[i : i + BATCH]
            texts = [(r[1] or "").strip() or "(empty)" for r in chunk]
            vectors = model.encode(texts, normalize_embeddings=True).tolist()
            with conn.cursor() as cur:
                for (repo_id, _), vec in zip(chunk, vectors):
                    cur.execute(
                        "UPDATE repos SET embedding = %s::vector WHERE id = %s",
                        (_vector_literal(vec), repo_id),
                    )
            updated += len(chunk)
            print(f"embed-repos: {updated}/{len(rows)}")
    return updated


def main() -> None:
    parser = argparse.ArgumentParser(description="HighSignal Lab embedding pass")
    parser.add_argument(
        "--target", choices=("documents", "repos", "all"), default="all"
    )
    parser.add_argument(
        "--reindex",
        action="store_true",
        help="Re-embed all rows, not just NULL embeddings.",
    )
    parser.add_argument("--limit", type=int, default=None)
    args = parser.parse_args()

    if args.target in ("documents", "all"):
        embed_documents(reindex=args.reindex, limit=args.limit)
    if args.target in ("repos", "all"):
        embed_repos(reindex=args.reindex, limit=args.limit)


if __name__ == "__main__":
    main()
