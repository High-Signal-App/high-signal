"""US government API adapter — multi-source, keyless + key-gated.

Covers US government **JSON/XML/GeoJSON APIs** (not RSS — those live in
``us_gov_rss.py`` / ``gov.py``). Each sub-source is a different agency API,
structured like ``markets.py`` / ``package_registries.py`` with one
``_fetch_<name>(days)`` function per source and a top-level ``fetch_all``
that fans out and concatenates.

Keyless sub-sources (always run):
- cftc-cot       — CFTC Commitments of Traders (Socrata)
- treasury-yields — US Treasury yield curve (XML)
- cfpb-complaints — CFPB consumer complaints
- nih-reporter   — NIH research grants
- nsf-awards     — NSF research awards
- usgs-earthquakes — USGS significant earthquakes (GeoJSON)
- noaa-weather   — NOAA active weather alerts

Key-gated sub-sources (skipped without env var, like ``bls.py`` / ``eia.py``):
- bea            — BEA GDP / personal income      (BEA_API_KEY)
- census         — Census retail / business        (CENSUS_API_KEY)
- congress       — Congress.gov bills              (CONGRESS_API_KEY)
- fec            — FEC independent expenditures    (FEC_API_KEY)
- lda            — Senate lobbying registrations   (LDA_API_KEY, optional)
- fda            — FDA adverse drug events         (FDA_API_KEY, optional)
- usda-nass      — USDA agricultural stats         (USDA_NASS_API_KEY)

Output: Events tagged ``source: us-gov-api:<sub-source>``.
"""

from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Any
from xml.etree import ElementTree as ET

import httpx

from ..types import Event
from ..utils import event_hash

USER_AGENT = "high-signal/0.1 us-gov-api-ingest"
LOGGER = logging.getLogger(__name__)
CONTENT_CAP = 20_000
TIMEOUT = 25.0


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _parse_dt(value: str | None) -> datetime | None:
    """Parse an ISO-8601 datetime (tolerating trailing ``Z`` and date-only)."""
    if not value:
        return None
    for candidate in (value[:19].replace("Z", "+00:00"), value[:10]):
        try:
            dt = datetime.fromisoformat(candidate)
            return dt.astimezone(timezone.utc) if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return None


def _cap(text: str) -> str:
    return text[:CONTENT_CAP]


# ---------------------------------------------------------------------------
# 1. CFTC Commitments of Traders (Socrata, keyless)
# ---------------------------------------------------------------------------

CFTC_COT_URL = "https://publicreporting.cftc.gov/resource/jun7-fc8e.json"


def _fetch_cftc_cot(days: int) -> list[Event]:
    """Latest week of CFTC Commitments of Traders futures positioning."""
    since = _now() - timedelta(days=days)
    out: list[Event] = []
    try:
        r = httpx.get(
            CFTC_COT_URL,
            params={"$order": "report_date_as_yyyy_mm_dd DESC", "$limit": 500},
            headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
            timeout=TIMEOUT,
            follow_redirects=True,
        )
        r.raise_for_status()
        rows = r.json()
    except (httpx.HTTPError, ValueError) as exc:
        LOGGER.debug("cftc-cot fetch failed: %s", exc)
        return []
    if not isinstance(rows, list):
        return []
    seen: set[str] = set()
    for row in rows:
        if not isinstance(row, dict):
            continue
        report_date = str(row.get("report_date_as_yyyy_mm_dd") or "").strip()
        market = str(row.get("market_and_exchange_names") or row.get("cftc_market_name") or "").strip()
        if not report_date or not market:
            continue
        published = _parse_dt(report_date)
        if published is None or published < since:
            continue
        key = f"{market}|{report_date}"
        if key in seen:
            continue
        seen.add(key)
        long_pos = str(row.get("noncomm_positions_long_all") or "").strip()
        short_pos = str(row.get("noncomm_positions_short_all") or "").strip()
        net = ""
        try:
            if long_pos and short_pos:
                net = str(int(long_pos) - int(short_pos))
        except ValueError:
            pass
        raw_hash = event_hash("us-gov-api:cftc-cot", market, report_date)
        content = _cap(
            f"CFTC CoT {market} for {report_date}.\n"
            f"Non-commercial long: {long_pos}, short: {short_pos}, net: {net}."
        )
        out.append(
            Event(
                id=raw_hash[:16],
                source="us-gov-api:cftc-cot",
                source_url="https://www.cftc.gov/MarketReports/CommitmentsofTraders/index.htm",
                published_at=published,
                title=f"CFTC CoT: {market} ({report_date})",
                content=content,
                primary_entity_id=None,
                raw_hash=raw_hash,
            )
        )
    return out


# ---------------------------------------------------------------------------
# 2. US Treasury yield curve (keyless XML)
# ---------------------------------------------------------------------------

TREASURY_XML_URL = "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml"


def _fetch_treasury_yields(days: int) -> list[Event]:
    """Daily US Treasury yield curve rates (par yields), parsed from XML."""
    since = _now() - timedelta(days=days)
    out: list[Event] = []
    try:
        r = httpx.get(
            TREASURY_XML_URL,
            params={"type": "daily_treasury_yield_curve", "field_tdr_date_value": since.strftime("%Y-%m-%d")},
            headers={"User-Agent": USER_AGENT, "Accept": "application/xml"},
            timeout=TIMEOUT,
            follow_redirects=True,
        )
        r.raise_for_status()
        text = r.text
    except httpx.HTTPError as exc:
        LOGGER.debug("treasury-yields fetch failed: %s", exc)
        return []
    try:
        root = ET.fromstring(text)
    except ET.ParseError as exc:
        LOGGER.debug("treasury-yields xml parse failed: %s", exc)
        return []
    # The Treasury XML wraps entries in namespaces; match by local tag name.
    for entry in root.iter():
        tag = entry.tag.split("}")[-1]
        if tag != "entry":
            continue
        date_str = ""
        rates: dict[str, str] = {}
        for child in entry.iter():
            ctag = child.tag.split("}")[-1]
            if ctag == "updated" and child.text:
                date_str = child.text.strip()
            # Yield fields are named like "BC_1MONTH", "BC_10YEAR", etc.
            if ctag.startswith("BC_") and child.text:
                rates[ctag] = child.text.strip()
        published = _parse_dt(date_str)
        if published is None or published < since:
            continue
        if not rates:
            continue
        rate_pairs = ", ".join(f"{k.replace('BC_', '').replace('MONTH', 'mo').replace('YEAR', 'yr')}={v}" for k, v in sorted(rates.items()))
        raw_hash = event_hash("us-gov-api:treasury-yields", date_str[:10])
        out.append(
            Event(
                id=raw_hash[:16],
                source="us-gov-api:treasury-yields",
                source_url="https://home.treasury.gov/policy-issues/financing-the-government/interest-rate-statistics",
                published_at=published,
                title=f"Treasury yield curve {date_str[:10]}",
                content=_cap(f"US Treasury par yields for {date_str[:10]}: {rate_pairs}."),
                primary_entity_id=None,
                raw_hash=raw_hash,
            )
        )
    return out


# ---------------------------------------------------------------------------
# 3. CFPB consumer complaints (keyless)
# ---------------------------------------------------------------------------

CFPB_URL = "https://www.consumerfinance.gov/data-research/consumer-complaints/api/search"


def _fetch_cfpb_complaints(days: int) -> list[Event]:
    """Recent CFPB consumer complaints, filtered to finance-relevant products."""
    since = _now() - timedelta(days=min(days, 7))  # keep the window tight
    out: list[Event] = []
    try:
        r = httpx.post(
            CFPB_URL,
            json={
                "size": 50,
                "sort": [{"date_received": {"order": "desc"}}],
                "query": {
                    "bool": {
                        "must": [
                            {"range": {"date_received": {"gte": since.strftime("%Y-%m-%d")}}},
                            {"terms": {"product": ["Credit card", "Credit reporting", "Debt collection", "Mortgage", "Payday loan", "Student loan", "Prepaid card", "Money transfer"]}},
                        ]
                    }
                },
            },
            headers={"User-Agent": USER_AGENT, "Content-Type": "application/json"},
            timeout=TIMEOUT,
            follow_redirects=True,
        )
        r.raise_for_status()
        payload = r.json()
    except (httpx.HTTPError, ValueError) as exc:
        LOGGER.debug("cfpb-complaints fetch failed: %s", exc)
        return []
    hits = payload.get("hits", {}).get("hits", []) if isinstance(payload, dict) else []
    for hit in hits:
        src = hit.get("_source") if isinstance(hit, dict) else None
        if not isinstance(src, dict):
            continue
        comp_id = str(src.get("complaint_id") or hit.get("_id") or "").strip()
        date_str = str(src.get("date_received") or "").strip()
        published = _parse_dt(date_str)
        if published is None or published < since:
            continue
        product = str(src.get("product") or "").strip()
        issue = str(src.get("issue") or "").strip()
        company = str(src.get("company") or "").strip()
        state = str(src.get("state") or "").strip()
        narrative = str(src.get("complaint_what_happened") or "").strip()
        title = f"CFPB complaint: {product} — {issue}" + (f" ({company})" if company else "")
        content = _cap(
            f"Complaint {comp_id} received {date_str} against {company or 'unknown'} ({state}).\n"
            f"Product: {product}. Issue: {issue}.\n"
            f"{narrative}".strip()
        )
        raw_hash = event_hash("us-gov-api:cfpb-complaints", comp_id or f"{company}|{date_str}|{product}")
        out.append(
            Event(
                id=raw_hash[:16],
                source="us-gov-api:cfpb-complaints",
                source_url=f"https://www.consumerfinance.gov/data-research/consumer-complaints/search/detail/{comp_id}" if comp_id else "https://www.consumerfinance.gov/data-research/consumer-complaints/",
                published_at=published,
                title=title,
                content=content,
                primary_entity_id=None,
                raw_hash=raw_hash,
            )
        )
    return out


# ---------------------------------------------------------------------------
# 4. NIH Reporter (keyless)
# ---------------------------------------------------------------------------

NIH_URL = "https://api.reporter.nih.gov/v2/projects/search"


def _fetch_nih_reporter(days: int) -> list[Event]:
    """Recent NIH research grants in AI / tech / biotech."""
    since = _now() - timedelta(days=days)
    out: list[Event] = []
    try:
        r = httpx.post(
            NIH_URL,
            json={
                "criteria": {
                    "project_start_date": {"from_date": since.strftime("%Y-%m-%d")},
                    "project_title": ["artificial intelligence", "machine learning", "deep learning", "semiconductor", "biotechnology", "genomics", "quantum"],
                },
                "offset": 0,
                "limit": 50,
                "sort_field": "project_start_date",
                "sort_order": "desc",
            },
            headers={"User-Agent": USER_AGENT, "Content-Type": "application/json"},
            timeout=TIMEOUT,
            follow_redirects=True,
        )
        r.raise_for_status()
        payload = r.json()
    except (httpx.HTTPError, ValueError) as exc:
        LOGGER.debug("nih-reporter fetch failed: %s", exc)
        return []
    results = payload.get("results", []) if isinstance(payload, dict) else []
    for proj in results:
        if not isinstance(proj, dict):
            continue
        proj_id = str(proj.get("project_num") or proj.get("applied_id") or "").strip()
        title = str(proj.get("project_title") or "").strip()
        if not title:
            continue
        start_str = str(proj.get("project_start_date") or "").strip()
        published = _parse_dt(start_str) or _now()
        if published < since:
            continue
        institute = str(proj.get("org_name") or proj.get("agency_ic_admin") or "").strip()
        pi = ""
        pis = proj.get("principal_investigators") or []
        if isinstance(pis, list) and pis:
            first = pis[0]
            if isinstance(first, dict):
                pi = str(first.get("full_name") or first.get("pi_name") or "").strip()
            elif isinstance(first, str):
                pi = first.strip()
        funds = str(proj.get("award_amount") or "").strip()
        abstract = str(proj.get("abstract_text") or "").strip()
        content = _cap(
            f"NIH grant {proj_id}: {title}\n"
            f"Institute: {institute}. PI: {pi}. Award: ${funds}.\n"
            f"Start: {start_str}.\n{abstract}".strip()
        )
        raw_hash = event_hash("us-gov-api:nih-reporter", proj_id or f"{title}|{start_str}")
        out.append(
            Event(
                id=raw_hash[:16],
                source="us-gov-api:nih-reporter",
                source_url=f"https://reporter.nih.gov/project-details/{proj_id}" if proj_id else "https://reporter.nih.gov/",
                published_at=published,
                title=f"NIH grant: {title}" + (f" ({proj_id})" if proj_id else ""),
                content=content,
                primary_entity_id=None,
                raw_hash=raw_hash,
            )
        )
    return out


# ---------------------------------------------------------------------------
# 5. NSF awards (keyless)
# ---------------------------------------------------------------------------

NSF_URL = "https://api.nsf.gov/services/v1/awards.json"


def _fetch_nsf_awards(days: int) -> list[Event]:
    """Recent NSF research awards."""
    since = _now() - timedelta(days=days)
    out: list[Event] = []
    try:
        r = httpx.get(
            NSF_URL,
            params={
                "fundStartDate": since.strftime("%m/%d/%Y"),
                "rpp": 50,
            },
            headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
            timeout=TIMEOUT,
            follow_redirects=True,
        )
        r.raise_for_status()
        payload = r.json()
    except (httpx.HTTPError, ValueError) as exc:
        LOGGER.debug("nsf-awards fetch failed: %s", exc)
        return []
    awards = payload.get("response", {}).get("award", []) if isinstance(payload, dict) else []
    for aw in awards:
        if not isinstance(aw, dict):
            continue
        aw_id = str(aw.get("id") or "").strip()
        title = str(aw.get("title") or "").strip()
        if not title:
            continue
        date_str = str(aw.get("fundStartDate") or aw.get("startDate") or "").strip()
        published = _parse_dt(date_str.replace("/", "-")) or _now()
        if published < since:
            continue
        pi = str(aw.get("piFirstName") or "") + " " + str(aw.get("piLastName") or "")
        pi = pi.strip()
        inst = str(aw.get("org") or aw.get("awardeeName") or "").strip()
        funds = str(aw.get("fundsObligatedAmt") or aw.get("fundsObligated") or "").strip()
        abstract = str(aw.get("abstractText") or "").strip()
        content = _cap(
            f"NSF award {aw_id}: {title}\n"
            f"Institution: {inst}. PI: {pi}. Funds: ${funds}.\n"
            f"Start: {date_str}.\n{abstract}".strip()
        )
        raw_hash = event_hash("us-gov-api:nsf-awards", aw_id or f"{title}|{date_str}")
        out.append(
            Event(
                id=raw_hash[:16],
                source="us-gov-api:nsf-awards",
                source_url=f"https://www.nsf.gov/awardsearch/showAward?AWD_ID={aw_id}" if aw_id else "https://www.nsf.gov/awardsearch/",
                published_at=published,
                title=f"NSF award: {title}" + (f" ({aw_id})" if aw_id else ""),
                content=content,
                primary_entity_id=None,
                raw_hash=raw_hash,
            )
        )
    return out


# ---------------------------------------------------------------------------
# 6. USGS earthquakes (keyless GeoJSON)
# ---------------------------------------------------------------------------

USGS_URL = "https://earthquake.usgs.gov/fdsnws/event/1/query"


def _fetch_usgs_earthquakes(days: int) -> list[Event]:
    """Significant earthquakes (magnitude >= 4.5) in the lookback window."""
    since = _now() - timedelta(days=days)
    out: list[Event] = []
    try:
        r = httpx.get(
            USGS_URL,
            params={
                "format": "geojson",
                "starttime": since.strftime("%Y-%m-%d"),
                "minmagnitude": 4.5,
                "orderby": "time",
            },
            headers={"User-Agent": USER_AGENT, "Accept": "application/geo+json"},
            timeout=TIMEOUT,
            follow_redirects=True,
        )
        r.raise_for_status()
        payload = r.json()
    except (httpx.HTTPError, ValueError) as exc:
        LOGGER.debug("usgs-earthquakes fetch failed: %s", exc)
        return []
    features = payload.get("features", []) if isinstance(payload, dict) else []
    for feat in features:
        if not isinstance(feat, dict):
            continue
        props = feat.get("properties") or {}
        if not isinstance(props, dict):
            continue
        eq_id = str(feat.get("id") or props.get("code") or "").strip()
        mag = props.get("mag")
        place = str(props.get("place") or "").strip()
        title = str(props.get("title") or "").strip() or f"M{mag} earthquake {place}"
        ts = props.get("time")
        published = datetime.fromtimestamp(ts / 1000.0, tz=timezone.utc) if isinstance(ts, (int, float)) else None
        if published is None or published < since:
            continue
        url = str(props.get("url") or "").strip()
        alert = str(props.get("alert") or "").strip()
        tsunami = "yes" if props.get("tsunami") else "no"
        sig = str(props.get("sig") or "").strip()
        content = _cap(
            f"{title}\nMagnitude: {mag}. Place: {place}. "
            f"Significance: {sig}. Tsunami: {tsunami}. Alert: {alert or 'none'}."
        )
        raw_hash = event_hash("us-gov-api:usgs-earthquakes", eq_id or f"{title}|{published.isoformat()}")
        out.append(
            Event(
                id=raw_hash[:16],
                source="us-gov-api:usgs-earthquakes",
                source_url=url or "https://earthquake.usgs.gov/earthquakes/map/",
                published_at=published,
                title=title,
                content=content,
                primary_entity_id=None,
                raw_hash=raw_hash,
            )
        )
    return out


# ---------------------------------------------------------------------------
# 7. NOAA weather alerts (keyless)
# ---------------------------------------------------------------------------

NOAA_URL = "https://api.weather.gov/alerts/active"


def _fetch_noaa_weather(days: int) -> list[Event]:
    """Active NOAA weather alerts (only currently active ones are returned)."""
    out: list[Event] = []
    try:
        r = httpx.get(
            NOAA_URL,
            headers={"User-Agent": USER_AGENT, "Accept": "application/geo+json"},
            timeout=TIMEOUT,
            follow_redirects=True,
        )
        r.raise_for_status()
        payload = r.json()
    except (httpx.HTTPError, ValueError) as exc:
        LOGGER.debug("noaa-weather fetch failed: %s", exc)
        return []
    features = payload.get("features", []) if isinstance(payload, dict) else []
    for feat in features:
        if not isinstance(feat, dict):
            continue
        props = feat.get("properties") or {}
        if not isinstance(props, dict):
            continue
        alert_id = str(props.get("id") or feat.get("id") or "").strip()
        event = str(props.get("event") or "").strip()
        headline = str(props.get("headlineText") or "").strip()
        area = str(props.get("areaDesc") or "").strip()
        if not event and not headline:
            continue
        published = _parse_dt(props.get("sent") or props.get("effective"))
        if published is None:
            published = _now()
        title = headline or f"{event}: {area}" if area else (headline or event)
        description = str(props.get("description") or "").strip()
        severity = str(props.get("severity") or "").strip()
        certainty = str(props.get("certainty") or "").strip()
        content = _cap(
            f"{event} — {area}\nSeverity: {severity}. Certainty: {certainty}.\n{description}".strip()
        )
        raw_hash = event_hash("us-gov-api:noaa-weather", alert_id or f"{event}|{area}|{published.isoformat()}")
        out.append(
            Event(
                id=raw_hash[:16],
                source="us-gov-api:noaa-weather",
                source_url=str(props.get("web") or "https://www.weather.gov/"),
                published_at=published,
                title=title,
                content=content,
                primary_entity_id=None,
                raw_hash=raw_hash,
            )
        )
    return out


# ---------------------------------------------------------------------------
# 8. BEA (key-gated: BEA_API_KEY)
# ---------------------------------------------------------------------------

BEA_URL = "https://apps.bea.gov/api/data"


def _fetch_bea(days: int) -> list[Event]:
    """BEA GDP + personal income (requires BEA_API_KEY)."""
    key = os.environ.get("BEA_API_KEY")
    if not key:
        LOGGER.debug("bea skipped: BEA_API_KEY is not set")
        return []
    since = _now() - timedelta(days=days)
    out: list[Event] = []
    datasets = [
        ("NIPA", "T10101", "GDP"),       # Table 1.1.1 — percent change in GDP
        ("NIPA", "T20304", "Personal Income"),  # personal income
    ]
    for dataset, table, label in datasets:
        try:
            r = httpx.get(
                BEA_URL,
                params={
                    "UserID": key,
                    "method": "GetData",
                    "DatasetName": dataset,
                    "TableName": table,
                    "Year": "LAST",
                    "ResultFormat": "JSON",
                },
                headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
                timeout=TIMEOUT,
                follow_redirects=True,
            )
            r.raise_for_status()
            payload = r.json()
        except (httpx.HTTPError, ValueError) as exc:
            LOGGER.debug("bea %s fetch failed: %s", label, exc)
            continue
        data = payload.get("BEAAPI", {}).get("Results", {}).get("Data", []) if isinstance(payload, dict) else []
        for row in data:
            if not isinstance(row, dict):
                continue
            value = str(row.get("DataValue") or "").strip()
            period = str(row.get("LineNumber") or row.get("Period") or "").strip()
            year = str(row.get("Year") or "").strip()
            period_full = str(row.get("LineDescription") or row.get("Period") or "").strip()
            if not value or not year:
                continue
            published = _parse_dt(f"{year}-01-01") or _now()
            if published < since:
                continue
            raw_hash = event_hash("us-gov-api:bea", label, year, period)
            out.append(
                Event(
                    id=raw_hash[:16],
                    source="us-gov-api:bea",
                    source_url="https://www.bea.gov/data/gdp/gross-domestic-product",
                    published_at=published,
                    title=f"BEA {label}: {period_full} {year} = {value}",
                    content=_cap(f"BEA {label} — {period_full} for {year}: {value}."),
                    primary_entity_id=None,
                    raw_hash=raw_hash,
                )
            )
    return out


# ---------------------------------------------------------------------------
# 9. Census (key-gated: CENSUS_API_KEY)
# ---------------------------------------------------------------------------

CENSUS_URL = "https://api.census.gov/data/timeseries/eits"


def _fetch_census(days: int) -> list[Event]:
    """Census retail sales + business formations (requires CENSUS_API_KEY)."""
    key = os.environ.get("CENSUS_API_KEY")
    if not key:
        LOGGER.debug("census skipped: CENSUS_API_KEY is not set")
        return []
    since = _now() - timedelta(days=days)
    out: list[Event] = []
    programs = [
        ("mart", "MART", "Retail sales"),       # Monthly retail trade
        ("bfs", "BFS", "Business formations"),  # Business formation stats
    ]
    for prog_code, program, label in programs:
        try:
            r = httpx.get(
                CENSUS_URL,
                params={
                    "program_code": prog_code,
                    "time_sequence_code": "1",
                    "category_code": "TOTAL",
                    "get": "cell_value,time_slot_id,error_data",
                    "key": key,
                },
                headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
                timeout=TIMEOUT,
                follow_redirects=True,
            )
            r.raise_for_status()
            rows = r.json()
        except (httpx.HTTPError, ValueError) as exc:
            LOGGER.debug("census %s fetch failed: %s", label, exc)
            continue
        if not isinstance(rows, list) or len(rows) < 2:
            continue
        header = rows[0]
        for row in rows[1:]:
            if not isinstance(row, list) or len(row) != len(header):
                continue
            rec = dict(zip(header, row))
            value = str(rec.get("cell_value") or "").strip()
            time_slot = str(rec.get("time_slot_id") or "").strip()
            if not value or not time_slot:
                continue
            # time_slot_id like "2023-01"
            published = _parse_dt(time_slot) or _now()
            if published < since:
                continue
            raw_hash = event_hash("us-gov-api:census", program, time_slot)
            out.append(
                Event(
                    id=raw_hash[:16],
                    source="us-gov-api:census",
                    source_url="https://www.census.gov/economic-indicators/",
                    published_at=published,
                    title=f"Census {label}: {time_slot} = {value}",
                    content=_cap(f"Census {label} ({program}) for {time_slot}: {value}."),
                    primary_entity_id=None,
                    raw_hash=raw_hash,
                )
            )
    return out


# ---------------------------------------------------------------------------
# 10. Congress.gov (key-gated: CONGRESS_API_KEY)
# ---------------------------------------------------------------------------

CONGRESS_URL = "https://api.congress.gov/v3/bill"


def _fetch_congress(days: int) -> list[Event]:
    """Recent bills from Congress.gov (requires CONGRESS_API_KEY)."""
    key = os.environ.get("CONGRESS_API_KEY")
    if not key:
        LOGGER.debug("congress skipped: CONGRESS_API_KEY is not set")
        return []
    since = _now() - timedelta(days=days)
    out: list[Event] = []
    try:
        r = httpx.get(
            CONGRESS_URL,
            params={
                "api_key": key,
                "sort": "updateDate desc",
                "limit": 50,
            },
            headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
            timeout=TIMEOUT,
            follow_redirects=True,
        )
        r.raise_for_status()
        payload = r.json()
    except (httpx.HTTPError, ValueError) as exc:
        LOGGER.debug("congress fetch failed: %s", exc)
        return []
    bills = payload.get("bills", []) if isinstance(payload, dict) else []
    for bill in bills:
        if not isinstance(bill, dict):
            continue
        congress_num = str(bill.get("congress") or "").strip()
        bill_type = str(bill.get("type") or "").strip()
        number = str(bill.get("number") or "").strip()
        title = str(bill.get("title") or "").strip()
        if not title:
            continue
        date_str = str(bill.get("latestAction", {}).get("actionDate") or bill.get("updateDate") or "").strip()
        published = _parse_dt(date_str) or _now()
        if published < since:
            continue
        action = str(bill.get("latestAction", {}).get("text") or "").strip()
        sponsor = str(bill.get("sponsor", {}).get("fullName") or "").strip()
        bill_slug = f"{bill_type}{number}-{congress_num}" if bill_type and number else f"{congress_num}"
        content = _cap(
            f"Congress bill {bill_slug}: {title}\n"
            f"Sponsor: {sponsor or 'unknown'}. Latest action ({date_str}): {action}".strip()
        )
        raw_hash = event_hash("us-gov-api:congress", bill_slug, date_str)
        out.append(
            Event(
                id=raw_hash[:16],
                source="us-gov-api:congress",
                source_url=f"https://www.congress.gov/bill/{congress_num}th-congress/{bill_type.lower()}/{number}" if bill_type and number else "https://www.congress.gov/",
                published_at=published,
                title=f"Congress: {title}" + (f" ({bill_slug})" if bill_type and number else ""),
                content=content,
                primary_entity_id=None,
                raw_hash=raw_hash,
            )
        )
    return out


# ---------------------------------------------------------------------------
# 11. FEC openFEC (key-gated: FEC_API_KEY)
# ---------------------------------------------------------------------------

FEC_URL = "https://api.open.fec.gov/v1/schedules/schedule_e/"


def _fetch_fec(days: int) -> list[Event]:
    """Recent FEC independent expenditures (requires FEC_API_KEY)."""
    key = os.environ.get("FEC_API_KEY")
    if not key:
        LOGGER.debug("fec skipped: FEC_API_KEY is not set")
        return []
    since = _now() - timedelta(days=days)
    out: list[Event] = []
    try:
        r = httpx.get(
            FEC_URL,
            params={
                "api_key": key,
                "min_date": since.strftime("%Y-%m-%d"),
                "sort": "expenditure_date",
                "sort_hide_null": "true",
                "per_page": 50,
            },
            headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
            timeout=TIMEOUT,
            follow_redirects=True,
        )
        r.raise_for_status()
        payload = r.json()
    except (httpx.HTTPError, ValueError) as exc:
        LOGGER.debug("fec fetch failed: %s", exc)
        return []
    results = payload.get("results", []) if isinstance(payload, dict) else []
    for item in results:
        if not isinstance(item, dict):
            continue
        date_str = str(item.get("expenditure_date") or item.get("date") or "").strip()
        published = _parse_dt(date_str) or _now()
        if published < since:
            continue
        payee = str(item.get("payee_name") or "").strip()
        committee = str(item.get("committee", {}).get("name") or "").strip()
        candidate = str(item.get("candidate_name") or "").strip()
        amount = str(item.get("expenditure_amount") or item.get("total") or "").strip()
        support_oppose = str(item.get("support_oppose_indicator") or "").strip()
        memo = str(item.get("memo_text") or "").strip()
        title = f"FEC independent expenditure: ${amount} to {payee}" + (f" ({support_oppose} {candidate})" if candidate else "")
        content = _cap(
            f"FEC Schedule E — {date_str}\n"
            f"Payee: {payee}. Committee: {committee}. Candidate: {candidate}.\n"
            f"Amount: ${amount}. Support/Oppose: {support_oppose or 'n/a'}.\n{memo}".strip()
        )
        raw_hash = event_hash("us-gov-api:fec", payee, date_str, str(amount))
        out.append(
            Event(
                id=raw_hash[:16],
                source="us-gov-api:fec",
                source_url="https://www.fec.gov/data/independent-expenditures/",
                published_at=published,
                title=title,
                content=content,
                primary_entity_id=None,
                raw_hash=raw_hash,
            )
        )
    return out


# ---------------------------------------------------------------------------
# 12. Senate LDA lobbying (free-key or keyless)
# ---------------------------------------------------------------------------

LDA_URL = "https://lda.gov/api/v1/filings"


def _fetch_lda(days: int) -> list[Event]:
    """Recent lobbying registrations from the Senate LDA API."""
    key = os.environ.get("LDA_API_KEY")  # optional — endpoint is keyless but key lifts limits
    since = _now() - timedelta(days=days)
    out: list[Event] = []
    headers = {"User-Agent": USER_AGENT, "Accept": "application/json"}
    if key:
        headers["Authorization"] = f"Token {key}"
    try:
        r = httpx.get(
            LDA_URL,
            params={
                "filed_after": since.strftime("%Y-%m-%d"),
                "ordering": "-filed_date",
                "page_size": 50,
            },
            headers=headers,
            timeout=TIMEOUT,
            follow_redirects=True,
        )
        r.raise_for_status()
        payload = r.json()
    except (httpx.HTTPError, ValueError) as exc:
        LOGGER.debug("lda fetch failed: %s", exc)
        return []
    results = payload.get("results", []) if isinstance(payload, dict) else []
    for item in results:
        if not isinstance(item, dict):
            continue
        date_str = str(item.get("filed_date") or item.get("dt_posted") or "").strip()
        published = _parse_dt(date_str) or _now()
        if published < since:
            continue
        registrant = str(item.get("registrant", {}).get("name") or item.get("registrant_name") or "").strip()
        client = str(item.get("client", {}).get("name") or item.get("client_name") or "").strip()
        filing_id = str(item.get("id") or item.get("filing_id") or "").strip()
        lobbying_issues = item.get("lobbying_activities") or item.get("lobbying_issues") or []
        issue_topics: list[str] = []
        if isinstance(lobbying_issues, list):
            for li in lobbying_issues[:5]:
                if isinstance(li, dict):
                    code = str(li.get("general_issue_code") or li.get("general_issue_code_display") or "").strip()
                    if code:
                        issue_topics.append(code)
        title = f"LDA filing: {registrant} → {client}" + (f" ({filing_id})" if filing_id else "")
        content = _cap(
            f"Senate LDA filing {filing_id} — filed {date_str}\n"
            f"Registrant: {registrant}. Client: {client}.\n"
            f"Issues: {', '.join(issue_topics) if issue_topics else 'n/a'}."
        )
        raw_hash = event_hash("us-gov-api:lda", filing_id or f"{registrant}|{client}|{date_str}")
        out.append(
            Event(
                id=raw_hash[:16],
                source="us-gov-api:lda",
                source_url=f"https://lda.gov/filing/{filing_id}" if filing_id else "https://lda.gov/",
                published_at=published,
                title=title,
                content=content,
                primary_entity_id=None,
                raw_hash=raw_hash,
            )
        )
    return out


# ---------------------------------------------------------------------------
# 13. FDA openFDA adverse drug events (free-key or keyless)
# ---------------------------------------------------------------------------

FDA_URL = "https://api.fda.gov/drug/event.json"


def _fetch_fda(days: int) -> list[Event]:
    """Recent FDA adverse drug events (keyless; FDA_API_KEY lifts rate limits)."""
    key = os.environ.get("FDA_API_KEY")  # optional
    since = _now() - timedelta(days=min(days, 14))  # adverse-event API window is tight
    out: list[Event] = []
    params: dict[str, Any] = {
        "limit": 25,
        "search": f"receivedate:[{since.strftime('%Y%m%d')}+TO+{_now().strftime('%Y%m%d')}]",
    }
    if key:
        params["api_key"] = key
    try:
        r = httpx.get(
            FDA_URL,
            params=params,
            headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
            timeout=TIMEOUT,
            follow_redirects=True,
        )
        r.raise_for_status()
        payload = r.json()
    except (httpx.HTTPError, ValueError) as exc:
        LOGGER.debug("fda fetch failed: %s", exc)
        return []
    results = payload.get("results", []) if isinstance(payload, dict) else []
    for item in results:
        if not isinstance(item, dict):
            continue
        safety_id = str(item.get("safetyreportid") or "").strip()
        receive_date = str(item.get("receivedate") or "").strip()
        published = _parse_dt(receive_date) or _now()
        if published < since:
            continue
        patient = item.get("patient") if isinstance(item.get("patient"), dict) else {}
        drugs = patient.get("drug") if isinstance(patient.get("drug"), list) else []
        drug_names = []
        for d in drugs[:5]:
            if isinstance(d, dict):
                name = str(d.get("medicinalproduct") or d.get("openfda", {}).get("brand_name", [""])[0] if isinstance(d.get("openfda"), dict) else "").strip()
                if name:
                    drug_names.append(name)
        reactions = patient.get("reaction") if isinstance(patient.get("reaction"), list) else []
        reaction_terms = []
        for rx in reactions[:5]:
            if isinstance(rx, dict):
                term = str(rx.get("reactionmeddrapt") or "").strip()
                if term:
                    reaction_terms.append(term)
        serious = str(item.get("serious") or "").strip()
        title = f"FDA adverse event: {', '.join(drug_names[:2]) or 'unknown drug'}" + (f" ({safety_id})" if safety_id else "")
        content = _cap(
            f"FDA adverse event {safety_id} — received {receive_date}\n"
            f"Serious: {'yes' if serious == '1' else 'no'}.\n"
            f"Drugs: {', '.join(drug_names) or 'n/a'}.\n"
            f"Reactions: {', '.join(reaction_terms) or 'n/a'}."
        )
        raw_hash = event_hash("us-gov-api:fda", safety_id or f"{receive_date}|{','.join(drug_names)}")
        out.append(
            Event(
                id=raw_hash[:16],
                source="us-gov-api:fda",
                source_url="https://open.fda.gov/data/downloads/",
                published_at=published,
                title=title,
                content=content,
                primary_entity_id=None,
                raw_hash=raw_hash,
            )
        )
    return out


# ---------------------------------------------------------------------------
# 14. USDA NASS agricultural stats (key-gated: USDA_NASS_API_KEY)
# ---------------------------------------------------------------------------

USDA_NASS_URL = "https://quickstats.nass.usda.gov/api/api_GET/"


def _fetch_usda_nass(days: int) -> list[Event]:
    """USDA NASS Quick Stats (requires USDA_NASS_API_KEY)."""
    key = os.environ.get("USDA_NASS_API_KEY")
    if not key:
        LOGGER.debug("usda-nass skipped: USDA_NASS_API_KEY is not set")
        return []
    since = _now() - timedelta(days=days)
    out: list[Event] = []
    try:
        r = httpx.get(
            USDA_NASS_URL,
            params={
                "key": key,
                "source_desc": "SURVEY",
                "group_desc": "CROPS",
                "statisticcat_desc": "PRODUCTION",
                "agg_level_desc": "NATIONAL",
                "year": _now().year,
                "format": "JSON",
            },
            headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
            timeout=TIMEOUT,
            follow_redirects=True,
        )
        r.raise_for_status()
        payload = r.json()
    except (httpx.HTTPError, ValueError) as exc:
        LOGGER.debug("usda-nass fetch failed: %s", exc)
        return []
    data = payload.get("data", []) if isinstance(payload, dict) else []
    for row in data:
        if not isinstance(row, dict):
            continue
        commodity = str(row.get("commodity_desc") or "").strip()
        value = str(row.get("Value") or "").strip()
        year = str(row.get("year") or "").strip()
        freq = str(row.get("freq_desc") or "").strip()
        period = str(row.get("period_desc") or "").strip()
        unit = str(row.get("unit_desc") or "").strip()
        if not commodity or not value or not year:
            continue
        published = _parse_dt(f"{year}-01-01") or _now()
        if published < since:
            continue
        raw_hash = event_hash("us-gov-api:usda-nass", commodity, year, period)
        out.append(
            Event(
                id=raw_hash[:16],
                source="us-gov-api:usda-nass",
                source_url="https://quickstats.nass.usda.gov/",
                published_at=published,
                title=f"USDA NASS: {commodity} {period} {year} = {value} {unit}".strip(),
                content=_cap(f"USDA NASS — {commodity} production, {freq} {period} {year}: {value} {unit}."),
                primary_entity_id=None,
                raw_hash=raw_hash,
            )
        )
    return out


# ---------------------------------------------------------------------------
# Aggregate
# ---------------------------------------------------------------------------

_SUB_FETCHERS = [
    _fetch_cftc_cot,
    _fetch_treasury_yields,
    _fetch_cfpb_complaints,
    _fetch_nih_reporter,
    _fetch_nsf_awards,
    _fetch_usgs_earthquakes,
    _fetch_noaa_weather,
    _fetch_bea,
    _fetch_census,
    _fetch_congress,
    _fetch_fec,
    _fetch_lda,
    _fetch_fda,
    _fetch_usda_nass,
]


def fetch_all(days: int = 30) -> list[Event]:
    """Run every US-gov-API sub-fetcher and concatenate results.

    Keyless sources always run. Key-gated sources skip silently (debug log)
    when their env var is missing, mirroring ``bls.py`` / ``eia.py``.
    Failures in one sub-source are logged and skipped; the others still run.
    """
    out: list[Event] = []
    for fetcher in _SUB_FETCHERS:
        try:
            out.extend(fetcher(days))
        except Exception as exc:  # noqa: BLE001 — third-party network calls
            LOGGER.warning("%s fetch failed: %s", fetcher.__name__, exc)
    return out
