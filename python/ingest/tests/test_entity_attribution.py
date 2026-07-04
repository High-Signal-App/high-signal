"""Entity attribution + evidence relevance.

Regression fixtures are the real defects observed in the live /brief/daily
payload on 2026-07-04, where events were attributed to — and cited under — the
wrong entity because attribution scanned the full scraped body (widgets,
related-article rails, ticker tapes) and any single incidental mention won:

  - a Rust crate whose description references "Google's SwissTable" was filed
    under Alphabet (GOOGL);
  - an Economic Times markets page was filed under HCL (HCLTECH);

Uses the real seed gazetteer so the thresholds are exercised against production
entity data, not a fixture gazetteer.
"""

from __future__ import annotations

from high_signal_ingest.extract.entities import (
    entity_scores,
    event_supports_entity,
    primary_entity,
)


def test_title_mention_outweighs_body():
    scores = entity_scores("nvidia is mentioned once here", title="NVIDIA unveils new GPU")
    # title hit (x4) + body hit (x1) = 5
    assert scores.get("NVDA") == 5


def test_title_entity_wins_attribution():
    assert primary_entity("The chipmaker shipped units.", title="NVIDIA unveils new GPU") == "NVDA"


def test_repeated_body_mention_clears_floor():
    # Two body mentions (score 2) with no title still attribute.
    assert primary_entity("Intel said the deal closed. Intel also raised guidance.") == "INTC"


def test_single_incidental_body_mention_is_dropped():
    # One passing mention, not in the title → below the min-score floor → None,
    # so a whole event is never attributed to a company it merely name-drops.
    assert primary_entity("A small startup that competes with Intel in one niche.") is None


def test_rust_crate_not_filed_under_alphabet():
    # The live bug: "Google's SwissTable" (one mention) filed a Rust crate under
    # Alphabet. It must no longer resolve to GOOGL.
    title = "hashbrown - crates.io: Rust Package Registry"
    content = "A Rust port of Google's SwissTable hash map. Fast, efficient hashing."
    assert primary_entity(content, title=title) != "GOOGL"


def test_unrelated_markets_page_not_filed_under_hcl():
    # The live bug: a Bajaj Housing Finance markets page cited under an HCL
    # signal. Bajaj is untracked and HCL is not in the title/lead → no primary.
    title = "Bajaj Housing Finance shares rally 5% as Q1 AUM climbs 24% YoY"
    content = "Bajaj Housing Finance reported strong quarterly numbers; analysts stay positive."
    assert primary_entity(content, title=title) != "HCLTECH"


def test_real_company_attribution_preserved():
    title = "Alphabet reports Q2 earnings, Google Cloud grows"
    content = "Alphabet said Google capex will rise. Google Cloud revenue up sharply."
    assert primary_entity(content, title=title) == "GOOGL"


# ─── evidence relevance filter ──────────────────────────────────────────────


def test_evidence_dropped_when_titled_for_other_entity():
    # An event titled for Intel is not valid evidence for an Alphabet signal.
    assert event_supports_entity("GOOGL", "Intel earnings beat", "Intel Corp reported...") is False


def test_evidence_kept_when_names_subject():
    assert event_supports_entity("GOOGL", "Alphabet earnings", "Google reported...") is True


def test_evidence_kept_for_spillover_candidate():
    # Supply-chain spillover: a TSMC event supports an NVDA signal when TSMC is a
    # declared spillover candidate.
    assert event_supports_entity("NVDA", "TSMC ramps N2 node", "...", spillover=["TSM"]) is True


def test_evidence_kept_when_no_tracked_entity_named():
    # A bare filing title names no tracked entity — keep it (benefit of doubt),
    # so authoritative filings are never dropped.
    assert event_supports_entity("NVDA", "Current Report", "Form 8-K filing text") is True
