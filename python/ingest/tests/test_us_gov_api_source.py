from __future__ import annotations

from datetime import datetime, timezone

import httpx

from high_signal_ingest.sources import us_gov_api


NOW = datetime(2026, 8, 28, 12, tzinfo=timezone.utc)


class FakeResponse:
    def __init__(self, payload: object = None, *, text: str = "") -> None:
        self._payload = payload
        self.text = text

    def raise_for_status(self) -> None:
        return None

    def json(self) -> object:
        return self._payload


def _get(url: str, **kwargs: object) -> FakeResponse:
    if url == us_gov_api.CFTC_COT_URL:
        return FakeResponse(
            [
                {
                    "report_date_as_yyyy_mm_dd": "2026-08-27",
                    "market_and_exchange_names": "NASDAQ-100",
                    "noncomm_positions_long_all": "120",
                    "noncomm_positions_short_all": "70",
                },
                {
                    "report_date_as_yyyy_mm_dd": "2026-08-27",
                    "market_and_exchange_names": "NASDAQ-100",
                },
            ]
        )
    if url == us_gov_api.TREASURY_XML_URL:
        return FakeResponse(
            text="""<feed xmlns:d=\"urn:data\"><entry><updated>2026-08-27T00:00:00Z</updated><d:BC_1MONTH>4.1</d:BC_1MONTH><d:BC_10YEAR>3.9</d:BC_10YEAR></entry></feed>"""
        )
    if url == us_gov_api.NSF_URL:
        return FakeResponse(
            {
                "response": {
                    "award": [
                        {
                            "id": "NSF-1",
                            "title": "Quantum networking",
                            "fundStartDate": "08/27/2026",
                            "piFirstName": "Ada",
                            "piLastName": "Lovelace",
                            "org": "Example University",
                            "fundsObligatedAmt": "500000",
                            "abstractText": "A resilient quantum network.",
                        }
                    ]
                }
            }
        )
    if url == us_gov_api.USGS_URL:
        return FakeResponse(
            {
                "features": [
                    {
                        "id": "eq-1",
                        "properties": {
                            "mag": 5.2,
                            "place": "Example coast",
                            "title": "M 5.2 - Example coast",
                            "time": int(NOW.timestamp() * 1000),
                            "url": "https://earthquake.usgs.gov/earthquakes/eventpage/eq-1",
                            "alert": "green",
                            "tsunami": 0,
                            "sig": 420,
                        },
                    }
                ]
            }
        )
    if url == us_gov_api.NOAA_URL:
        return FakeResponse(
            {
                "features": [
                    {
                        "id": "alert-1",
                        "properties": {
                            "id": "alert-1",
                            "event": "Heat Advisory",
                            "headlineText": "Heat advisory remains active",
                            "areaDesc": "Example County",
                            "sent": "2026-08-28T10:00:00Z",
                            "description": "High temperatures expected.",
                            "severity": "Moderate",
                            "certainty": "Likely",
                            "web": "https://www.weather.gov/example",
                        },
                    }
                ]
            }
        )
    if url == us_gov_api.BEA_URL:
        return FakeResponse(
            {
                "BEAAPI": {
                    "Results": {
                        "Data": [
                            {
                                "DataValue": "3.2",
                                "LineNumber": "1",
                                "LineDescription": "Quarterly change",
                                "Year": "2026",
                            }
                        ]
                    }
                }
            }
        )
    if url == us_gov_api.CENSUS_URL:
        return FakeResponse(
            [
                ["cell_value", "time_slot_id", "error_data"],
                ["125.4", "2026-08", ""],
            ]
        )
    if url == us_gov_api.CONGRESS_URL:
        return FakeResponse(
            {
                "bills": [
                    {
                        "congress": 119,
                        "type": "HR",
                        "number": 42,
                        "title": "Responsible AI Infrastructure Act",
                        "latestAction": {
                            "actionDate": "2026-08-27",
                            "text": "Referred to committee",
                        },
                        "sponsor": {"fullName": "Representative Example"},
                    }
                ]
            }
        )
    if url == us_gov_api.FEC_URL:
        return FakeResponse(
            {
                "results": [
                    {
                        "expenditure_date": "2026-08-27",
                        "payee_name": "Example Media",
                        "committee": {"name": "Future PAC"},
                        "candidate_name": "Candidate Example",
                        "expenditure_amount": "25000",
                        "support_oppose_indicator": "S",
                        "memo_text": "Digital advertising",
                    }
                ]
            }
        )
    if url == us_gov_api.LDA_URL:
        return FakeResponse(
            {
                "results": [
                    {
                        "filed_date": "2026-08-27",
                        "registrant": {"name": "Policy Partners"},
                        "client": {"name": "Example AI"},
                        "id": "lda-1",
                        "lobbying_activities": [{"general_issue_code": "CPT"}],
                    }
                ]
            }
        )
    if url == us_gov_api.FDA_URL:
        return FakeResponse(
            {
                "results": [
                    {
                        "safetyreportid": "fda-1",
                        "receivedate": "20260827",
                        "serious": "1",
                        "patient": {
                            "drug": [{"medicinalproduct": "Example Drug"}],
                            "reaction": [{"reactionmeddrapt": "Headache"}],
                        },
                    }
                ]
            }
        )
    if url == us_gov_api.USDA_NASS_URL:
        return FakeResponse(
            {
                "data": [
                    {
                        "commodity_desc": "CORN",
                        "Value": "15,000",
                        "year": "2026",
                        "freq_desc": "ANNUAL",
                        "period_desc": "YEAR",
                        "unit_desc": "BU",
                    }
                ]
            }
        )
    raise AssertionError(f"unexpected GET {url} kwargs={kwargs}")


def _post(url: str, **kwargs: object) -> FakeResponse:
    if url == us_gov_api.CFPB_URL:
        return FakeResponse(
            {
                "hits": {
                    "hits": [
                        {
                            "_id": "cfpb-1",
                            "_source": {
                                "complaint_id": "cfpb-1",
                                "date_received": "2026-08-27",
                                "product": "Credit card",
                                "issue": "Billing dispute",
                                "company": "Example Bank",
                                "state": "CA",
                                "complaint_what_happened": "The charge was duplicated.",
                            },
                        }
                    ]
                }
            }
        )
    if url == us_gov_api.NIH_URL:
        return FakeResponse(
            {
                "results": [
                    {
                        "project_num": "NIH-1",
                        "project_title": "Machine learning for genomics",
                        "project_start_date": "2026-08-27",
                        "org_name": "Example Institute",
                        "principal_investigators": [{"full_name": "Grace Hopper"}],
                        "award_amount": 750000,
                        "abstract_text": "A genomic foundation model.",
                    }
                ]
            }
        )
    raise AssertionError(f"unexpected POST {url} kwargs={kwargs}")


def test_fetch_all_normalizes_every_us_government_api(monkeypatch) -> None:
    monkeypatch.setattr(us_gov_api, "_now", lambda: NOW)
    monkeypatch.setattr(us_gov_api.httpx, "get", _get)
    monkeypatch.setattr(us_gov_api.httpx, "post", _post)
    for key in (
        "BEA_API_KEY",
        "CENSUS_API_KEY",
        "CONGRESS_API_KEY",
        "FEC_API_KEY",
        "LDA_API_KEY",
        "FDA_API_KEY",
        "USDA_NASS_API_KEY",
    ):
        monkeypatch.setenv(key, "test-key")

    events = us_gov_api.fetch_all(days=365)

    sources = {event.source for event in events}
    assert sources == {
        "us-gov-api:cftc-cot",
        "us-gov-api:treasury-yields",
        "us-gov-api:cfpb-complaints",
        "us-gov-api:nih-reporter",
        "us-gov-api:nsf-awards",
        "us-gov-api:usgs-earthquakes",
        "us-gov-api:noaa-weather",
        "us-gov-api:bea",
        "us-gov-api:census",
        "us-gov-api:congress",
        "us-gov-api:fec",
        "us-gov-api:lda",
        "us-gov-api:fda",
        "us-gov-api:usda-nass",
    }
    assert len(events) == 16
    assert all(event.raw_hash and len(event.id) == 16 for event in events)
    assert next(event for event in events if event.source.endswith("cftc-cot")).content.endswith(
        "net: 50."
    )


def test_key_gated_sources_skip_without_credentials(monkeypatch) -> None:
    for key in (
        "BEA_API_KEY",
        "CENSUS_API_KEY",
        "CONGRESS_API_KEY",
        "FEC_API_KEY",
        "USDA_NASS_API_KEY",
    ):
        monkeypatch.delenv(key, raising=False)

    assert us_gov_api._fetch_bea(1) == []
    assert us_gov_api._fetch_census(1) == []
    assert us_gov_api._fetch_congress(1) == []
    assert us_gov_api._fetch_fec(1) == []
    assert us_gov_api._fetch_usda_nass(1) == []


def test_fetchers_fail_closed_and_fanout_isolates_unexpected_errors(monkeypatch) -> None:
    for key in (
        "BEA_API_KEY",
        "CENSUS_API_KEY",
        "CONGRESS_API_KEY",
        "FEC_API_KEY",
        "USDA_NASS_API_KEY",
    ):
        monkeypatch.setenv(key, "test-key")

    def fail(*args: object, **kwargs: object) -> FakeResponse:
        raise httpx.ConnectError("offline fixture")

    monkeypatch.setattr(us_gov_api.httpx, "get", fail)
    monkeypatch.setattr(us_gov_api.httpx, "post", fail)
    assert us_gov_api._fetch_cftc_cot(1) == []
    assert us_gov_api._fetch_treasury_yields(1) == []
    assert us_gov_api._fetch_cfpb_complaints(1) == []
    assert us_gov_api._fetch_nih_reporter(1) == []
    assert us_gov_api._fetch_nsf_awards(1) == []
    assert us_gov_api._fetch_usgs_earthquakes(1) == []
    assert us_gov_api._fetch_noaa_weather(1) == []
    assert us_gov_api._fetch_bea(1) == []
    assert us_gov_api._fetch_census(1) == []
    assert us_gov_api._fetch_congress(1) == []
    assert us_gov_api._fetch_fec(1) == []
    assert us_gov_api._fetch_lda(1) == []
    assert us_gov_api._fetch_fda(1) == []
    assert us_gov_api._fetch_usda_nass(1) == []

    def broken(days: int) -> list:
        raise RuntimeError(f"broken for {days}")

    monkeypatch.setattr(us_gov_api, "_SUB_FETCHERS", [broken, lambda days: []])
    assert us_gov_api.fetch_all(2) == []


def test_parse_datetime_and_content_cap_helpers() -> None:
    assert us_gov_api._parse_dt(None) is None
    assert us_gov_api._parse_dt("not-a-date") is None
    assert us_gov_api._parse_dt("2026-08-28").tzinfo == timezone.utc
    assert len(us_gov_api._cap("x" * (us_gov_api.CONTENT_CAP + 1))) == us_gov_api.CONTENT_CAP
