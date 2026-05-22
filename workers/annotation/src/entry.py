from __future__ import annotations

import json
from typing import Any

from annotate import annotate_text
from workers import Response, WorkerEntrypoint

MAX_TEXT_CHARS = 5000
MAX_BATCH = 25


def _json_response(payload: dict[str, Any], status: int = 200) -> Response:
    return Response(
        json.dumps(payload),
        status=status,
        headers={
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
        },
    )


def _bad_request(message: str) -> Response:
    return _json_response({"ok": False, "error": message}, status=400)


def _get_value(payload: Any, key: str) -> Any:
    if isinstance(payload, dict):
        return payload.get(key)
    return getattr(payload, key, None)


def _normalize_text(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    return value.strip()[:MAX_TEXT_CHARS]


def _normalize_texts(payload: Any) -> list[str] | None:
    text = _normalize_text(_get_value(payload, "text"))
    if text:
        return [text]

    texts = _get_value(payload, "texts")
    if isinstance(texts, str):
        return None
    try:
        raw_texts = list(texts)
    except Exception:
        return None

    normalized = [_normalize_text(item) for item in raw_texts[:MAX_BATCH]]
    return [item for item in normalized if item]


class Default(WorkerEntrypoint):
    async def fetch(self, request):
        url = str(request.url)
        method = str(request.method).upper()

        if method == "GET" and url.endswith("/health"):
            return _json_response(
                {
                    "ok": True,
                    "service": "high-signal-annotation",
                    "method": "semantic-rules-v2",
                    "classifierVersion": "semantic-rules-v2.1",
                    "model": "none",
                    "llm": False,
                }
            )

        if method != "POST":
            return _json_response({"ok": False, "error": "use POST /annotate"}, status=405)

        try:
            payload = await request.json()
        except Exception:
            return _bad_request("invalid JSON body")

        texts = _normalize_texts(payload)
        if not texts:
            return _bad_request("body must include text or texts")

        annotations = [annotate_text(text).to_dict() for text in texts]
        return _json_response(
            {
                "ok": True,
                "count": len(annotations),
                "annotations": annotations,
            }
        )
