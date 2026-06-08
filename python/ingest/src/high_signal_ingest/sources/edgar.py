"""SEC EDGAR adapter.

Daily runs stay focused on 8-K. Wider windows add 10-Q/K, S-1, Form 4, and
13F-HR for tracked public companies, plus curated private-company Form D search
through SEC's search-index endpoint.
"""

from __future__ import annotations

import hashlib
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable, Iterator

import httpx

from ..types import Event, SourceDocument


# Forms most likely to carry directional signals
DEFAULT_FORMS: tuple[str, ...] = ("8-K", "10-Q", "10-K")
EXPANDED_FORMS: tuple[str, ...] = ("8-K", "10-Q", "10-K", "S-1", "S-1/A", "4", "13F-HR")
FORM_D_SEARCH_URL = "https://efts.sec.gov/LATEST/search-index"
PRIVATE_FORM_D_QUERIES = (
    "OpenAI",
    "Anthropic",
    "xAI",
    "Mistral AI",
    "Databricks",
    "Perplexity AI",
    "Stripe",
    "Figma",
    "Cerebras",
)
LOGGER = logging.getLogger(__name__)


def _hash(*parts: str) -> str:
    return hashlib.sha256("␟".join(parts).encode("utf-8")).hexdigest()


def _ensure_identity() -> None:
    from edgar import set_identity

    set_identity(os.environ.get("SEC_USER_AGENT", "high-signal research@example.com"))


def _user_agent() -> str:
    return os.environ.get("SEC_USER_AGENT", "high-signal research@example.com")


def _parse_date(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value[:10]).replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def _filing_archive_url(cik: str, accession: str, doc: str = "primary_doc.xml") -> str:
    cik_path = str(int(cik)) if cik.isdigit() else cik.lstrip("0")
    accession_path = accession.replace("-", "")
    return f"https://www.sec.gov/Archives/edgar/data/{cik_path}/{accession_path}/{doc}"


def form_d_events_from_search(query: str, payload: dict[str, Any], since: datetime) -> list[Event]:
    hits = payload.get("hits") if isinstance(payload.get("hits"), dict) else {}
    rows = hits.get("hits") if isinstance(hits.get("hits"), list) else []
    out: list[Event] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        source = row.get("_source") if isinstance(row.get("_source"), dict) else {}
        form = str(source.get("form") or source.get("file_type") or "").upper()
        filed_at = _parse_date(str(source.get("file_date") or ""))
        accession = str(source.get("adsh") or "").strip()
        ciks = source.get("ciks") if isinstance(source.get("ciks"), list) else []
        if form != "D" or filed_at is None or filed_at < since or not accession or not ciks:
            continue
        display_names = [
            str(name).strip()
            for name in source.get("display_names", [])
            if isinstance(name, str) and name.strip()
        ]
        locations = [
            str(loc).strip()
            for loc in source.get("biz_locations", [])
            if isinstance(loc, str) and loc.strip()
        ]
        items = [
            str(item).strip()
            for item in source.get("items", [])
            if isinstance(item, str) and item.strip()
        ]
        raw_hash = _hash("sec-form-d", query, accession)
        out.append(
            Event(
                id=raw_hash[:16],
                source="edgar_d",
                source_url=_filing_archive_url(str(ciks[0]), accession),
                published_at=filed_at,
                title=f"SEC Form D: {display_names[0] if display_names else query}",
                content="\n".join(
                    part
                    for part in [
                        f"Query: {query}",
                        f"Issuers: {'; '.join(display_names[:4])}" if display_names else "",
                        f"Business locations: {'; '.join(locations[:4])}" if locations else "",
                        f"Items: {', '.join(items)}" if items else "",
                    ]
                    if part
                )[:20_000]
                or None,
                primary_entity_id=None,
                raw_hash=raw_hash,
                source_document=SourceDocument(
                    canonical_url=_filing_archive_url(str(ciks[0]), accession),
                    published_at=filed_at,
                    raw_hash=raw_hash,
                    raw_json=source,
                    parsed_fields={
                        "form": form,
                        "query": query,
                        "accession": accession,
                        "cik": str(ciks[0]),
                    },
                ),
            )
        )
    return out


def fetch_filings(
    tickers: list[str],
    since: datetime,
    forms: Iterable[str] = DEFAULT_FORMS,
) -> Iterator[Event]:
    """Yield filings for given tickers + form types since `since`."""
    try:
        from edgar import Company
    except ImportError as e:
        raise RuntimeError("edgartools not installed — uv sync first") from e

    _ensure_identity()

    for ticker in tickers:
        try:
            co = Company(ticker)
        except Exception:
            continue
        for form in forms:
            try:
                filings = co.get_filings(form=form)
            except Exception:
                continue
            for filing in filings:
                try:
                    filed_at = datetime.fromisoformat(str(filing.filing_date))
                    if filed_at.tzinfo is None:
                        filed_at = filed_at.replace(tzinfo=timezone.utc)
                except Exception:
                    continue
                if filed_at < since:
                    continue
                url = getattr(filing, "filing_url", None) or getattr(filing, "url", "")
                title = f"{ticker} {form}: {getattr(filing, 'items', '')}".strip()
                content = ""
                try:
                    # 10-Q/K bodies are huge — keep first 50k chars (MD&A is up front)
                    content = (filing.text() or "")[:50_000]
                except Exception:
                    pass
                raw_hash = _hash(ticker, form, str(filed_at), url)
                yield Event(
                    id=raw_hash[:16],
                    source=f"edgar_{form.lower().replace('-', '')}",
                    source_url=url,
                    published_at=filed_at,
                    title=title,
                    content=content,
                    primary_entity_id=ticker,
                    raw_hash=raw_hash,
                )


def fetch_recent(
    tickers: list[str], days: int = 7, forms: Iterable[str] = DEFAULT_FORMS
) -> list[Event]:
    since = datetime.now(timezone.utc) - timedelta(days=days)
    return list(fetch_filings(tickers, since, forms=forms))


def fetch_form_d_search(
    days: int = 30,
    queries: Iterable[str] = PRIVATE_FORM_D_QUERIES,
) -> list[Event]:
    since = datetime.now(timezone.utc) - timedelta(days=days)
    out: list[Event] = []
    with httpx.Client(
        headers={"User-Agent": _user_agent(), "Accept": "application/json"},
        timeout=20.0,
        follow_redirects=True,
    ) as client:
        for query in queries:
            try:
                response = client.get(
                    FORM_D_SEARCH_URL,
                    params={"q": query, "forms": "D", "dateRange": f"{days}d"},
                )
                response.raise_for_status()
                payload = response.json()
            except (httpx.HTTPError, ValueError) as exc:
                LOGGER.debug("sec form d search failed query=%s error=%s", query, exc)
                continue
            if isinstance(payload, dict):
                out.extend(form_d_events_from_search(query, payload, since))
    return out


def fetch_expanded(tickers: list[str], days: int = 30) -> list[Event]:
    return [
        *fetch_recent(tickers, days=days, forms=EXPANDED_FORMS),
        *fetch_form_d_search(days=days),
    ]


# Backwards-compat alias
def fetch_8k(tickers: list[str], since: datetime) -> Iterator[Event]:
    return fetch_filings(tickers, since, forms=("8-K",))
