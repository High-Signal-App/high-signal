"""FastAPI server: exposes /feed and /stats over the local Lab Postgres.

The web app's /lab page hits these endpoints directly when LAB_API_URL is set.
"""

from __future__ import annotations

import argparse
from functools import lru_cache
from typing import Any

import uvicorn
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from .db import connect


@lru_cache(maxsize=1)
def _embed_model():
    """Lazy-load the embedding model on first semantic-search request."""
    try:
        from sentence_transformers import SentenceTransformer  # type: ignore
    except ImportError as exc:  # pragma: no cover - import-time guard
        raise HTTPException(
            status_code=503,
            detail="semantic search unavailable: install with `uv sync --extra embeddings`",
        ) from exc
    return SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2")


app = FastAPI(title="HighSignal Lab API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET"],
    allow_headers=["*"],
)


def _row_to_item(row: tuple) -> dict[str, Any]:
    (
        doc_id,
        url,
        source,
        title,
        short_summary,
        published_at,
        signal_score,
        cluster_id,
    ) = row
    return {
        "id": str(doc_id),
        "source": source,
        "title": title or url,
        "url": url,
        "summary": short_summary,
        "publishedAt": published_at.isoformat() if published_at else None,
        "score": float(signal_score or 0),
        "clusterId": str(cluster_id) if cluster_id is not None else None,
    }


@app.get("/feed")
def feed(
    q: str = Query("", description="Postgres FTS query"),
    source: str = Query("", description="Filter by source"),
    limit: int = Query(30, ge=1, le=100),
    by_cluster: bool = Query(
        False,
        description="Collapse to one representative document per cluster (top-scored member).",
    ),
) -> dict[str, Any]:
    where: list[str] = []
    params: list[Any] = []
    if q:
        where.append("tsv @@ websearch_to_tsquery('english', %s)")
        params.append(q)
    if source:
        where.append("source = %s")
        params.append(source)
    clause = ("WHERE " + " AND ".join(where)) if where else ""

    rank_select = (
        "ts_rank(tsv, websearch_to_tsquery('english', %s))" if q else "signal_score"
    )
    rank_params = [q] if q else []

    if by_cluster:
        sql = f"""
            WITH ranked AS (
                SELECT id, url, source, title, short_summary, published_at, signal_score,
                       cluster_id, discovered_at,
                       {rank_select} AS rank_score,
                       ROW_NUMBER() OVER (
                         PARTITION BY COALESCE(cluster_id, id)
                         ORDER BY {rank_select} DESC NULLS LAST, signal_score DESC NULLS LAST
                       ) AS rn
                FROM documents
                {clause}
            )
            SELECT id, url, source, title, short_summary, published_at, signal_score, cluster_id
              FROM ranked
             WHERE rn = 1
             ORDER BY rank_score DESC NULLS LAST, discovered_at DESC
             LIMIT %s
        """
        # SQL placeholders, in order: rank_select #1, rank_select #2, where clause, LIMIT
        exec_params = [*rank_params, *rank_params, *params, limit]
    else:
        sql = f"""
            SELECT id, url, source, title, short_summary, published_at, signal_score, cluster_id
              FROM documents
              {clause}
             ORDER BY {rank_select} DESC NULLS LAST, discovered_at DESC
             LIMIT %s
        """
        # SQL placeholders, in order: where clause, rank_select in ORDER BY, LIMIT
        exec_params = [*params, *rank_params, limit]

    with connect() as conn, conn.cursor() as cur:
        cur.execute(sql, exec_params)
        rows = cur.fetchall() or []
        items = [_row_to_item(r[:8]) for r in rows]

        cur.execute("SELECT COUNT(*) FROM documents")
        documents = int(cur.fetchone()[0] or 0)
        cur.execute("SELECT COUNT(DISTINCT source) FROM documents")
        sources = int(cur.fetchone()[0] or 0)
        cur.execute("SELECT COUNT(*) FROM documents WHERE embedding IS NOT NULL")
        embeddings = int(cur.fetchone()[0] or 0)
        cur.execute(
            """
            SELECT MAX(finished_at) FROM ingest_runs WHERE finished_at IS NOT NULL
            """
        )
        last_ingest = cur.fetchone()[0]

    return {
        "items": items,
        "stats": {
            "documents": documents,
            "sources": sources,
            "embeddings": embeddings,
            "lastIngestAt": last_ingest.isoformat() if last_ingest else None,
        },
    }


@app.get("/search")
def search(
    q: str = Query(..., min_length=2, description="Semantic query"),
    limit: int = Query(20, ge=1, le=100),
) -> dict[str, Any]:
    """Semantic search over `documents.embedding` via pgvector cosine distance."""
    model = _embed_model()
    vector = model.encode([q], normalize_embeddings=True)[0].tolist()
    vec_literal = "[" + ",".join(f"{float(x):.6f}" for x in vector) + "]"

    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, url, source, title, short_summary, published_at, signal_score,
                   1 - (embedding <=> %s::vector) AS similarity
            FROM documents
            WHERE embedding IS NOT NULL
            ORDER BY embedding <=> %s::vector
            LIMIT %s
            """,
            (vec_literal, vec_literal, limit),
        )
        rows = cur.fetchall() or []
    items = []
    for row in rows:
        (
            doc_id,
            url,
            source,
            title,
            short_summary,
            published_at,
            signal_score,
            similarity,
        ) = row
        items.append(
            {
                "id": str(doc_id),
                "source": source,
                "title": title or url,
                "url": url,
                "summary": short_summary,
                "publishedAt": published_at.isoformat() if published_at else None,
                "score": float(signal_score or 0),
                "similarity": float(similarity or 0),
            }
        )
    return {"query": q, "items": items}


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok"}


def main() -> None:
    parser = argparse.ArgumentParser(description="HighSignal Lab API server")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--reload", action="store_true")
    args = parser.parse_args()
    uvicorn.run(
        "high_signal_lab.server:app",
        host=args.host,
        port=args.port,
        reload=args.reload,
    )


if __name__ == "__main__":
    main()
