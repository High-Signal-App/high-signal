"""Retain official NSE integrated filings and project reported net assets. No price ingress.

Local replay accepts raw index pages and an XML cache. --fetch paginates both official
boards for an explicit date window and downloads issuer candidates without a company cap.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import re
import time
import tempfile
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict
from dataclasses import asdict, dataclass, field
from datetime import date, datetime, timezone
from decimal import Decimal
from pathlib import Path
from zoneinfo import ZoneInfo
from urllib.parse import urlencode, urlparse

import httpx

from ..nse_archive import consume, load_manifest
from ..stock_data.models import Entity, Fact, canonical_json, decimal_value, instant
from ..stock_data.reported_net_assets import (
    MODEL_VERSION,
    MarketObservation,
    ReportedNumber,
    Statement,
    calculate,
)
from ..stock_data.store import StockStore
from .nse import MAX_BYTES, expected_session, parse_files

API = "https://www.nseindia.com/api/integrated-filing-results"
EXTRACTOR = "nse-integrated-financials.v2"
MAX_XML_BYTES = 12_000_000
XBRL = "http://www.xbrl.org/2003/instance"
TAXONOMIES = {
    f"http://www.sebi.gov.in/xbrl/{version}/in-capmkt"
    for version in ("2025-01-31", "2026-01-31", "2026-08-31")
}
EQUITY_SERIES = {"EQ", "BE", "BZ", "SM", "ST", "SZ"}
CONCEPTS = {
    "Assets": "assets",
    "Liabilities": "liabilities",
    "Equity": "equity",
    "PaidUpValueOfEquityShareCapital": "capital",
    "FaceValueOfEquityShareCapital": "face_value",
    "EquityAttributableToOwnersOfParent": "parent_equity",
    "NoncontrollingInterests": "noncontrolling_interests",
    "NonControllingInterest": "noncontrolling_interests",
}


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _parse_xml(body: bytes) -> tuple[ET.Element, dict]:
    if len(body) > MAX_XML_BYTES or re.search(rb"<!\s*(?:DOCTYPE|ENTITY)\b", body, re.I):
        raise ValueError("unsafe_or_oversized_xml")
    pending, scopes, bindings = [], [{}], {}
    parser = ET.iterparse(
        io.StringIO(body.decode("utf-8-sig")), events=("start-ns", "start", "end")
    )
    for event, item in parser:
        if event == "start-ns":
            pending.append(item)
        elif event == "start":
            scope = {**scopes[-1], **dict(pending)}
            scopes.append(scope)
            pending.clear()
            if item.tag == f"{{{XBRL}}}measure":
                bindings[id(item)] = scope
        else:
            scopes.pop()
    root = parser.root
    if root.tag != f"{{{XBRL}}}xbrl":
        raise ValueError("unsupported_xbrl_document")
    return root, bindings


def _contexts(root: ET.Element) -> dict:
    contexts = {}
    for context in root.findall(f"{{{XBRL}}}context"):
        if any(_local(e.tag) in {"scenario", "segment"} for e in context.iter()):
            continue
        period = context.find(f"{{{XBRL}}}period")
        if period is None:
            continue
        end = period.findtext(f"{{{XBRL}}}instant") or period.findtext(f"{{{XBRL}}}endDate")
        if end:
            date.fromisoformat(end)
            contexts[context.get("id")] = (end, period.find(f"{{{XBRL}}}instant") is not None)
    return contexts


def _units(root: ET.Element, bindings: dict) -> dict:
    def measure(element: ET.Element | None) -> tuple[str | None, str]:
        if element is None:
            return None, ""
        text = (element.text or "").strip()
        prefix, _, local = text.partition(":")
        return bindings.get(id(element), {}).get(prefix), local

    units = {}
    for unit in root.findall(f"{{{XBRL}}}unit"):
        measures = [measure(e) for e in unit.iter(f"{{{XBRL}}}measure")]
        if unit.find(f"{{{XBRL}}}divide") is None and measures == [
            ("http://www.xbrl.org/2003/iso4217", "INR")
        ]:
            units[unit.get("id")] = "INR"
        elif unit.find(f"{{{XBRL}}}divide") is not None:
            numerator = measure(
                unit.find(f"{{{XBRL}}}divide/{{{XBRL}}}unitNumerator/{{{XBRL}}}measure")
            )
            denominator = measure(
                unit.find(f"{{{XBRL}}}divide/{{{XBRL}}}unitDenominator/{{{XBRL}}}measure")
            )
            if (
                numerator == ("http://www.xbrl.org/2003/iso4217", "INR")
                and denominator == (XBRL, "shares")
                and len(measures) == 2
            ):
                units[unit.get("id")] = "INR/share"
    return units


def _numbers(facts: list[ET.Element], contexts: dict, units: dict) -> dict:
    numbers = defaultdict(dict)
    for element in facts:
        concept, context = _local(element.tag), element.get("contextRef")
        if concept not in CONCEPTS or context not in contexts:
            continue
        if element.get("{http://www.w3.org/2001/XMLSchema-instance}nil") in {"true", "1"}:
            continue
        expected = "INR/share" if concept == "FaceValueOfEquityShareCapital" else "INR"
        if units.get(element.get("unitRef")) != expected:
            raise ValueError("unsupported_financial_unit")
        if any(_local(key) == "scale" for key in element.attrib):
            raise ValueError("unsupported_numeric_scale")
        precision = element.get("decimals", "")
        if precision != "INF" and not re.fullmatch(r"-?\d{1,2}", precision):
            raise ValueError("unsupported_numeric_precision")
        tolerance = Decimal(0) if precision == "INF" else Decimal(10) ** -int(precision) / 2
        value = ReportedNumber(
            decimal_value((element.text or "").strip()), tolerance, concept, str(context)
        )
        existing = numbers[context].get(CONCEPTS[concept])
        if existing and existing != value:
            raise ValueError("conflicting_financial_facts")
        numbers[context][CONCEPTS[concept]] = value
    return numbers


def _statement_values(numbers: dict, contexts: dict) -> tuple[str, dict]:
    candidates = [
        (contexts[c][0], c, values)
        for c, values in numbers.items()
        if contexts[c][1] and {"assets", "liabilities", "equity"}.issubset(values)
    ]
    if not candidates:
        raise ValueError("balance_sheet_unavailable")
    end, context, values = max(candidates, key=lambda candidate: candidate[0])
    # Never fill a missing current balance sheet from a comparative period silently.
    latest_end = max(v[0] for v in contexts.values())
    if end != latest_end:
        raise ValueError("current_balance_sheet_unavailable")
    for name in ("capital", "face_value"):
        options = (
            [values[name]]
            if name in values
            else [v[name] for c, v in numbers.items() if contexts[c][0] == end and name in v]
        )
        if options:
            if len({(v.value, v.tolerance) for v in options}) != 1:
                raise ValueError("conflicting_share_capital_facts")
            values[name] = options[0]
    return end, values


def parse_statement(
    body: bytes, *, symbol: str, isin: str, evidence_id: str, available_at: str
) -> Statement:
    root, bindings = _parse_xml(body)
    facts = [e for e in root if e.tag.startswith("{") and e.tag[1:].split("}")[0] in TAXONOMIES]
    if not facts:
        raise ValueError("unsupported_taxonomy")
    contexts = _contexts(root)

    def identity(concept: str) -> set[str]:
        return {
            (e.text or "").strip()
            for e in facts
            if _local(e.tag) == concept and e.get("contextRef") in contexts
        }

    if identity("Symbol") != {symbol} or identity("ISIN") != {isin}:
        raise ValueError("filing_identity_mismatch")
    bases = {v.lower() for v in identity("NatureOfReportStandaloneConsolidated")}
    if len(bases) != 1 or not bases.issubset({"consolidated", "standalone"}):
        raise ValueError("unsupported_accounting_basis")

    end, values = _statement_values(_numbers(facts, contexts, _units(root, bindings)), contexts)
    statement = Statement(symbol, isin, next(iter(bases)), end, available_at, evidence_id, **values)
    statement.validate()
    return statement


@dataclass(frozen=True)
class FilingExpectations:
    period_end: str
    basis: str
    publication: dict[str, str]


def retain_statement(
    store: StockStore,
    body: bytes,
    url: str,
    *,
    symbol: str,
    isin: str,
    observed: str,
    expectations: FilingExpectations | None = None,
) -> tuple[Statement, list[str], dict]:
    evidence = store.retain_evidence(
        source_id="nse-integrated-financials",
        url=url,
        body=body,
        available_at=observed,
        ingested_at=observed,
        media_type="application/xml",
    )
    statement = parse_statement(
        body, symbol=symbol, isin=isin, evidence_id=evidence.id, available_at=observed
    )
    if expectations is not None and statement.period_end != expectations.period_end:
        raise ValueError("index_and_statement_date_mismatch")
    if expectations is not None and statement.basis != expectations.basis:
        raise ValueError("index_and_filing_basis_mismatch")
    entity_id = f"issuer:nse-symbol:{symbol}"
    store.put_entity(Entity(entity_id, symbol, "IN", {"nse_symbol": symbol, "isin": isin}))
    facts = []
    for name in sorted(set(CONCEPTS.values())):
        value = getattr(statement, name)
        if value:
            facts.append(
                Fact(
                    entity_id=entity_id,
                    metric=f"reported_{name}",
                    value=str(value.value),
                    unit="INR/share" if name == "face_value" else "INR",
                    effective_at=f"{statement.period_end}T00:00:00Z",
                    available_at=observed,
                    ingested_at=observed,
                    evidence_id=evidence.id,
                    locator=f"{value.concept}[@contextRef='{value.context}']",
                    dimensions={
                        "ticker": f"{symbol}.NS",
                        "isin": isin,
                        "accounting_basis": statement.basis,
                        "period_end": statement.period_end,
                        "context": value.context,
                        "rounding_tolerance": str(value.tolerance),
                        **(expectations.publication if expectations else {}),
                    },
                    extractor_version=EXTRACTOR,
                )
            )
    ids = store.put_facts(facts)
    return statement, ids, asdict(evidence)


def filing_date(value: str) -> datetime:
    for pattern in ("%d-%b-%Y %H:%M:%S", "%d-%b-%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(value, pattern)
        except ValueError:
            continue
    raise ValueError("unsupported_filing_date")


def publication_dates(row: dict) -> dict[str, str]:
    return {
        key: filing_date(str(row[key])).replace(tzinfo=ZoneInfo("Asia/Kolkata")).isoformat()
        for key in ("broadcast_Date", "creation_Date", "revised_Date")
        if row.get(key)
    }


def cache_metadata(path: Path) -> dict:
    metadata = path.with_suffix(path.suffix + ".meta.json")
    meta = json.loads(metadata.read_text()) if metadata.exists() else {}
    if (
        not isinstance(meta, dict)
        or not isinstance(meta.get("observedAt"), str)
        or not meta["observedAt"]
        or not re.fullmatch(r"[a-f0-9]{64}", str(meta.get("sha256", "")))
    ):
        raise ValueError("retained_cache_provenance_missing")
    instant(meta["observedAt"])
    if hashlib.sha256(path.read_bytes()).hexdigest() != meta["sha256"]:
        raise ValueError("retained_cache_hash_mismatch")
    return meta


def _atomic_cache_file(path: Path, body: bytes) -> None:
    pending = None
    try:
        with tempfile.NamedTemporaryFile(
            dir=path.parent, prefix=path.name + ".", suffix=".pending", delete=False
        ) as temporary:
            pending = Path(temporary.name)
            temporary.write(body)
            temporary.flush()
            os.fsync(temporary.fileno())
        os.replace(pending, path)
    finally:
        if pending is not None:
            pending.unlink(missing_ok=True)


def write_cache(path: Path, body: bytes, url: str) -> None:
    _atomic_cache_file(path, body)
    _atomic_cache_file(
        path.with_suffix(path.suffix + ".meta.json"),
        canonical_json(
            {
                "observedAt": datetime.now(timezone.utc).isoformat(),
                "url": url,
                "sha256": hashlib.sha256(body).hexdigest(),
                "bytes": len(body),
            }
        ).encode(),
    )


def index_order(row: dict) -> tuple:
    return (
        filing_date(str(row.get("qe_Date", ""))),
        str(row.get("consolidated", "")).lower() == "consolidated",
        filing_date(
            str(
                row.get("broadcast_Date")
                or row.get("creation_Date")
                or row.get("revised_Date")
                or row["qe_Date"]
            )
        ),
    )


def filing_url(row: dict) -> str | None:
    url = row.get("xbrl")
    if not isinstance(url, str):
        return None
    parsed = urlparse(url)
    if (
        parsed.scheme != "https"
        or parsed.netloc != "nsearchives.nseindia.com"
        or not parsed.path.startswith("/corporate/xbrl/")
        or not parsed.path.lower().endswith(".xml")
        or parsed.query
        or parsed.fragment
    ):
        return None
    return url


def _download(client: httpx.Client, url: str, budget: int) -> bytes:
    for attempt in range(3):
        try:
            with client.stream("GET", url) as response:
                response.raise_for_status()
                body = bytearray()
                for chunk in response.iter_bytes():
                    body.extend(chunk)
                    if len(body) > budget:
                        raise ValueError("source_response_exceeds_budget")
                return bytes(body)
        except httpx.HTTPError as exc:
            if isinstance(exc, httpx.HTTPStatusError) and exc.response.status_code in {403, 429}:
                raise
            if attempt == 2:
                raise
            time.sleep(0.5 * (attempt + 1))
    raise AssertionError("unreachable")


def fetch_indexes(cache: Path, start: date, end: date, client: httpx.Client) -> list[Path]:
    if start > end:
        raise ValueError("invalid_date_window")
    paths = []
    for board in ("equities", "sme"):
        page, received, total = 1, 0, None
        while total is None or received < total:
            if page > 1000:
                raise ValueError("index_pagination_budget_exceeded")
            url = (
                API
                + "?"
                + urlencode(
                    {
                        "index": board,
                        "type": "Integrated Filing- Financials",
                        "from_date": start.strftime("%d-%m-%Y"),
                        "to_date": end.strftime("%d-%m-%Y"),
                        "page": page,
                        "size": 1000,
                    }
                )
            )
            body = _download(client, url, MAX_BYTES)
            payload = json.loads(body)
            rows = payload.get("data")
            count = payload.get("totalCount")
            if not isinstance(rows, list) or not isinstance(count, int) or count < 0:
                raise ValueError("unsupported_index_schema")
            if total is not None and total != count:
                raise ValueError("index_changed_during_pagination_retry_window")
            total = count
            if not rows and received < total:
                raise ValueError("truncated_index_pagination")
            path = cache / f"index-{board}-{page}.json"
            write_cache(path, body, url)
            paths.append(path)
            received += len(rows)
            page += 1
            time.sleep(0.15)
    return paths


def _market_inputs(root: Path, store: StockStore, as_of: str) -> tuple[dict, dict, list, list]:
    pointer = json.loads((root / "latest.json").read_text())
    manifest = load_manifest(root, pointer)
    dataset = consume(root, allow_stale=True)
    if instant(manifest["availableAt"]) > instant(as_of):
        raise ValueError("price_snapshot_not_yet_available")
    bodies = {
        name: (root / manifest["objects"][name]["key"]).read_bytes()
        for name in ("securities.csv.gz", "bhavcopy.csv.zip")
    }
    price_evidence = [
        store.retain_evidence(
            source_id="nse-cm",
            url=manifest["sourceUrls"]["securities" if name == "securities.csv.gz" else "bhavcopy"],
            body=body,
            available_at=manifest["availableAt"],
            ingested_at=manifest["availableAt"],
            media_type="application/gzip" if name.endswith("gz") else "application/zip",
        ).id
        for name, body in bodies.items()
    ]
    masters, _ = parse_files(
        bodies["securities.csv.gz"],
        bodies["bhavcopy.csv.zip"],
        date.fromisoformat(manifest["tradeDate"]),
    )
    return manifest, dataset, masters, price_evidence


def _index_filings(indexes: list[Path], store: StockStore, as_of: str) -> tuple[dict, list, dict]:
    filings, index_evidence = defaultdict(list), []
    raw_index_rows, unique_index_rows, invalid_rows = 0, set(), 0
    for path in indexes:
        body = path.read_bytes()
        payload = json.loads(body)
        if not isinstance(payload.get("data"), list):
            raise ValueError("unsupported_index_schema")
        meta = cache_metadata(path)
        observed = meta.get("observedAt", as_of)
        if instant(observed) > instant(as_of):
            raise ValueError("index_snapshot_not_yet_available")
        url = meta.get("url", API)
        evidence = store.retain_evidence(
            source_id="nse-integrated-financials-index",
            url=url,
            body=body,
            available_at=observed,
            ingested_at=observed,
        )
        index_evidence.append(evidence.id)
        raw_index_rows += len(payload["data"])
        for row in payload["data"]:
            if (
                isinstance(row, dict)
                and isinstance(row.get("symbol"), str)
                and row["symbol"].strip()
                and filing_url(row)
            ):
                try:
                    index_order(row)
                    publication_dates(row)
                except (ValueError, KeyError):
                    invalid_rows += 1
                    continue
                unique_index_rows.add((str(row.get("seq_Id", "")), filing_url(row)))
                filings[row["symbol"]].append(row)
            else:
                invalid_rows += 1
    for symbol in filings:
        unique = {filing_url(r): r for r in filings[symbol]}
        # Newer balance sheet first; prefer consolidated for the same report date.
        filings[symbol] = sorted(
            unique.values(),
            key=index_order,
            reverse=True,
        )
    return (
        filings,
        index_evidence,
        {
            "indexPages": len(indexes),
            "indexRows": raw_index_rows,
            "uniqueIndexRows": len(unique_index_rows),
            "invalidIndexRows": invalid_rows,
            "duplicateIndexRows": raw_index_rows - invalid_rows - len(unique_index_rows),
        },
    )


@dataclass
class FilingProjection:
    store: StockStore
    manifest: dict
    xml_cache: Path
    filings: dict
    index_ids: list[str]
    price_ids: list[str]
    as_of: str | None
    now: str
    client: httpx.Client | None = None
    failures: list[dict] = field(default_factory=list)
    statements: dict = field(default_factory=dict)
    downloads_blocked: bool = False
    integrity_events: list[dict] = field(default_factory=list)

    def cached_filing(self, path: Path, url: str) -> dict:
        try:
            return cache_metadata(path)
        except (FileNotFoundError, ValueError) as exc:
            if self.client is None or self.downloads_blocked:
                if not path.exists():
                    raise ValueError("filing_bytes_not_retained") from None
                raise
            if path.exists():
                event = {
                    "type": "stock-data.cache-integrity.v1",
                    "url": url,
                    "reason": str(exc),
                    "observedAt": datetime.now(timezone.utc).isoformat(),
                    "cacheBodySha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                }
                event["snapshotId"] = self.store.save_snapshot(event)
                self.integrity_events.append(event)
        write_cache(path, _download(self.client, url, MAX_XML_BYTES), url)
        time.sleep(0.15)
        return cache_metadata(path)

    def read_filing(self, filing: dict, symbol: str, isin: str) -> tuple:
        url = filing_url(filing)
        assert url is not None
        path = self.xml_cache / Path(urlparse(url).path).name
        meta = self.cached_filing(path, url)
        observed = meta.get("observedAt", self.now)
        if self.as_of is not None and instant(observed) > instant(self.as_of):
            raise ValueError("statement_not_yet_available")
        publication = publication_dates(filing)
        query_as_of = self.as_of or datetime.now(timezone.utc).isoformat()
        if any(instant(value) > instant(query_as_of) for value in publication.values()):
            raise ValueError("declared_publication_not_yet_available")
        statement, ids, evidence = retain_statement(
            self.store,
            path.read_bytes(),
            url,
            symbol=symbol,
            isin=isin,
            observed=observed,
            expectations=FilingExpectations(
                filing_date(str(filing["qe_Date"])).date().isoformat(),
                str(filing.get("consolidated", "")).lower(),
                publication,
            ),
        )
        evidence["declaredPublicationDates"] = publication
        return statement, ids, evidence

    def statement_for(self, symbol: str, isin: str) -> tuple | None:
        key = (symbol, isin)
        if key not in self.statements:
            self.statements[key] = None
            for filing in self.filings.get(symbol, []):
                try:
                    self.statements[key] = self.read_filing(filing, symbol, isin)
                    break
                except (ValueError, ET.ParseError, httpx.HTTPError) as exc:
                    if isinstance(exc, httpx.HTTPStatusError) and exc.response.status_code in {
                        403,
                        429,
                    }:
                        self.downloads_blocked = True
                    self.failures.append(
                        {
                            "symbol": symbol,
                            "isin": isin,
                            "url": filing_url(filing),
                            "reason": str(exc)[:200],
                        }
                    )
        return self.statements[key]

    def row(self, row: dict, master: dict, class_count: int) -> dict:
        result = None
        reason = "financial_filing_unavailable"
        symbol, isin = row["symbol"], row["isin"]
        if (
            row["series"] not in EQUITY_SERIES
            or row["deleted"]
            or row.get("testInstrument")
            or not row["identifierValid"]
        ):
            reason = "unsupported_or_inactive_instrument"
        else:
            selected = self.statement_for(symbol, isin)
            if selected:
                statement, ids, evidence = selected
                try:
                    result = calculate(
                        statement,
                        market=MarketObservation(
                            symbol=symbol,
                            isin=isin,
                            issued_shares=master.get("IssdCptl") or None,
                            raw_close=row["rawClose"],
                            price_date=self.manifest["tradeDate"],
                            as_of=self.as_of or datetime.now(timezone.utc).isoformat(),
                            input_ids=[row["inputSnapshotId"], *self.price_ids, *ids],
                            multiple_classes=class_count != 1,
                            price_stale=date.fromisoformat(self.manifest["tradeDate"])
                            < expected_session(instant(self.now)),
                        ),
                    )
                    result["evidence"] = evidence
                    result["inputIds"].extend(self.index_ids)
                    result.pop("resultId", None)
                    result["resultId"] = self.store.save_snapshot(result)
                except ValueError as exc:
                    reason = str(exc)
            elif self.filings.get(symbol):
                reason = "no_supported_balance_sheet_in_retained_filings"
        return {
            "securityId": row["securityId"],
            "symbol": symbol,
            "isin": isin,
            "financials": result
            or {
                "ratio": None,
                "marketCap": None,
                "reportedNetAssets": None,
                "rankingEligible": False,
                "reason": reason,
                "modelVersion": MODEL_VERSION,
                "asOf": self.now,
            },
        }


def project(
    *,
    root: Path,
    indexes: list[Path],
    xml_cache: Path,
    store: StockStore,
    as_of: str | None,
    client: httpx.Client | None = None,
) -> dict:
    now = as_of or datetime.now(timezone.utc).isoformat()
    manifest, dataset, masters, price_ids = _market_inputs(root, store, now)
    filings, index_ids, index_counts = _index_filings(indexes, store, now)
    by_id = {r["FinInstrmId"]: r for r in masters}
    classes = defaultdict(set)
    for row in masters:
        if row["SctySrs"] in EQUITY_SERIES and row["DelFlg"] != "Y":
            classes[row["TckrSymb"]].add(row["ISIN"])
    xml_cache.mkdir(parents=True, exist_ok=True)
    projection = FilingProjection(
        store, manifest, xml_cache, filings, index_ids, price_ids, as_of, now, client
    )
    results = [
        projection.row(row, by_id[row["instrumentId"]], len(classes[row["symbol"]]))
        for row in dataset["rows"]
    ]
    output = {
        "contractVersion": "stock-data.reported-net-assets.v1",
        "modelVersion": MODEL_VERSION,
        "asOf": as_of or datetime.now(timezone.utc).isoformat(),
        "inputSnapshotId": manifest["snapshotId"],
        "tradeDate": manifest["tradeDate"],
        "coverage": {
            "status": "partial",
            "indexCompleteness": "unqualified; page counts and duplicates require source audit",
            "downloadsBlocked": projection.downloads_blocked,
            "cacheIntegrityEvents": len(projection.integrity_events),
            "records": len(results),
            "supportedRatios": sum(r["financials"]["ratio"] is not None for r in results),
            "rankingEligible": sum(r["financials"]["rankingEligible"] for r in results),
            "statementIdentities": sum(s is not None for s in projection.statements.values()),
            **index_counts,
            "filingFailures": len(projection.failures),
            "reasons": dict(Counter(r["financials"]["reason"] or "available" for r in results)),
        },
        "failures": projection.failures,
        "cacheIntegrityEvents": projection.integrity_events,
        "rows": results,
    }
    output["snapshotId"] = store.save_snapshot(output)
    return output


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", required=True, type=Path)
    parser.add_argument("--index", action="append", default=[], type=Path)
    parser.add_argument("--xml-cache", required=True, type=Path)
    parser.add_argument("--store", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--as-of")
    parser.add_argument("--fetch", action="store_true")
    parser.add_argument("--from-date", type=date.fromisoformat)
    parser.add_argument("--to-date", type=date.fromisoformat)
    args = parser.parse_args()
    cache = args.xml_cache.parent
    cache.mkdir(parents=True, exist_ok=True)
    with (
        httpx.Client(
            headers={"User-Agent": "Mozilla/5.0"}, timeout=45, follow_redirects=False
        ) as client,
        StockStore(args.store) as store,
    ):
        indexes = args.index
        if args.fetch:
            if not args.from_date or not args.to_date:
                parser.error("--fetch requires an explicit --from-date and --to-date")
            indexes = [*indexes, *fetch_indexes(cache, args.from_date, args.to_date, client)]
        as_of = args.as_of
        output = project(
            root=args.root,
            indexes=indexes,
            xml_cache=args.xml_cache,
            store=store,
            as_of=as_of,
            client=client if args.fetch else None,
        )
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(canonical_json(output))
    args.out.chmod(0o600)
    print(
        canonical_json(
            {
                "path": str(args.out),
                "snapshotId": output["snapshotId"],
                "coverage": output["coverage"],
            }
        )
    )


if __name__ == "__main__":
    main()
