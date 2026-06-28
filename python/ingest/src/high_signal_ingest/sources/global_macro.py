"""Global macroeconomic data adapters — keyless international statistical APIs.

Covers four sub-sources, all accessible without an API key:
  * IMF — International Financial Statistics (SDMX/JSON)
  * World Bank — World Development Indicators (JSON)
  * BIS — Bank for International Settlements effective exchange rates (SDMX)
  * UN Comtrade — bilateral trade statistics (free preview endpoint)

This source produces macro context events only. It does not fetch equity,
ETF, index, or crypto prices.
"""

from __future__ import annotations

import logging
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone

import httpx

from ..types import Event
from ..utils import event_hash


USER_AGENT = "high-signal/0.1 global-macro-ingest"
LOGGER = logging.getLogger(__name__)

CONTENT_CAP = 20_000

# ---------------------------------------------------------------------------
# IMF — International Financial Statistics (SDMX/JSON, keyless)
# Rate limit: 10 requests per 5-second window per IP.
# Endpoint: https://dataservices.imf.org/REST/SDMX_JSON.svc/CompactData/IFS/
#           {freq}.{country}.{indicator1+indicator2+...}?startPeriod=&endPeriod=
# ---------------------------------------------------------------------------

IMF_BASE = "https://dataservices.imf.org/REST/SDMX_JSON.svc/CompactData/IFS"
# Curated IFS series for US + India — GDP, CPI, monetary policy rate.
IMF_INDICATORS: dict[str, str] = {
    "NGDP_XDC": "GDP, nominal (domestic currency)",
    "NGDP_R_XDC": "GDP, real (domestic currency)",
    "PCPI_IX": "CPI, index",
    "FPOLM_PA": "Monetary policy rate",
}
IMF_COUNTRIES: dict[str, str] = {
    "US": "United States",
    "IN": "India",
}


def _parse_period(period: str) -> datetime | None:
    """Parse an IMF/World Bank/BIS/Comtrade period string into a UTC datetime.

    Handles annual (``2024``), monthly (``2024-01``), and quarterly
    (``2024-Q1``) forms. Returns None on failure.
    """
    period = (period or "").strip()
    if not period:
        return None
    # Annual: "2024"
    if period.isdigit() and len(period) == 4:
        try:
            return datetime(int(period), 1, 1, tzinfo=timezone.utc)
        except ValueError:
            return None
    # Quarterly: "2024-Q1"
    if "-Q" in period:
        year_str, q_str = period.split("-Q", 1)
        try:
            year = int(year_str)
            quarter = int(q_str)
            month = (quarter - 1) * 3 + 1
            return datetime(year, month, 1, tzinfo=timezone.utc)
        except (ValueError, IndexError):
            return None
    # Monthly: "2024-01" or date "2024-01-15"
    for candidate in (period[:7], period[:10]):
        try:
            dt = datetime.fromisoformat(candidate)
            return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)
        except ValueError:
            continue
    return None


def _imf_start_period(days: int) -> str:
    """Compute the IMF startPeriod (YYYY-MM) for the given lookback window."""
    since = datetime.now(timezone.utc) - timedelta(days=days)
    return since.strftime("%Y-%m")


def _imf_end_period() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m")


def imf_events_from_json(payload: dict) -> list[Event]:
    """Parse an IMF SDMX/JSON CompactData response into Events."""
    out: list[Event] = []
    try:
        data_set = payload["CompactData"]["DataSet"]
    except (KeyError, TypeError):
        LOGGER.debug("imf: no DataSet in response")
        return out

    series_list = data_set.get("Series", [])
    if isinstance(series_list, dict):
        series_list = [series_list]

    for series in series_list:
        indicator = series.get("@INDICATOR", "")
        ref_area = series.get("@REF_AREA", "")
        indicator_label = IMF_INDICATORS.get(indicator, indicator)
        country_label = IMF_COUNTRIES.get(ref_area, ref_area)

        obs_list = series.get("Obs", [])
        if isinstance(obs_list, dict):
            obs_list = [obs_list]

        for obs in obs_list:
            time_period = obs.get("@TIME_PERIOD", "")
            obs_value = obs.get("@OBS_VALUE", "")
            if not time_period or not obs_value:
                continue
            published = _parse_period(time_period)
            if published is None:
                continue
            raw_hash = event_hash("global-macro:imf", ref_area, indicator, time_period, obs_value)
            title = f"IMF IFS {country_label} {indicator_label}: {obs_value} ({time_period})"
            content = (
                f"IMF International Financial Statistics — {country_label} ({ref_area})\n"
                f"Indicator: {indicator_label} [{indicator}]\n"
                f"Period: {time_period}\n"
                f"Value: {obs_value}\n"
            )[:CONTENT_CAP]
            out.append(
                Event(
                    id=raw_hash[:16],
                    source="global-macro:imf",
                    source_url=f"{IMF_BASE}/M.{ref_area}.{indicator}?startPeriod={time_period}&endPeriod={time_period}",
                    published_at=published,
                    title=title,
                    content=content,
                    primary_entity_id=None,
                    raw_hash=raw_hash,
                )
            )
    return out


def _fetch_imf(days: int = 30) -> list[Event]:
    """Fetch curated IFS series for US + India from the IMF Data API."""
    start_period = _imf_start_period(days)
    end_period = _imf_end_period()
    indicator_codes = "+".join(IMF_INDICATORS.keys())
    out: list[Event] = []

    with httpx.Client(
        headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
        timeout=25.0,
        follow_redirects=True,
    ) as client:
        for country_code in IMF_COUNTRIES:
            url = f"{IMF_BASE}/M.{country_code}.{indicator_codes}"
            try:
                response = client.get(
                    url,
                    params={"startPeriod": start_period, "endPeriod": end_period},
                )
                response.raise_for_status()
            except httpx.HTTPError as exc:
                LOGGER.debug("imf fetch failed country=%s error=%s", country_code, exc)
                continue
            try:
                payload = response.json()
            except ValueError as exc:
                LOGGER.debug("imf json decode failed country=%s error=%s", country_code, exc)
                continue
            out.extend(imf_events_from_json(payload))
    return out


# ---------------------------------------------------------------------------
# World Bank — World Development Indicators (JSON, keyless)
# Endpoint: https://api.worldbank.org/v2/country/{country}/indicator/{code}
#           ?format=json&date={start}:{end}&per_page=50
# ---------------------------------------------------------------------------

WORLDBANK_BASE = "https://api.worldbank.org/v2/country"
# Curated set of ~10 key indicators for US + India.
WORLDBANK_INDICATORS: dict[str, str] = {
    "NY.GDP.MKTP.CD": "GDP (current US$)",
    "NY.GDP.PCAP.CD": "GDP per capita (current US$)",
    "NY.GDP.MKTP.KD.ZG": "GDP growth (annual %)",
    "FP.CPI.TOTL.ZG": "Inflation, consumer prices (annual %)",
    "SL.UEM.TOTL.ZS": "Unemployment, total (% of total labor force)",
    "NE.TRD.GNFS.ZS": "Trade (% of GDP)",
    "NE.EXP.GNFS.ZS": "Exports of goods and services (% of GDP)",
    "NE.IMP.GNFS.ZS": "Imports of goods and services (% of GDP)",
    "SP.POP.TOTL": "Population, total",
    "FR.INR.RINR": "Real interest rate (%)",
}
WORLDBANK_COUNTRIES: dict[str, str] = {
    "US": "United States",
    "IN": "India",
}


def worldbank_events_from_json(payload: list, indicator_code: str, country_code: str) -> list[Event]:
    """Parse a World Bank API JSON response (a 2-element list) into Events."""
    out: list[Event] = []
    if not isinstance(payload, list) or len(payload) < 2:
        return out
    records = payload[1]
    if not isinstance(records, list):
        return out

    indicator_label = WORLDBANK_INDICATORS.get(indicator_code, indicator_code)
    country_label = WORLDBANK_COUNTRIES.get(country_code, country_code)

    for record in records:
        value = record.get("value")
        date_value = record.get("date", "")
        if value is None:
            continue
        published = _parse_period(str(date_value))
        if published is None:
            continue
        raw_hash = event_hash("global-macro:worldbank", country_code, indicator_code, str(date_value), str(value))
        title = f"World Bank {country_label} {indicator_label}: {value} ({date_value})"
        content = (
            f"World Bank World Development Indicators — {country_label} ({country_code})\n"
            f"Indicator: {indicator_label} [{indicator_code}]\n"
            f"Year: {date_value}\n"
            f"Value: {value}\n"
        )[:CONTENT_CAP]
        out.append(
            Event(
                id=raw_hash[:16],
                source="global-macro:worldbank",
                source_url=f"{WORLDBANK_BASE}/{country_code}/indicator/{indicator_code}?format=json&date={date_value}",
                published_at=published,
                title=title,
                content=content,
                primary_entity_id=None,
                raw_hash=raw_hash,
            )
        )
    return out


def _fetch_worldbank(days: int = 30) -> list[Event]:
    """Fetch curated World Bank indicators for US + India.

    World Bank data is annual, so we fetch the last few years regardless of
    the ``days`` window to ensure we capture the latest available values.
    """
    current_year = datetime.now(timezone.utc).year
    start_year = current_year - 3  # last 4 years to catch latest published
    date_range = f"{start_year}:{current_year}"
    out: list[Event] = []

    with httpx.Client(
        headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
        timeout=25.0,
        follow_redirects=True,
    ) as client:
        for country_code in WORLDBANK_COUNTRIES:
            for indicator_code in WORLDBANK_INDICATORS:
                url = f"{WORLDBANK_BASE}/{country_code}/indicator/{indicator_code}"
                try:
                    response = client.get(
                        url,
                        params={
                            "format": "json",
                            "date": date_range,
                            "per_page": 50,
                        },
                    )
                    response.raise_for_status()
                except httpx.HTTPError as exc:
                    LOGGER.debug(
                        "worldbank fetch failed country=%s indicator=%s error=%s",
                        country_code,
                        indicator_code,
                        exc,
                    )
                    continue
                try:
                    payload = response.json()
                except ValueError as exc:
                    LOGGER.debug(
                        "worldbank json decode failed country=%s indicator=%s error=%s",
                        country_code,
                        indicator_code,
                        exc,
                    )
                    continue
                out.extend(worldbank_events_from_json(payload, indicator_code, country_code))
    return out


# ---------------------------------------------------------------------------
# BIS — Bank for International Settlements (SDMX REST, keyless)
# Endpoint: https://stats.bis.org/api/v1/data/{flow}/{key}/all
#   Effective exchange rates:  flow=WS_EER,  key=M.N.B.{country}
#   Central bank policy rate:  flow=WS_CBPOL, key=M.{country}
# The API returns SDMX 2.1 XML by default; we parse the structure-specific
# XML for <Obs TIME_PERIOD="..." OBS_VALUE="..."/> elements.
# ---------------------------------------------------------------------------

BIS_BASE = "https://stats.bis.org/api/v1/data"
BIS_EER_FLOW = "WS_EER"
BIS_CBPOL_FLOW = "WS_CBPOL"
BIS_COUNTRIES: dict[str, str] = {
    "US": "United States",
    "IN": "India",
}


def bis_events_from_xml(
    xml_text: str,
    flow: str,
    country_code: str,
    series_key: str,
) -> list[Event]:
    """Parse a BIS SDMX 2.1 structure-specific XML response into Events."""
    out: list[Event] = []
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError as exc:
        LOGGER.debug("bis xml parse failed flow=%s error=%s", flow, exc)
        return out

    country_label = BIS_COUNTRIES.get(country_code, country_code)
    flow_label = "Effective exchange rate (nominal, broad)" if flow == BIS_EER_FLOW else "Central bank policy rate"
    source_tag = "global-macro:bis"

    # In SDMX 2.1 structure-specific data, observations are <Obs> elements
    # with TIME_PERIOD and OBS_VALUE attributes, nested inside <Series>.
    for series in root.iter():
        if not series.tag.endswith("Series") and "Series" not in series.tag:
            continue
        # Extract the REF_AREA or country from series attributes if present
        series_area = series.attrib.get("REF_AREA", country_code)

        for obs in series:
            time_period = obs.attrib.get("TIME_PERIOD", "")
            obs_value = obs.attrib.get("OBS_VALUE", "")
            if not time_period or not obs_value:
                continue
            published = _parse_period(time_period)
            if published is None:
                continue
            raw_hash = event_hash(source_tag, flow, series_area, time_period, obs_value)
            title = f"BIS {country_label} {flow_label}: {obs_value} ({time_period})"
            content = (
                f"BIS — Bank for International Settlements\n"
                f"Country: {country_label} ({series_area})\n"
                f"Series: {flow_label} [{flow} / {series_key}]\n"
                f"Period: {time_period}\n"
                f"Value: {obs_value}\n"
            )[:CONTENT_CAP]
            out.append(
                Event(
                    id=raw_hash[:16],
                    source=source_tag,
                    source_url=f"{BIS_BASE}/{flow}/{series_key}/all?startPeriod={time_period}&endPeriod={time_period}",
                    published_at=published,
                    title=title,
                    content=content,
                    primary_entity_id=None,
                    raw_hash=raw_hash,
                )
            )
    return out


def _fetch_bis(days: int = 30) -> list[Event]:
    """Fetch BIS effective exchange rates and policy rates for US + India."""
    start_period = _imf_start_period(days)  # same YYYY-MM format works for BIS
    out: list[Event] = []

    with httpx.Client(
        headers={"User-Agent": USER_AGENT, "Accept": "application/vnd.sdmx.structurespecificdata+xml;version=2.1"},
        timeout=25.0,
        follow_redirects=True,
    ) as client:
        for country_code in BIS_COUNTRIES:
            # Effective exchange rates: M.N.B.{country} (monthly, nominal, broad)
            eer_key = f"M.N.B.{country_code}"
            try:
                response = client.get(
                    f"{BIS_BASE}/{BIS_EER_FLOW}/{eer_key}/all",
                    params={"startPeriod": start_period},
                )
                response.raise_for_status()
            except httpx.HTTPError as exc:
                LOGGER.debug("bis eer fetch failed country=%s error=%s", country_code, exc)
            else:
                out.extend(bis_events_from_xml(response.text, BIS_EER_FLOW, country_code, eer_key))

            # Central bank policy rate: M.{country}
            cbpol_key = f"M.{country_code}"
            try:
                response = client.get(
                    f"{BIS_BASE}/{BIS_CBPOL_FLOW}/{cbpol_key}/all",
                    params={"startPeriod": start_period},
                )
                response.raise_for_status()
            except httpx.HTTPError as exc:
                LOGGER.debug("bis cbpol fetch failed country=%s error=%s", country_code, exc)
            else:
                out.extend(bis_events_from_xml(response.text, BIS_CBPOL_FLOW, country_code, cbpol_key))
    return out


# ---------------------------------------------------------------------------
# UN Comtrade — bilateral trade statistics (free preview, keyless)
# Preview endpoint: https://comtradeapi.un.org/public/v1/preview/C/A/HS
#   ?reporterCode={reporter}&partnerCode={partner}&flowCode={flow}&period={year}
# Returns up to 500 records. No API key required for preview access.
# M49 codes: India = 699, United States = 842
# ---------------------------------------------------------------------------

COMTRADE_BASE = "https://comtradeapi.un.org/public/v1/preview/C/A/HS"
COMTRADE_INDIA_CODE = "699"
COMTRADE_US_CODE = "842"


def comtrade_events_from_json(payload: dict, reporter_code: str, partner_code: str) -> list[Event]:
    """Parse a UN Comtrade preview JSON response into Events."""
    out: list[Event] = []
    if not isinstance(payload, dict):
        return out
    data = payload.get("data", [])
    if not isinstance(data, list):
        return []

    reporter_label = "India" if reporter_code == COMTRADE_INDIA_CODE else "United States"
    partner_label = "United States" if partner_code == COMTRADE_US_CODE else "India"

    for record in data:
        period = str(record.get("period", ""))
        flow_code = record.get("flowCode", "")
        flow_desc = record.get("flowDesc", flow_code)
        cmd_code = record.get("cmdCode", "")
        cmd_desc = record.get("cmdDesc", cmd_code)
        primary_value = record.get("primaryValue")
        if primary_value is None or not period:
            continue
        published = _parse_period(period)
        if published is None:
            continue
        raw_hash = event_hash(
            "global-macro:un-comtrade",
            reporter_code,
            partner_code,
            flow_code,
            cmd_code,
            period,
            str(primary_value),
        )
        title = f"UN Comtrade {reporter_label}→{partner_label} {flow_desc}: ${primary_value:,.0f} ({period})"
        content = (
            f"UN Comtrade — International Trade Statistics\n"
            f"Reporter: {reporter_label} ({reporter_code})\n"
            f"Partner: {partner_label} ({partner_code})\n"
            f"Flow: {flow_desc} ({flow_code})\n"
            f"Commodity: {cmd_desc} [{cmd_code}]\n"
            f"Period: {period}\n"
            f"Trade value (USD): {primary_value:,.2f}\n"
        )[:CONTENT_CAP]
        out.append(
            Event(
                id=raw_hash[:16],
                source="global-macro:un-comtrade",
                source_url=(
                    f"{COMTRADE_BASE}?reporterCode={reporter_code}"
                    f"&partnerCode={partner_code}&flowCode={flow_code}&period={period}"
                ),
                published_at=published,
                title=title,
                content=content,
                primary_entity_id=None,
                raw_hash=raw_hash,
            )
        )
    return out


def _fetch_un_comtrade(days: int = 30) -> list[Event]:
    """Fetch latest India-US bilateral trade data from UN Comtrade preview API.

    Comtrade data is annual, so we query the most recent year(s) regardless of
    the ``days`` window. The preview endpoint returns up to 500 records and
    requires no API key.
    """
    current_year = datetime.now(timezone.utc).year
    # Try the current year and previous year to catch latest published data.
    periods = [str(current_year), str(current_year - 1)]
    out: list[Event] = []

    with httpx.Client(
        headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
        timeout=25.0,
        follow_redirects=True,
    ) as client:
        # India as reporter, US as partner — exports and imports
        for period in periods:
            for flow_code in ("X", "M"):
                try:
                    response = client.get(
                        COMTRADE_BASE,
                        params={
                            "reporterCode": COMTRADE_INDIA_CODE,
                            "partnerCode": COMTRADE_US_CODE,
                            "flowCode": flow_code,
                            "period": period,
                            "cmdCode": "TOTAL",
                        },
                    )
                    response.raise_for_status()
                except httpx.HTTPError as exc:
                    LOGGER.debug(
                        "comtrade fetch failed reporter=IN partner=US flow=%s period=%s error=%s",
                        flow_code,
                        period,
                        exc,
                    )
                    continue
                try:
                    payload = response.json()
                except ValueError as exc:
                    LOGGER.debug("comtrade json decode failed period=%s error=%s", period, exc)
                    continue
                out.extend(comtrade_events_from_json(payload, COMTRADE_INDIA_CODE, COMTRADE_US_CODE))

        # US as reporter, India as partner — exports and imports
        for period in periods:
            for flow_code in ("X", "M"):
                try:
                    response = client.get(
                        COMTRADE_BASE,
                        params={
                            "reporterCode": COMTRADE_US_CODE,
                            "partnerCode": COMTRADE_INDIA_CODE,
                            "flowCode": flow_code,
                            "period": period,
                            "cmdCode": "TOTAL",
                        },
                    )
                    response.raise_for_status()
                except httpx.HTTPError as exc:
                    LOGGER.debug(
                        "comtrade fetch failed reporter=US partner=IN flow=%s period=%s error=%s",
                        flow_code,
                        period,
                        exc,
                    )
                    continue
                try:
                    payload = response.json()
                except ValueError as exc:
                    LOGGER.debug("comtrade json decode failed period=%s error=%s", period, exc)
                    continue
                out.extend(comtrade_events_from_json(payload, COMTRADE_US_CODE, COMTRADE_INDIA_CODE))
    return out


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------


def fetch_all(days: int = 30) -> list[Event]:
    """Fetch events from all global-macro sub-sources and concatenate."""
    return [
        *_fetch_imf(days=days),
        *_fetch_worldbank(days=days),
        *_fetch_bis(days=days),
        *_fetch_un_comtrade(days=days),
    ]
