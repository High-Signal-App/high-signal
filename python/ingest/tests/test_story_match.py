from datetime import datetime, timezone

import pytest

from high_signal_ingest import story_match
from high_signal_ingest.types import Event

LEFT = "The company completed a million wafer processing milestone using its advanced tools."
RIGHT = "Production and research tools have now processed more than one million wafers."


def event(text, name):
    return Event(
        id=name,
        source=f"news:{name}",
        source_url=f"https://{name}.example/article",
        published_at=datetime.now(timezone.utc),
        raw_hash=name,
        content=text * 10,
    )


def decision(**changes):
    return {
        "sameEvent": True,
        "event": "The million wafer processing milestone",
        "leftPassageId": "L0",
        "rightPassageId": "R0",
        **changes,
    }


def test_different_headline_matching_requires_saved_receipt(monkeypatch):
    receipts = []
    monkeypatch.setattr(
        story_match, "_ai_complete", lambda *_, **__: (decision(), {"model": "test"})
    )
    monkeypatch.setattr(story_match.audit, "push_llm_run", lambda **kw: receipts.append(kw) or True)
    left, right = event(LEFT, "issuer"), event(RIGHT, "reporter")
    assert story_match.match_story(left, right) == (True, "same_event")
    assert receipts[0]["prompt_version"] == story_match.PROMPT_VERSION
    assert left.source_document is None and right.source_document is None
    monkeypatch.setattr(story_match.audit, "push_llm_run", lambda **_: False)
    assert story_match.match_story(left, right) == (False, "audit_unavailable")


@pytest.mark.parametrize(
    "response",
    [
        decision(sameEvent=False),
        decision(sameEvent="true"),
        decision(leftPassageId="invented"),
        decision(rightPassageId="L0"),
        decision(leftPassageId=[]),
        decision(event="vague"),
        [],
        None,
    ],
)
def test_invalid_or_unavailable_comparisons_stay_separate(monkeypatch, response):
    monkeypatch.setattr(story_match, "_ai_complete", lambda *_, **__: (response, {}))
    monkeypatch.setattr(story_match.audit, "push_llm_run", lambda **_: True)
    assert story_match.match_story(event(LEFT, "left"), event(RIGHT, "right"))[0] is False


def test_thin_text_never_calls_model(monkeypatch):
    def unexpected(*_, **__):
        raise AssertionError("unexpected model call")

    monkeypatch.setattr(story_match, "_ai_complete", unexpected)
    assert story_match.match_story(event("short", "left"), event(RIGHT, "right")) == (
        False,
        "thin_text",
    )


def test_selected_passages_preserve_exact_source_and_ignore_generated_quotes(monkeypatch):
    receipts = []
    model_result = decision(leftQuote="invented" * 100, rightQuote="rewritten")
    monkeypatch.setattr(story_match, "_ai_complete", lambda *_, **__: (model_result, {}))
    monkeypatch.setattr(story_match.audit, "push_llm_run", lambda **kw: receipts.append(kw) or True)
    left, right = event(LEFT, "left"), event(RIGHT, "right")
    assert story_match.match_story(left, right)[0]
    result = receipts[0]["response_json"]["result"]
    assert result["leftQuote"] in left.content
    assert result["rightQuote"] in right.content
    assert 40 <= len(result["leftQuote"]) <= 600


def test_passages_are_bounded_exact_substrings_even_without_word_breaks():
    text = "α" * 1200 + "\n" + ("A sentence with punctuation. " * 50)
    passages = story_match._passages(text, "L")
    assert len(passages) > 2
    assert all(40 <= len(passage) <= 600 and passage in text for passage in passages.values())


def test_unavailable_match_records_structured_diagnostics_without_raw_provider_body(monkeypatch):
    receipts = []
    monkeypatch.setattr(
        story_match,
        "_ai_complete",
        lambda *_, **__: (
            None,
            {
                "failure_class": "client_error",
                "http_status": 402,
                "attempts": 1,
                "reason": "private error details",
                "raw_response": "private provider response",
            },
        ),
    )
    monkeypatch.setattr(story_match.audit, "push_llm_run", lambda **kw: receipts.append(kw) or True)
    assert story_match.match_story(event(LEFT, "left"), event(RIGHT, "right")) == (
        False,
        "model_unavailable",
    )
    assert receipts[0]["response_json"] == {
        "result": None,
        "failureClass": "client_error",
        "httpStatus": 402,
        "attempts": 1,
    }


@pytest.mark.parametrize(
    "payload", [{"matched": True}, {"sameEvent": None}, {"sameEvent": 0}, {"sameEvent": "false"}]
)
def test_wrong_shape_comparison_is_model_unavailable_not_a_negative(monkeypatch, payload):
    """A completion missing the required sameEvent field is malformed — an
    operational failure, not a legitimate non-match."""
    import httpx
    import json as jsonlib

    from high_signal_ingest import generator

    monkeypatch.setenv("AI_API_KEY", "test-key")
    monkeypatch.setenv("AI_BASE_URL", "https://test-gateway.example/v1")
    monkeypatch.setenv("AI_MODEL", "test-model")
    monkeypatch.setattr(generator, "_AI_RETRIES", 1)

    receipts = []
    monkeypatch.setattr(story_match.audit, "push_llm_run", lambda **kw: receipts.append(kw) or True)

    body = {"choices": [{"message": {"content": jsonlib.dumps(payload)}}]}
    client = httpx.Client(
        transport=httpx.MockTransport(
            lambda _req: httpx.Response(200, content=jsonlib.dumps(body).encode())
        )
    )

    def _post(url, **kwargs):
        payload = kwargs.get("json")
        request = httpx.Request(
            "POST",
            url,
            headers=kwargs.get("headers", {}),
            content=jsonlib.dumps(payload).encode() if payload else None,
        )
        return client.send(request)

    monkeypatch.setattr(httpx, "post", _post)

    matched, reason = story_match.match_story(event(LEFT, "left"), event(RIGHT, "right"))
    assert (matched, reason) == (False, "model_unavailable")
    assert receipts[0]["accepted"] is False
    assert receipts[0]["response_json"]["failureClass"] == "invalid_response"
