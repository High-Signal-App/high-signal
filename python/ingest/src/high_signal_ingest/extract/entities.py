"""Entity extraction — gazetteer-first, GLiNER for novel mentions."""

from __future__ import annotations

import re
from functools import lru_cache
from typing import Iterable

from ..seed import entity_gazetteer, load_entities


@lru_cache(maxsize=1)
def _gazetteer() -> dict[str, str]:
    return entity_gazetteer(load_entities())


# Tickers/aliases that are also common English words. Matching these
# case-insensitively pollutes the entity map across every text source
# ("net income" → Cloudflare, "meta-learning" → Meta, "onto" → Onto Innovation).
# For these terms we match ONLY the uppercase ticker or a ``$TICKER`` form (the
# unambiguous company reference); the lowercase word is ignored. Each of these
# entities still matches via its distinctive full name / alias (Cloudflare,
# Snowflake, FormFactor, Onto Innovation, Arm Holdings, Meta Platforms/Facebook).
_COMMON_WORD_TICKERS = frozenset({"net", "onto", "form", "snow", "arm", "meta"})


@lru_cache(maxsize=1)
def _compiled_patterns() -> list[tuple[re.Pattern[str], str, bool]]:
    """Pre-compile ``(?<!\\w)TERM(?!\\w)`` patterns per gazetteer entry.

    Lookaround boundaries (not ``\\b``) so terms that start with non-word
    characters still match: ``\\b\\^gspc\\b`` would fail because there's no
    word-to-nonword transition before ``^``. The lookaround form just asks
    "no word char on either side," which works for ``^GSPC``, ``$ASML``,
    ``BRK-B``, ``ASML.``, and plain ``NVDA`` alike.

    Each entry is ``(pattern, entity_id, case_sensitive)``. Common-word tickers
    compile a case-sensitive ``$?TICKER`` pattern run against the original text;
    everything else matches case-insensitively against the lowercased text.
    """
    out: list[tuple[re.Pattern[str], str, bool]] = []
    for term, eid in _gazetteer().items():
        if len(term) < 3:
            continue
        if term in _COMMON_WORD_TICKERS:
            out.append(
                (re.compile(rf"(?<![\w$])\$?{re.escape(term.upper())}(?!\w)"), eid, True)
            )
        else:
            out.append((re.compile(rf"(?<!\w){re.escape(term)}(?!\w)"), eid, False))
    return out


def gazetteer_match(text: str) -> list[str]:
    """Cheap deterministic match against known entities. Returns entity IDs."""
    if not text:
        return []
    needle = text.lower()
    hits: set[str] = set()
    for pattern, eid, case_sensitive in _compiled_patterns():
        if pattern.search(text if case_sensitive else needle):
            hits.add(eid)
    return sorted(hits)


def gliner_extract(text: str, threshold: float = 0.55) -> list[dict]:
    """GLiNER zero-shot NER for company/product/person mentions.

    Returns list of {text, label, score, start, end}. Lazy-imports GLiNER.
    """
    model = _load_gliner()
    if model is None:
        return []
    labels = ["company", "product", "person", "technology", "country", "regulator"]
    return model.predict_entities(text[:8000], labels, threshold=threshold)


@lru_cache(maxsize=1)
def _load_gliner():
    try:
        from gliner import GLiNER  # type: ignore

        return GLiNER.from_pretrained("urchade/gliner_medium-v2.1")
    except Exception:
        return None


# Attribution strength knobs. A tracked entity mentioned once, incidentally,
# outside the title is too weak to attribute an entire event to it — that is how
# a Rust crate whose description references "Google's SwissTable" got filed under
# Alphabet, and an Economic Times markets page (with an unrelated ticker in a
# "top movers" widget) got filed under that ticker. Require the winner to appear
# in the title, or at least twice in the lead body.
_TITLE_WEIGHT = 4
_MIN_PRIMARY_SCORE = 2


def entity_scores(text: str, title: str | None = None) -> dict[str, int]:
    """Weighted mention count per tracked entity. Title matches count
    ``_TITLE_WEIGHT`` each, body matches 1 each. Reuses the compiled gazetteer,
    so common-word-ticker guards apply here too."""
    if not text and not title:
        return {}
    body_cs = text or ""
    body_ci = body_cs.lower()
    title_cs = title or ""
    title_ci = title_cs.lower()
    scores: dict[str, int] = {}
    for pattern, eid, case_sensitive in _compiled_patterns():
        body_hits = len(pattern.findall(body_cs if case_sensitive else body_ci))
        title_hits = len(pattern.findall(title_cs if case_sensitive else title_ci))
        total = body_hits + title_hits * _TITLE_WEIGHT
        if total:
            scores[eid] = scores.get(eid, 0) + total
    return scores


def primary_entity(
    text: str,
    candidates: Iterable[str] | None = None,
    *,
    title: str | None = None,
    min_score: int = _MIN_PRIMARY_SCORE,
) -> str | None:
    """Pick the most-mentioned tracked entity, title-weighted. Returns None when
    the strongest match is only an incidental single body mention (below
    ``min_score``) so weak references don't misattribute the whole event."""
    scores = entity_scores(text, title=title)
    if not scores:
        return None
    if candidates:
        cand_set = set(candidates)
        scoped = {e: s for e, s in scores.items() if e in cand_set}
        if scoped:
            scores = scoped
    # Highest score wins; deterministic tie-break by entity id (max keeps the
    # first item of the alphabetically-sorted keys among equal scores).
    best = max(sorted(scores), key=lambda e: scores[e])
    return best if scores[best] >= min_score else None


def event_entity_ids(title: str | None, content: str | None, lead_chars: int = 800) -> set[str]:
    """Tracked entities named in an event's title + lead body (not the full
    body, which drags in navigation/related-article/ticker-tape noise)."""
    return set(gazetteer_match(f"{title or ''}\n{(content or '')[:lead_chars]}"))


def event_supports_entity(
    entity_id: str,
    title: str | None,
    content: str | None,
    spillover: Iterable[str] = (),
    lead_chars: int = 800,
) -> bool:
    """Conservative evidence-relevance gate: keep an event as evidence for a
    signal about ``entity_id`` unless its title+lead names *other* tracked
    entities and neither the subject nor a spillover candidate. Events that name
    no tracked entity up top (e.g. a bare filing title) get the benefit of the
    doubt and are kept."""
    ids = event_entity_ids(title, content, lead_chars)
    if not ids:
        return True
    if entity_id in ids:
        return True
    return any(s in ids for s in spillover)
