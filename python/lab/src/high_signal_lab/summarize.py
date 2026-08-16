"""Local-LLM document summarization.

Calls an OpenAI-compatible `/chat/completions` endpoint to populate
`documents.summary` (3–5 sentences) and `documents.short_summary` (≤ 280
chars). Plan 0007 wants Qwen via MLX; this module is portable — point it at
Ollama, llama.cpp's server, vLLM, an OSS hosted endpoint, or anything else
that speaks the OpenAI chat completion shape. Defaults bias toward a local
endpoint with no API key.

Configuration via env (all optional, sensible defaults):

- `HIGH_SIGNAL_LAB_AI_BASE_URL`   default `http://localhost:11434/v1`  (Ollama)
- `HIGH_SIGNAL_LAB_AI_MODEL`      default `qwen2.5:7b`
- `HIGH_SIGNAL_LAB_AI_API_KEY`    default empty — many local endpoints ignore it

If the endpoint is unreachable the script logs and skips gracefully so the
rest of the pipeline keeps working.
"""

from __future__ import annotations

import argparse
import json
import os
import sys

import httpx

from .db import connect

DEFAULT_BASE_URL = os.environ.get(
    "HIGH_SIGNAL_LAB_AI_BASE_URL", "http://localhost:11434/v1"
)
DEFAULT_MODEL = os.environ.get("HIGH_SIGNAL_LAB_AI_MODEL", "qwen2.5:7b")
DEFAULT_API_KEY = os.environ.get("HIGH_SIGNAL_LAB_AI_API_KEY", "")
MIN_TEXT_LEN = 400
MAX_INPUT_CHARS = 6000

SYSTEM_PROMPT = (
    "You summarize tech / startup primary-source documents for an operator's"
    " daily reading queue. Return strict JSON with two fields:"
    ' {"summary": "3-5 sentence neutral summary", "short_summary": "<= 280'
    ' char one-liner suitable for a feed kicker"}. No markdown, no quotes'
    " around the JSON, no commentary."
)


def _candidate_documents(
    conn, reindex: bool, limit: int | None
) -> list[tuple[int, str, str]]:
    where = (
        ""
        if reindex
        else "WHERE summary IS NULL OR short_summary IS NULL OR length(short_summary) < 20"
    )
    limit_clause = f"LIMIT {int(limit)}" if limit else ""
    with conn.cursor() as cur:
        cur.execute(
            f"""
            SELECT id, COALESCE(title, url),
                   COALESCE(LEFT(extracted_text, {MAX_INPUT_CHARS}), '')
            FROM documents
            {where}
            ORDER BY signal_score DESC NULLS LAST, discovered_at DESC
            {limit_clause}
            """
        )
        return [
            (int(row[0]), row[1] or "", row[2] or "") for row in cur.fetchall() or []
        ]


def _summarize_one(
    client: httpx.Client, title: str, text: str, model: str
) -> dict | None:
    user = f"TITLE: {title}\n\nBODY:\n{text}".strip()
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user},
        ],
        "temperature": 0.2,
        "max_tokens": 400,
        "stream": False,
    }
    try:
        response = client.post("/chat/completions", json=payload)
    except Exception as exc:
        print(f"[summarize] HTTP error: {exc}", file=sys.stderr)
        return None
    if not response.is_success:
        print(
            f"[summarize] non-2xx: {response.status_code} {response.text[:200]}",
            file=sys.stderr,
        )
        return None
    try:
        data = response.json()
        content = data["choices"][0]["message"]["content"].strip()
    except Exception as exc:
        print(f"[summarize] parse error: {exc}", file=sys.stderr)
        return None

    # Strip fenced code blocks if the model returns ```json … ```.
    if content.startswith("```"):
        content = content.strip("`").lstrip("json").strip()
    try:
        parsed = json.loads(content)
    except json.JSONDecodeError:
        # Last-ditch: take the substring from the first { to the last } and parse.
        first, last = content.find("{"), content.rfind("}")
        if first < 0 or last <= first:
            print(f"[summarize] non-JSON output: {content[:200]}", file=sys.stderr)
            return None
        try:
            parsed = json.loads(content[first : last + 1])
        except json.JSONDecodeError:
            print(f"[summarize] non-JSON output: {content[:200]}", file=sys.stderr)
            return None
    summary = (parsed.get("summary") or "").strip()
    short = (parsed.get("short_summary") or "").strip()
    if not summary and not short:
        return None
    return {"summary": summary[:2000], "short_summary": short[:280]}


def summarize(
    base_url: str = DEFAULT_BASE_URL,
    model: str = DEFAULT_MODEL,
    api_key: str = DEFAULT_API_KEY,
    limit: int | None = 30,
    reindex: bool = False,
) -> int:
    headers: dict[str, str] = {"User-Agent": "HighSignal-Lab/0.1"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    processed = 0
    with httpx.Client(base_url=base_url, headers=headers, timeout=120.0) as client:
        # Quick reachability probe so we fail loud instead of silently churning.
        try:
            client.get("/models")
        except Exception as exc:
            print(
                "[summarize] base URL unreachable at "
                f"{base_url} ({exc}). Skip — pipeline continues without summaries.",
                file=sys.stderr,
            )
            return 0

        with connect() as conn:
            rows = _candidate_documents(conn, reindex=reindex, limit=limit)
            if not rows:
                print("summarize: no documents need summaries")
                return 0
            for doc_id, title, text in rows:
                if len(text) < MIN_TEXT_LEN:
                    continue
                result = _summarize_one(client, title, text, model)
                if not result:
                    continue
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        UPDATE documents
                           SET summary = %s,
                               short_summary = COALESCE(NULLIF(%s, ''), short_summary)
                         WHERE id = %s
                        """,
                        (result["summary"], result["short_summary"], doc_id),
                    )
                processed += 1
                if processed % 5 == 0:
                    print(f"summarize: {processed}/{len(rows)}")
    print(f"summarize: {processed} documents summarized")
    return processed


def main() -> None:
    parser = argparse.ArgumentParser(description="HighSignal Lab local-LLM summarizer")
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL)
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--api-key", default=DEFAULT_API_KEY)
    parser.add_argument("--limit", type=int, default=30)
    parser.add_argument(
        "--reindex",
        action="store_true",
        help="Re-summarize documents that already have a summary.",
    )
    args = parser.parse_args()
    summarize(
        base_url=args.base_url,
        model=args.model,
        api_key=args.api_key,
        limit=args.limit,
        reindex=args.reindex,
    )


if __name__ == "__main__":
    main()
