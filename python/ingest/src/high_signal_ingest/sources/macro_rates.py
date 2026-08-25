"""Macro rate adapters for ECB FX and optional FRED rates.

This source produces macro context events only. It does not fetch equity,
ETF, index, or crypto prices.
"""

from __future__ import annotations

import csv
import logging
import os
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from io import StringIO

import httpx

from ..types import Event
from ..utils import event_hash


USER_AGENT = "high-signal/0.1 macro-rates-ingest"
LOGGER = logging.getLogger(__name__)
ECB_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml"
FRED_URL = "https://api.stlouisfed.org/fred/series/observations"
FRED_SERIES = ("DGS3MO", "DGS10")


def ecb_events_from_xml(xml_text: str) -> list[Event]:
    root = ET.fromstring(xml_text)
    out: list[Event] = []
    for cube in root.iter():
        date_value = cube.attrib.get("time")
        if not date_value:
            continue
        try:
            published = datetime.fromisoformat(date_value).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
        rates = {
            child.attrib.get("currency"): child.attrib.get("rate")
            for child in cube
            if child.attrib.get("currency") and child.attrib.get("rate")
        }
        if not rates:
            continue
        summary = ", ".join(
            f"EUR/{currency}={rate}" for currency, rate in sorted(rates.items())[:12]
        )
        raw_hash = event_hash("ecb-fx", date_value)
        out.append(
            Event(
                id=raw_hash[:16],
                source="macro-rates:ecb-fx",
                source_url=ECB_URL,
                published_at=published,
                title=f"ECB daily FX reference rates: {date_value}",
                content=summary,
                primary_entity_id=None,
                raw_hash=raw_hash,
            )
        )
    return out


def fred_events_from_csv(series_id: str, csv_text: str, since: datetime) -> list[Event]:
    out: list[Event] = []
    # FRED may return CRLF or bare-CR CSV depending on the edge path. Passing
    # newline="" lets the csv module normalize those records without raising
    # "new-line character seen in unquoted field".
    reader = csv.DictReader(StringIO(csv_text, newline=""))
    for row in reader:
        value = str(row.get("value") or "").strip()
        date_value = str(row.get("date") or "").strip()
        if not value or value == ".":
            continue
        try:
            published = datetime.fromisoformat(date_value).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
        if published < since:
            continue
        raw_hash = event_hash("fred", series_id, date_value, value)
        out.append(
            Event(
                id=raw_hash[:16],
                source=f"macro-rates:fred:{series_id.lower()}",
                source_url=f"https://fred.stlouisfed.org/series/{series_id}",
                published_at=published,
                title=f"FRED {series_id}: {value}",
                content=f"{series_id} observation on {date_value}: {value}",
                primary_entity_id=None,
                raw_hash=raw_hash,
            )
        )
    return out


def fetch_ecb() -> list[Event]:
    try:
        response = httpx.get(
            ECB_URL,
            headers={"User-Agent": USER_AGENT, "Accept": "application/xml"},
            timeout=20.0,
            follow_redirects=True,
        )
        response.raise_for_status()
    except httpx.HTTPError as exc:
        LOGGER.debug("ecb fx fetch failed error=%s", exc)
        return []
    return ecb_events_from_xml(response.text)


def fetch_fred(days: int = 30, api_key: str | None = None) -> list[Event]:
    key = api_key or os.environ.get("FRED_API_KEY")
    if not key:
        LOGGER.debug("fred skipped: FRED_API_KEY is not set")
        return []
    since = datetime.now(timezone.utc) - timedelta(days=days)
    out: list[Event] = []
    with httpx.Client(
        headers={"User-Agent": USER_AGENT, "Accept": "text/csv"},
        timeout=20.0,
        follow_redirects=True,
    ) as client:
        for series_id in FRED_SERIES:
            try:
                response = client.get(
                    FRED_URL,
                    params={
                        "series_id": series_id,
                        "api_key": key,
                        "file_type": "csv",
                        "observation_start": since.date().isoformat(),
                    },
                )
                response.raise_for_status()
            except httpx.HTTPError as exc:
                LOGGER.debug("fred fetch failed series=%s error=%s", series_id, exc)
                continue
            out.extend(fred_events_from_csv(series_id, response.text, since))
    return out


def fetch_all(days: int = 30) -> list[Event]:
    return [*fetch_ecb(), *fetch_fred(days=days)]
