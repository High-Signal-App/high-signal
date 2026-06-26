"""Deterministic cross-source de-duplication — no RAG / no embeddings.

The same real-world story surfaces from many sources (HN + Reddit + Techmeme +
a news article all linking one URL; a court case from two queries; an entity
event reported twice). We collapse those into one **story** so the operator
sees it once — but we **keep the distinct-source count**, because corroboration
across independent sources is the cite-or-kill signal, not noise to discard.

Two deterministic merge signals (union-find over both):
  1. **Shared canonical URL** — the external link an item points at, normalised
     (scheme/www/query/fragment/trailing-slash stripped). HN/Reddit link posts
     and the news article about the same thing collapse together.
  2. **Title token overlap** — Jaccard ≥ threshold on normalised title tokens,
     guarded by same-day OR a shared tracked entity (so unrelated items sharing
     generic words don't merge).

No vectors, no model — pure string/set ops.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from urllib.parse import urlsplit

from .extract.entities import gazetteer_match
from .types import Event

JACCARD_THRESHOLD = 0.6

# Source-prefix noise to strip before tokenising titles ("HN: ", "arXiv: ",
# "Stack Overflow [pytorch]: ", "Court opinion: ", "Phoenix AZ — Council: ").
_PREFIX_RE = re.compile(r"^([A-Za-z .]+(\[[^\]]*\])?\s*[—:]\s*)+")
_STOP = {
    "the", "a", "an", "to", "of", "for", "and", "or", "in", "on", "with", "at",
    "by", "is", "are", "new", "how", "why", "what", "from", "this", "that",
}
# Authority rank for choosing the representative item of a cluster.
_SOURCE_RANK = {
    "edgar": 9, "sec-xbrl": 9, "ir": 9, "hkex": 9, "courtlistener": 8,
    "legistar": 8, "openstates": 8, "regulations": 8, "gov": 8, "gov-contracts": 8,
    "cisa-kev": 7, "eia": 7, "news": 6, "guardian": 6, "techmeme": 6, "gdelt": 5,
}


def _family(source: str) -> str:
    return (source or "").split(":", 1)[0]


def canonical_url(url: str | None) -> str:
    if not url:
        return ""
    try:
        parts = urlsplit(url.strip())
    except ValueError:
        return url.strip().lower()
    host = (parts.hostname or "").removeprefix("www.").lower()
    path = parts.path.rstrip("/").lower()
    return f"{host}{path}" if host else url.strip().lower()


_LINK_RE = re.compile(r"Link:\s*(https?://\S+)", re.IGNORECASE)


def external_url(ev: Event) -> str:
    """The link the item is *about* — the embedded external link if present
    (e.g. HN stores the article URL in content), else the source_url."""
    if ev.content:
        m = _LINK_RE.search(ev.content)
        if m:
            return canonical_url(m.group(1))
    return canonical_url(ev.source_url)


def title_tokens(title: str | None) -> frozenset[str]:
    if not title:
        return frozenset()
    stripped = _PREFIX_RE.sub("", title)
    words = re.findall(r"[a-z0-9]+", stripped.lower())
    return frozenset(w for w in words if w not in _STOP and len(w) > 2)


def jaccard(a: frozenset[str], b: frozenset[str]) -> float:
    if not a or not b:
        return 0.0
    inter = len(a & b)
    return inter / len(a | b) if inter else 0.0


class _UnionFind:
    def __init__(self, n: int) -> None:
        self.parent = list(range(n))

    def find(self, x: int) -> int:
        while self.parent[x] != x:
            self.parent[x] = self.parent[self.parent[x]]
            x = self.parent[x]
        return x

    def union(self, a: int, b: int) -> None:
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            self.parent[rb] = ra


@dataclass
class Story:
    representative: Event
    members: list[Event] = field(default_factory=list)

    @property
    def distinct_sources(self) -> int:
        return len({_family(e.source) for e in self.members})

    @property
    def sources(self) -> list[str]:
        return sorted({_family(e.source) for e in self.members})

    @property
    def links(self) -> list[str]:
        seen: list[str] = []
        for e in self.members:
            if e.source_url and e.source_url not in seen:
                seen.append(e.source_url)
        return seen


def _rank(ev: Event) -> tuple[int, str]:
    # Higher authority first; tie-break newest.
    ts = ev.published_at.isoformat() if ev.published_at else ""
    return (_SOURCE_RANK.get(_family(ev.source), 0), ts)


def dedupe(events: list[Event]) -> list[Story]:
    """Collapse duplicate / near-duplicate events into corroborated stories."""
    n = len(events)
    uf = _UnionFind(n)

    urls = [external_url(e) for e in events]
    tokens = [title_tokens(e.title) for e in events]
    days = [e.published_at.date().isoformat() if e.published_at else None for e in events]
    ents = [frozenset(gazetteer_match(f"{e.title or ''}\n{(e.content or '')[:300]}")) for e in events]

    # 1) Shared canonical URL — strongest signal. Bucket by URL.
    by_url: dict[str, list[int]] = {}
    for i, u in enumerate(urls):
        if u:
            by_url.setdefault(u, []).append(i)
    for idxs in by_url.values():
        for j in idxs[1:]:
            uf.union(idxs[0], j)

    # 2) Title token overlap, guarded by same-day OR shared entity.
    for i in range(n):
        if not tokens[i]:
            continue
        for j in range(i + 1, n):
            if uf.find(i) == uf.find(j) or not tokens[j]:
                continue
            guard = (days[i] is not None and days[i] == days[j]) or bool(ents[i] & ents[j])
            if guard and jaccard(tokens[i], tokens[j]) >= JACCARD_THRESHOLD:
                uf.union(i, j)

    groups: dict[int, list[Event]] = {}
    for i, ev in enumerate(events):
        groups.setdefault(uf.find(i), []).append(ev)

    stories: list[Story] = []
    for members in groups.values():
        rep = max(members, key=_rank)
        stories.append(Story(representative=rep, members=members))
    stories.sort(key=lambda s: (s.distinct_sources, len(s.members)), reverse=True)
    return stories


def dedupe_events(events: list[Event]) -> list[Event]:
    """Convenience: one representative Event per story (duplicates removed)."""
    return [s.representative for s in dedupe(events)]
