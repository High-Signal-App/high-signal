"""Story clustering pass.

Groups `documents` rows that are part of the same underlying story. Two
edges define "same story":

1. **Shared link target** — both documents have a `links` row pointing at the
   same `to_url`.
2. **Embedding similarity** — cosine similarity above `--threshold` (default
   0.85) between their `documents.embedding` vectors.

A union-find pass merges connected components; the smallest member's
`document.id` becomes the `cluster_id` for every member of the component.
Singletons keep their `cluster_id` equal to their own `id` so feed
collapsing-by-cluster is always well defined.

Idempotent: re-running over the same data converges to the same clusters.
Cheap: O(N) lookups plus an `ivfflat`/HNSW-backed nearest-neighbor probe per
embedded document.

Plan 0007 Digg follow-on.
"""

from __future__ import annotations

import argparse
from collections import defaultdict

from .db import connect

DEFAULT_THRESHOLD = 0.85
DEFAULT_NEIGHBOURS = 6


def _ensure_column(conn) -> None:
    """Make sure `documents.cluster_id` exists. Idempotent."""
    with conn.cursor() as cur:
        cur.execute("ALTER TABLE documents ADD COLUMN IF NOT EXISTS cluster_id BIGINT")
        cur.execute(
            "CREATE INDEX IF NOT EXISTS documents_cluster_idx ON documents (cluster_id)"
        )


class UnionFind:
    def __init__(self) -> None:
        self.parent: dict[int, int] = {}

    def add(self, node: int) -> None:
        self.parent.setdefault(node, node)

    def find(self, node: int) -> int:
        self.add(node)
        path: list[int] = []
        while self.parent[node] != node:
            path.append(node)
            node = self.parent[node]
        for ancestor in path:
            self.parent[ancestor] = node
        return node

    def union(self, a: int, b: int) -> None:
        ra, rb = self.find(a), self.find(b)
        if ra == rb:
            return
        if ra < rb:
            self.parent[rb] = ra
        else:
            self.parent[ra] = rb


def _shared_link_edges(conn) -> list[tuple[int, int]]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT a.from_document_id, b.from_document_id
              FROM links a
              JOIN links b
                ON a.to_url = b.to_url
               AND a.from_document_id < b.from_document_id
             WHERE a.to_url IS NOT NULL
            """
        )
        return [(int(a), int(b)) for a, b in cur.fetchall() or []]


def _embedding_edges(conn, threshold: float, k: int) -> list[tuple[int, int]]:
    edges: list[tuple[int, int]] = []
    with conn.cursor() as cur:
        cur.execute("SELECT id FROM documents WHERE embedding IS NOT NULL ORDER BY id")
        ids = [int(row[0]) for row in cur.fetchall() or []]
        for doc_id in ids:
            cur.execute(
                """
                SELECT other.id, 1 - (other.embedding <=> me.embedding) AS sim
                  FROM documents me
                  JOIN documents other
                    ON other.embedding IS NOT NULL
                   AND other.id <> me.id
                 WHERE me.id = %s
                 ORDER BY me.embedding <=> other.embedding
                 LIMIT %s
                """,
                (doc_id, k),
            )
            for neighbour_id, sim in cur.fetchall() or []:
                if float(sim or 0) >= threshold and doc_id < int(neighbour_id):
                    edges.append((doc_id, int(neighbour_id)))
    return edges


def cluster(
    threshold: float = DEFAULT_THRESHOLD, neighbours: int = DEFAULT_NEIGHBOURS
) -> int:
    """Recompute `cluster_id` for every document. Returns count of clusters."""
    with connect() as conn:
        _ensure_column(conn)

        with conn.cursor() as cur:
            cur.execute("SELECT id FROM documents")
            all_ids = [int(row[0]) for row in cur.fetchall() or []]
        if not all_ids:
            print("cluster: no documents")
            return 0

        uf = UnionFind()
        for node in all_ids:
            uf.add(node)

        for a, b in _shared_link_edges(conn):
            uf.union(a, b)
        for a, b in _embedding_edges(conn, threshold, neighbours):
            uf.union(a, b)

        clusters: dict[int, list[int]] = defaultdict(list)
        for node in all_ids:
            clusters[uf.find(node)].append(node)

        with conn.cursor() as cur:
            for cluster_root, members in clusters.items():
                cur.execute(
                    "UPDATE documents SET cluster_id = %s WHERE id = ANY(%s)",
                    (cluster_root, members),
                )
    print(f"cluster: {len(clusters)} clusters over {len(all_ids)} documents")
    return len(clusters)


def main() -> None:
    parser = argparse.ArgumentParser(description="HighSignal Lab story clustering pass")
    parser.add_argument(
        "--threshold",
        type=float,
        default=DEFAULT_THRESHOLD,
        help="Cosine similarity threshold for embedding-edge merges.",
    )
    parser.add_argument(
        "--neighbours",
        type=int,
        default=DEFAULT_NEIGHBOURS,
        help="K nearest neighbours examined per document.",
    )
    args = parser.parse_args()
    cluster(threshold=args.threshold, neighbours=args.neighbours)


if __name__ == "__main__":
    main()
