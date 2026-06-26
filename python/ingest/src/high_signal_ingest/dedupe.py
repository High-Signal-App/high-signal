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
from urllib.parse import parse_qsl, urlsplit

from .extract.entities import gazetteer_match
from .types import Event
from .utils import event_text, source_family

JACCARD_THRESHOLD = 0.6

# Tracking / analytics query params to drop (they don't identify the resource).
# Everything else is KEPT — for many sites the query *is* the identifier
# (Legistar `?ID=`, `item?id=`), so stripping all query would wrongly collapse
# distinct records into one.
_TRACKING_PARAMS = frozenset(
    {
        "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
        "fbclid", "gclid", "msclkid", "mc_cid", "mc_eid", "ref", "ref_src",
        "ref_url", "source", "cmpid", "igshid", "spm", "_hsenc", "_hsmi",
    }
)

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


def canonical_url(url: str | None) -> str:
    if not url:
        return ""
    try:
        parts = urlsplit(url.strip())
    except ValueError:
        return url.strip().lower()
    host = (parts.hostname or "").removeprefix("www.").lower()
    path = parts.path.rstrip("/").lower()
    # Keep meaningful query params (the query is often the record id), drop only
    # tracking junk; sort for stability.
    kept = sorted(
        (k.lower(), v)
        for k, v in parse_qsl(parts.query, keep_blank_values=False)
        if k.lower() not in _TRACKING_PARAMS
    )
    query = "?" + "&".join(f"{k}={v}" for k, v in kept) if kept else ""
    if not host:
        return url.strip().lower()
    return f"{host}{path}{query}"


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
        return len({source_family(e.source) for e in self.members})

    @property
    def sources(self) -> list[str]:
        return sorted({source_family(e.source) for e in self.members})

    @property
    def links(self) -> list[str]:
        seen: set[str] = set()
        out: list[str] = []
        for e in self.members:
            if e.source_url and e.source_url not in seen:
                seen.add(e.source_url)
                out.append(e.source_url)
        return out


def _rank(ev: Event) -> tuple[int, str]:
    # Higher authority first; tie-break newest.
    ts = ev.published_at.isoformat() if ev.published_at else ""
    return (_SOURCE_RANK.get(source_family(ev.source), 0), ts)


def dedupe(events: list[Event]) -> list[Story]:
    """Collapse duplicate / near-duplicate events into corroborated stories."""
    n = len(events)
    uf = _UnionFind(n)

    urls = [external_url(e) for e in events]
    tokens = [title_tokens(e.title) for e in events]
    days = [e.published_at.date().isoformat() if e.published_at else None for e in events]
    ents = [frozenset(gazetteer_match(event_text(e, 300))) for e in events]

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


def dedupe_exact(events: list[Event]) -> list[Event]:
    """Collapse only events sharing a canonical external URL (true duplicates).

    Unlike :func:`dedupe`, this does NOT merge near-duplicate *different*-URL
    stories — those are kept, because two independent sources covering the same
    thing is cite-or-kill corroboration, not noise. This is the safe variant for
    the ingest write path: it removes the same article re-reported across RSS
    feeds / queries (same URL, different `raw_hash`) without weakening the
    distinct-source evidence behind a signal. Events with no resolvable URL are
    always kept. Order is otherwise preserved (first occurrence wins its slot).
    """
    # Phase 1: pick the highest-authority representative per canonical URL.
    best_by_url: dict[str, Event] = {}
    for ev in events:
        url = external_url(ev)
        if url and (url not in best_by_url or _rank(ev) > _rank(best_by_url[url])):
            best_by_url[url] = ev
    # Phase 2: walk original order, emitting each URL once (no-URL events always
    # kept) — preserves first-seen ordering, swaps in the chosen representative.
    seen: set[str] = set()
    out: list[Event] = []
    for ev in events:
        url = external_url(ev)
        if not url:
            out.append(ev)
        elif url not in seen:
            seen.add(url)
            out.append(best_by_url[url])
    return out
