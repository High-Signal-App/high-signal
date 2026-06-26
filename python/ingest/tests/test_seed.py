"""Smoke tests for seed loaders + entity gazetteer."""

from __future__ import annotations

from high_signal_ingest.extract.entities import gazetteer_match, primary_entity
from high_signal_ingest.seed import (
    entity_gazetteer,
    load_entities,
    load_relationships,
    load_signal_types,
    load_sources,
)


def test_entities_load() -> None:
    es = load_entities()
    assert len(es) >= 200, f"expected >=200 entities, got {len(es)}"
    ids = {e.id for e in es}
    for must in {"NVDA", "TSM", "ASML", "AMD", "MSFT", "GOOGL", "AMZN", "META"}:
        assert must in ids, f"missing {must}"


def test_relationships_load() -> None:
    rs = load_relationships()
    assert len(rs) >= 100
    # Weights bounded
    for r in rs:
        assert 0.0 < r.weight <= 1.0


def test_signal_types_load() -> None:
    ts = load_signal_types()
    assert len(ts) >= 20
    ids = {t.get("id") for t in ts}
    for must in {
        "capex_change_hyperscaler",
        "capex_change_neocloud",
        "gpu_lead_time_shift",
        "design_win",
        "export_restriction",
    }:
        assert must in ids


def test_sources_load() -> None:
    ss = load_sources()
    assert len(ss) >= 80
    tier1 = [s for s in ss if s.get("tier") == 1]
    assert len(tier1) >= 30


def test_gazetteer() -> None:
    es = load_entities()
    lut = entity_gazetteer(es)
    assert "nvda" in lut
    assert lut["nvda"] == "NVDA"


def test_gazetteer_match() -> None:
    text = "TSMC posts strong CoWoS guidance; NVDA expected to benefit."
    hits = gazetteer_match(text)
    assert "NVDA" in hits


def test_gazetteer_match_dollar_prefixed_ticker() -> None:
    # Prediction-market questions commonly use "$TICKER" — the old space-pad
    # heuristic missed these because "$" isn't a space. Regex word-boundary
    # match fixes it.
    text = "Will $ASML reach $1700 by year-end?"
    hits = gazetteer_match(text)
    assert "ASML" in hits


def test_gazetteer_match_punctuation_boundaries() -> None:
    # Trailing comma / period / question-mark / colon should all be word boundaries.
    for suffix in (",", ".", "?", ":", "!", ";"):
        text = f"NVDA{suffix} earnings beat"
        hits = gazetteer_match(text)
        assert "NVDA" in hits, f"missed NVDA before {suffix!r}"


def test_gazetteer_match_does_not_match_inside_word() -> None:
    # Substring inside a longer word — e.g. "MASML" — should NOT match ASML.
    text = "Some MASML or NVDAX gibberish"
    hits = gazetteer_match(text)
    assert "ASML" not in hits
    assert "NVDA" not in hits


def test_gazetteer_match_lookaround_does_not_break_normal_cases() -> None:
    # Smoke-test that switching from \b to lookarounds keeps the normal
    # matches working — start, middle, end of string with various punctuation.
    cases = [
        ("NVDA up 3%",   "NVDA"),       # start of string
        ("Watch NVDA",   "NVDA"),       # end of string, after space
        ("Buy NVDA, hold", "NVDA"),     # comma after
        ("(NVDA)",       "NVDA"),       # bracketed
    ]
    for text, expected in cases:
        hits = gazetteer_match(text)
        assert expected in hits, f"missed {expected} in {text!r}"


def test_primary_entity() -> None:
    text = (
        "AMD signs multi-year supply deal with TSMC. Industry watchers note AMD's MI400 timeline."
    )
    p = primary_entity(text)
    assert p in {"AMD", "TSM"}


def test_data_center_operators_map_from_municipal_text() -> None:
    # Corroboration mechanism: when a municipal record names a tracked
    # data-center operator, the item must attach to that entity so it can
    # cluster with other sources and clear the cite-or-kill gate.
    cases = {
        "Conditional Use Permit application by Compass Datacenters LLC": "COMPASS_DC",
        "Special Use Permit for Vantage Data Centers campus": "VANTAGE_DC",
        "Authorization to Grant 5C Data Centers a Binding Waiver": "FIVEC_DC",
        "Power purchase agreement with Arizona Public Service": "APS_UTIL",
    }
    for text, eid in cases.items():
        assert eid in gazetteer_match(text), f"{eid} not matched in {text!r}"


def test_generic_operator_names_do_not_false_match() -> None:
    # Disambiguated-alias rule: generic words must NOT pull in operators.
    noise = [
        "switch the lights off in the council chamber",
        "the proposal is aligned with the comprehensive plan",
        "approval of a tract of land for subdivision",
        "a stack of permits was reviewed",
        "prime downtown location rezoning",
    ]
    for text in noise:
        assert gazetteer_match(text) == [], f"unexpected match in {text!r}"


def test_common_word_tickers_only_match_uppercase_or_dollar() -> None:
    # Common-word tickers (NET/META/SNOW/FORM/ONTO/ARM) must NOT match the
    # lowercase English word, but MUST still match the uppercase/$ ticker form
    # and the distinctive full name.
    assert "NET" not in gazetteer_match("net income rose on strong margins")
    assert "META" not in gazetteer_match("a paper on meta-learning methods")
    assert "SNOW" not in gazetteer_match("snow fell overnight")
    assert "FORM" not in gazetteer_match("please fill out the form")
    # Uppercase ticker / $-prefixed / full name still resolve.
    assert "NET" in gazetteer_match("Cloudflare guidance; $NET up 4%")
    assert "META" in gazetteer_match("Meta Platforms and Facebook ad revenue")
    assert "SNOW" in gazetteer_match("Snowflake Q3 results")


def test_sanctuary_phoenix_alias_collision_removed() -> None:
    # Sanctuary AI's humanoid robot "Phoenix" used to be a bare alias, so every
    # "Phoenix AZ" municipal item false-matched it. The alias was removed.
    assert "SANCTUARY" not in gazetteer_match("Phoenix AZ City Council rezoning hearing")
