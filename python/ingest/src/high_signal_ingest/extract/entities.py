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


def primary_entity(text: str, candidates: Iterable[str] | None = None) -> str | None:
    """Pick the most-mentioned tracked entity in `text`."""
    hits = gazetteer_match(text)
    if not hits:
        return None
    if candidates:
        cand_set = set(candidates)
        scoped = [h for h in hits if h in cand_set]
        if scoped:
            return scoped[0]
    return hits[0]
