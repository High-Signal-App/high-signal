"""Conservative copied-text evidence: can merge origins, never grant independence."""

import re
from urllib.parse import urlparse

from .types import Event


def is_context_only_source(source: str, text: str | None = None, metadata: object = None) -> bool:
    """Source-owned context policy cannot be overridden by a model's proof labels."""
    policy = metadata if isinstance(metadata, dict) else {}
    return (
        source.strip().lower().split(":", 1)[0] == "techmeme"
        or bool(re.match(r"\s*Techmeme permalink:", text or "", re.I))
        or "attention_aggregator" in (policy.get("source_class"), policy.get("sourceClass"))
        or "derived" in (policy.get("evidence_tier"), policy.get("evidenceTier"))
        or "none" in (policy.get("confidence_contribution"), policy.get("confidenceContribution"))
    )


def _shingles(text: str) -> set[tuple[str, ...]]:
    words = re.findall(r"\w+", text.casefold())[:5000]
    return {tuple(words[i : i + 5]) for i in range(len(words) - 4)}


def _credited_publisher(event: Event, *, include_headlines: bool) -> str | None:
    match = re.match(r"\s*\((Bloomberg|Reuters)\)\s*(?:--|—|–)", event.content or "", re.I)
    if match:
        return match.group(1).lower()
    if (
        include_headlines
        and event.source.split(":", 1)[0] == "news"
        and re.search(r":\s*(?:FT|Financial Times)\s*$", event.title or "")
    ):
        return "ft"
    return None


def _original_publisher(event: Event) -> str | None:
    host = (urlparse(event.source_url).hostname or "").lower()
    return next(
        (
            publisher
            for publisher in ("bloomberg", "reuters", "ft")
            if host == f"{publisher}.com" or host.endswith(f".{publisher}.com")
        ),
        None,
    )


def coalesce_copied_origins(
    events: list[Event], origins: list[str], *, include_headline_credits: bool = True
) -> list[str]:
    """Keep model-declared common origins and merge substantially copied articles.

    At least 80 distinct five-word sequences must match and cover 80 percent of
    the shorter text's sequences. This catches reprints with publisher wrappers;
    shared names, short quotations and topic similarity are insufficient.
    Explicit publisher credits also collapse summaries beside their credited outlet,
    even for distinct stories: this is a conservative independence gate, not a
    claim that their texts are identical. No match establishes independence,
    and missing origin IDs stay missing.
    """
    parents = list(range(len(events)))

    def root(i: int) -> int:
        while parents[i] != i:
            i = parents[i]
        return i

    texts = [_shingles(event.content or "") for event in events]
    credits = [
        _credited_publisher(event, include_headlines=include_headline_credits) for event in events
    ]
    publishers = [_original_publisher(event) for event in events]
    for i, origin in enumerate(origins):
        if not origin:
            continue
        for j in range(i):
            if not origins[j]:
                continue
            overlap = len(texts[i] & texts[j])
            shorter = min(len(texts[i]), len(texts[j]))
            copied = overlap >= 80 and overlap >= 0.8 * shorter
            credit_i, credit_j = credits[i], credits[j]
            credited_copy = bool(
                (credit_i and credit_i in (credit_j, publishers[j]))
                or (credit_j and credit_j == publishers[i])
            )
            if origin == origins[j] or copied or credited_copy:
                parents[root(i)] = root(j)
    canonical: dict[int, str] = {}
    for i, origin in enumerate(origins):
        if origin:
            group = root(i)
            canonical[group] = min(canonical.get(group, origin), origin)
    return [canonical[root(i)] if origin else "" for i, origin in enumerate(origins)]


def distinct_generation_events(events: list[Event]) -> list[Event]:
    """Keep the first source per copied-text group, without declaring independence."""
    # A headline credit can rule out independence without proving that two
    # inputs describe the same story. Keep both available to the generator.
    origins = coalesce_copied_origins(
        events, [event.source_url for event in events], include_headline_credits=False
    )
    selected: list[Event] = []
    seen: set[str] = set()
    for event, origin in zip(events, origins):
        if origin not in seen:
            selected.append(event)
            seen.add(origin)
    return selected
