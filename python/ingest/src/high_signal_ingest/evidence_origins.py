"""Conservative copied-text evidence: can merge origins, never grant independence."""

import re

from .types import Event


def _shingles(text: str) -> set[tuple[str, ...]]:
    words = re.findall(r"\w+", text.casefold())[:5000]
    return {tuple(words[i : i + 5]) for i in range(len(words) - 4)}


def coalesce_copied_origins(events: list[Event], origins: list[str]) -> list[str]:
    """Keep model-declared common origins and merge substantially copied articles.

    At least 80 distinct five-word sequences must match and cover 80 percent of
    the shorter text's sequences. This catches reprints with publisher wrappers;
    shared names, short quotations and topic similarity are insufficient.
    No match establishes independence, and missing origin IDs stay missing.
    """
    parents = list(range(len(events)))

    def root(i: int) -> int:
        while parents[i] != i:
            i = parents[i]
        return i

    texts = [_shingles(event.content or "") for event in events]
    for i, origin in enumerate(origins):
        if not origin:
            continue
        for j in range(i):
            if not origins[j]:
                continue
            overlap = len(texts[i] & texts[j])
            shorter = min(len(texts[i]), len(texts[j]))
            copied = overlap >= 80 and overlap >= 0.8 * shorter
            if origin == origins[j] or copied:
                parents[root(i)] = root(j)
    canonical: dict[int, str] = {}
    for i, origin in enumerate(origins):
        if origin:
            group = root(i)
            canonical[group] = min(canonical.get(group, origin), origin)
    return [canonical[root(i)] if origin else "" for i, origin in enumerate(origins)]
