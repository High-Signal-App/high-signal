from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from high_signal_ingest import generator

from high_signal_ingest.pipeline import _proof_verdict

from high_signal_ingest.evidence_origins import coalesce_copied_origins, distinct_generation_events
from high_signal_ingest.generator import _proof_evidence
from high_signal_ingest.types import Event


def event(name, text):
    return Event(
        id=name,
        source=f"news:{name}",
        source_url=f"https://{name}.example/release",
        published_at=datetime.now(timezone.utc),
        raw_hash=name,
        content=text,
    )


RELEASE = " ".join(
    f"The factory completed stage {i} with equipment number {i + 200}." for i in range(35)
)
OTHER = " ".join(
    f"Independent laboratory measured sample {i} against reference {i + 800}." for i in range(35)
)


def test_reprint_with_wrapper_cannot_gain_independence_from_model_ids():
    events = [
        event("issuer", RELEASE),
        event("syndicator", "Press releases from our partners. " + RELEASE),
    ]
    evidence = _proof_evidence(
        {
            "proofs": [
                {
                    "url": e.source_url,
                    "aligned": True,
                    "originating_evidence_id": e.id,
                    "supports": ["observed_event"],
                }
                for e in events
            ]
        },
        events,
    )
    assert len({e.originating_evidence_id for e in evidence}) == 1
    assert [e.role for e in evidence] == ["primary", "context"]
    assert _proof_verdict(SimpleNamespace(evidence=evidence)).reason == "single_evidentiary_origin"


def test_shared_topic_or_short_quote_does_not_merge_origins():
    events = [event("issuer", RELEASE), event("reporter", RELEASE[:160] + OTHER)]
    assert coalesce_copied_origins(events, ["a", "b"]) == ["a", "b"]


def test_missing_origin_and_thin_text_cannot_gain_credit():
    events = [event("issuer", RELEASE), event("copy", RELEASE), event("thin", "same short quote")]
    assert coalesce_copied_origins(events, ["a", "", "b"]) == ["a", "", "b"]


def test_copy_merge_preserves_model_declared_origin_connections():
    events = [event("issuer", RELEASE), event("copy", RELEASE), event("other", OTHER)]
    assert coalesce_copied_origins(events, ["a", "b", "b"]) == ["a", "a", "a"]
    assert coalesce_copied_origins(list(reversed(events)), ["b", "b", "a"]) == ["a", "a", "a"]


def test_generation_input_keeps_distinct_report_and_does_not_mutate_retained_events():
    primary, copy, report = (
        event("primary", RELEASE),
        event("copy", RELEASE),
        event("report", OTHER),
    )
    events = [primary, copy, report]
    assert distinct_generation_events(events) == [primary, report]
    assert events == [primary, copy, report]


@pytest.mark.parametrize("batch", [False, True])
def test_article_request_omits_copy_but_keeps_distinct_report(monkeypatch, batch):
    events = [event("primary", RELEASE), event("copy", RELEASE), event("report", OTHER)]
    for item in events:
        item.title = "NVIDIA factory update"
    requests = []

    def complete(prompt, content, **kwargs):
        requests.append(content)
        assert "at least two independent evidence origins" in prompt
        assert "low confidence drafts may use 1" not in prompt
        return {"publish": False, "signals": []}, {"model": "test", "prompt_version": "test"}

    monkeypatch.setattr(generator, "_ai_complete", complete)
    from high_signal_ingest import audit

    monkeypatch.setattr(audit, "push_llm_run", lambda **_: True)
    if batch:
        generator.generate_batch([("NVDA", events, [])])
    else:
        generator.generate("NVDA", events, [])
    assert events[0].source_url in requests[0]
    assert events[1].source_url not in requests[0]
    assert events[2].source_url in requests[0]
