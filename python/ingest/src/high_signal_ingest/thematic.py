"""Conservative named-event discovery for data-center review drafts.

Theme membership is not corroboration. These anchors only nominate a story for
review; final source alignment and independent-origin gates still apply.
Unknown names/locations remain research inputs rather than invented theses.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from .dedupe import dedupe_exact
from .types import Event

_FACILITY = re.compile(r"((?:\b[A-Za-z][\w'-]*\s+){1,5})data[ -]?cent(?:er|re)\b", re.I)
_LOCATION = re.compile(r"\b(?:in|near)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)")
_SITE = re.compile(r"\b(?:site|campus|phase)\s*(?:#\s*)?(\d+)\b", re.I)
_GENERIC = frozenset(
    "council city county new proposed planned approves approved approval plans "
    "build building for the a an expansion hyperscale its at of construction".split()
)
_ACTIONS = [
    ("appeal", re.compile(r"\b(?:appeal\w*|lawsuit|challenge\w*)\b", re.I)),
    ("approval", re.compile(r"\b(?:approv\w*|permit granted)\b", re.I)),
    ("lease", re.compile(r"\b(?:lease\w*|leases|leased)\b", re.I)),
    ("construction", re.compile(r"\b(?:construction|groundbreaking|breaks ground)\b", re.I)),
    ("planning", re.compile(r"\b(?:plan\w*|propos\w*|rezon\w*|application)\b", re.I)),
]


@dataclass(frozen=True)
class _Anchor:
    project: str
    location: str
    site: str | None
    action: str


def is_buildout_topic(text: str) -> bool:
    return bool(re.search(r"\bdata[ -]?cent(?:er|re)\b", text, re.I)) and any(
        pattern.search(text) for _, pattern in _ACTIONS
    )


def _anchor(event: Event) -> _Anchor | None:
    # Headlines identify the asserted event. Body boilerplate cannot turn an
    # unrelated technology headline into a buildout claim.
    title = event.title or ""
    facility = _FACILITY.search(title)
    location = _LOCATION.search(title)
    if not facility or not location:
        return None
    names = [
        word.removesuffix("'s").lower()
        for word in facility[1].split()
        if word[0].isupper() and word.lower() not in _GENERIC
    ]
    if not names:
        return None
    action = next((label for label, pattern in _ACTIONS if pattern.search(title)), None)
    if not action:
        return None
    site = _SITE.search(title)
    return _Anchor(" ".join(names), location[1].lower(), site[1] if site else None, action)


def buildout_stories(events: list[Event]) -> list[list[Event]]:
    """Group compatible explicit project/location/action anchors within 72h.

    Complete-link comparison prevents a title omitting its site number from
    bridging two explicitly different sites. Independently worded headlines can
    share anchors without requiring identical title tokens or same-day timing.
    """
    groups: list[list[tuple[Event, _Anchor]]] = []
    for event in dedupe_exact(events):
        anchor = _anchor(event)
        if not anchor:
            continue
        for group in groups:
            if all(
                anchor.project == other.project
                and anchor.location == other.location
                and anchor.action == other.action
                and not (anchor.site and other.site and anchor.site != other.site)
                and abs((event.published_at - member.published_at).total_seconds()) <= 72 * 3600
                for member, other in group
            ):
                group.append((event, anchor))
                break
        else:
            groups.append([(event, anchor)])
    return [[event for event, _ in group] for group in groups]
