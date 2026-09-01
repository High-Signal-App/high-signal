"""Shared verification handoff for derived attention collectors."""

from __future__ import annotations

from typing import Any

import httpx

from .digg_verify import MAX_REQUESTS_PER_POLL, verify_requests


def process_verification_requests(
    body: dict[str, Any],
    client: httpx.Client,
    *,
    api_base: str,
    token: str,
    route: str,
    attention_source: str,
) -> dict[str, Any]:
    raw_requests = body.get("verificationRequests", [])
    if not isinstance(raw_requests, list):
        return body

    requests = [
        {**request, "attentionSource": attention_source}
        for request in raw_requests[:MAX_REQUESTS_PER_POLL]
        if isinstance(request, dict) and request.get("shortId")
    ]
    result_url = f"{api_base.rstrip('/')}/admin/{route}/verification-results"
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    if requests:
        running = [{"shortId": request["shortId"], "status": "running"} for request in requests]
        client.post(result_url, headers=headers, json={"results": running}).raise_for_status()
        results = verify_requests(requests, client)
        client.post(result_url, headers=headers, json={"results": results}).raise_for_status()
        body["verificationResults"] = results

    body["verificationRequests"] = [
        {
            **{key: value for key, value in request.items() if key != "retainedEvidence"},
            "retainedEvidenceCount": len(request.get("retainedEvidence", [])),
        }
        for request in raw_requests
        if isinstance(request, dict)
    ]
    return body
