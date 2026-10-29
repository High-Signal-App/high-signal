"""Append-only local stock-data ledger, suitable for retained job artifacts and replay."""

from __future__ import annotations

import hashlib
import json
import sqlite3
from contextlib import contextmanager
from dataclasses import asdict
from datetime import timedelta
from pathlib import Path
from typing import Iterable, Iterator

from .models import (
    CONTRACT_VERSION,
    Entity,
    Evidence,
    Fact,
    Security,
    SourceRights,
    canonical_json,
    content_id,
    instant,
    utc,
    series_id,
)


class StockStore:
    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.connection = sqlite3.connect(self.path)
        self._transaction_depth = 0
        self.connection.row_factory = sqlite3.Row
        self.connection.execute("PRAGMA foreign_keys=ON")
        self.connection.execute("PRAGMA journal_mode=WAL")
        self.connection.executescript("""
            CREATE TABLE IF NOT EXISTS identities (
                sequence INTEGER PRIMARY KEY AUTOINCREMENT,
                kind TEXT NOT NULL,
                id TEXT NOT NULL,
                version_id TEXT NOT NULL UNIQUE,
                payload TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS identities_lookup ON identities(kind, id, sequence);
            CREATE TABLE IF NOT EXISTS source_rights (
                sequence INTEGER PRIMARY KEY AUTOINCREMENT,
                source_id TEXT NOT NULL,
                version_id TEXT NOT NULL UNIQUE,
                payload TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS evidence (
                id TEXT PRIMARY KEY,
                source_id TEXT NOT NULL,
                url TEXT NOT NULL,
                sha256 TEXT NOT NULL,
                available_at TEXT NOT NULL,
                ingested_at TEXT NOT NULL,
                media_type TEXT NOT NULL,
                body BLOB NOT NULL
            );
            CREATE TABLE IF NOT EXISTS facts (
                id TEXT PRIMARY KEY,
                entity_id TEXT NOT NULL,
                metric TEXT NOT NULL,
                effective_at TEXT NOT NULL,
                available_at TEXT NOT NULL,
                ingested_at TEXT NOT NULL,
                evidence_id TEXT NOT NULL REFERENCES evidence(id),
                series_key TEXT NOT NULL,
                ticker TEXT,
                payload TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS facts_entity_metric ON facts(entity_id,metric,effective_at);
            CREATE INDEX IF NOT EXISTS facts_ticker_metric ON facts(ticker,metric,effective_at);
            CREATE INDEX IF NOT EXISTS facts_available ON facts(available_at);
            CREATE TABLE IF NOT EXISTS snapshots (
                id TEXT PRIMARY KEY,
                payload TEXT NOT NULL
            );
        """)
        for table in ("identities", "source_rights", "evidence", "facts", "snapshots"):
            for operation in ("UPDATE", "DELETE"):
                self.connection.execute(f"""
                    CREATE TRIGGER IF NOT EXISTS {table}_no_{operation.lower()}
                    BEFORE {operation} ON {table} BEGIN
                    SELECT RAISE(ABORT, 'stock-data records are append-only'); END
                """)
        self.connection.commit()

    def __enter__(self) -> StockStore:
        return self

    def __exit__(self, *args: object) -> None:
        self.close()

    def close(self) -> None:
        self.connection.commit()
        self.connection.close()

    @contextmanager
    def transaction(self) -> Iterator[None]:
        """Nest writes with savepoints so a per-ticker batch commits only once."""
        name = f"stock_data_{self._transaction_depth}"
        self.connection.execute(f"SAVEPOINT {name}")
        self._transaction_depth += 1
        try:
            yield
            self.connection.execute(f"RELEASE SAVEPOINT {name}")
        except BaseException:
            self.connection.execute(f"ROLLBACK TO SAVEPOINT {name}")
            self.connection.execute(f"RELEASE SAVEPOINT {name}")
            raise
        finally:
            self._transaction_depth -= 1

    def _put_identity(self, kind: str, value: Entity | Security) -> str:
        payload = asdict(value)
        version_id = content_id(kind, payload)
        with self.transaction():
            self.connection.execute(
                "INSERT OR IGNORE INTO identities(kind,id,version_id,payload) VALUES(?,?,?,?)",
                (kind, value.id, version_id, canonical_json(payload)),
            )
        return version_id

    def put_entity(self, entity: Entity) -> str:
        return self._put_identity("entity", entity)

    def put_security(self, security: Security) -> str:
        return self._put_identity("security", security)

    def identities(self, kind: str = "entity") -> list[dict]:
        if kind not in {"entity", "security"}:
            raise ValueError("unknown identity kind")
        rows = self.connection.execute(
            "SELECT version_id,payload FROM identities WHERE sequence IN "
            "(SELECT max(sequence) FROM identities WHERE kind=? GROUP BY id) ORDER BY id",
            (kind,),
        )
        return [{"version_id": r["version_id"], **json.loads(r["payload"])} for r in rows]

    def put_rights(self, rights: SourceRights) -> str:
        with self.transaction():
            current = self.rights(rights.id)
            historical = self.connection.execute(
                "SELECT 1 FROM source_rights WHERE version_id=?", (rights.version_id,)
            ).fetchone()
            if historical and current and current.version_id != rights.version_id:
                raise ValueError(
                    "Restating historical rights requires a newly dated rights decision"
                )
            self.connection.execute(
                "INSERT OR IGNORE INTO source_rights(source_id,version_id,payload) VALUES(?,?,?)",
                (rights.id, rights.version_id, canonical_json(asdict(rights))),
            )
        return rights.version_id

    def rights(self, source_id: str) -> SourceRights | None:
        row = self.connection.execute(
            "SELECT payload FROM source_rights WHERE source_id=? ORDER BY sequence DESC LIMIT 1",
            (source_id,),
        ).fetchone()
        return SourceRights(**json.loads(row["payload"])) if row else None

    def retain_evidence(
        self,
        *,
        source_id: str,
        url: str,
        body: bytes,
        available_at: str,
        ingested_at: str,
        media_type: str = "application/json",
    ) -> Evidence:
        available_at, ingested_at = utc(available_at), utc(ingested_at)
        if instant(available_at) > instant(ingested_at):
            raise ValueError("evidence cannot be ingested before public availability")
        if not source_id or not url.startswith("https://") or not body:
            raise ValueError(
                "retained evidence requires source, original HTTPS URL and nonempty bytes"
            )
        digest = hashlib.sha256(body).hexdigest()
        evidence_id = content_id(
            "evidence",
            {
                "source_id": source_id,
                "url": url,
                "sha256": digest,
                "available_at": available_at,
                "media_type": media_type,
            },
        )
        with self.transaction():
            self.connection.execute(
                "INSERT OR IGNORE INTO evidence VALUES(?,?,?,?,?,?,?,?)",
                (evidence_id, source_id, url, digest, available_at, ingested_at, media_type, body),
            )
        result = self.evidence(evidence_id)
        assert result is not None
        return result

    def evidence(self, evidence_id: str) -> Evidence | None:
        row = self.connection.execute(
            "SELECT id,source_id,url,sha256,available_at,ingested_at,media_type FROM evidence WHERE id=?",
            (evidence_id,),
        ).fetchone()
        return Evidence(**dict(row)) if row else None

    def evidence_bytes(self, evidence_id: str) -> bytes:
        row = self.connection.execute(
            "SELECT body,sha256 FROM evidence WHERE id=?", (evidence_id,)
        ).fetchone()
        if row is None:
            raise KeyError(evidence_id)
        body = bytes(row["body"])
        if hashlib.sha256(body).hexdigest() != row["sha256"]:
            raise ValueError("retained evidence failed its content hash")
        return body

    def put_fact(self, fact: Fact) -> str:
        self.put_facts([fact])
        return fact.id

    def put_facts(self, facts: Iterable[Fact]) -> list[str]:
        ids: list[str] = []
        seen_evidence: dict[str, Evidence] = {}

        def rows() -> Iterator[tuple]:
            for fact in facts:
                evidence = seen_evidence.get(fact.evidence_id)
                if evidence is None:
                    evidence = self.evidence(fact.evidence_id)
                    if evidence is None:
                        raise ValueError("fact evidence must be retained before normalization")
                    seen_evidence[fact.evidence_id] = evidence
                if instant(fact.available_at) < instant(evidence.available_at):
                    raise ValueError("fact availability precedes its retained evidence")
                if instant(fact.ingested_at) < instant(evidence.ingested_at):
                    raise ValueError("fact ingestion precedes its retained evidence")
                series = series_id(fact.entity_id, fact.metric, fact.unit, fact.dimensions)
                ids.append(fact.id)
                yield (
                    fact.id,
                    fact.entity_id,
                    fact.metric,
                    fact.effective_at,
                    fact.available_at,
                    fact.ingested_at,
                    fact.evidence_id,
                    series,
                    fact.dimensions.get("ticker"),
                    canonical_json(asdict(fact)),
                )

        with self.transaction():
            self.connection.executemany(
                "INSERT OR IGNORE INTO facts VALUES(?,?,?,?,?,?,?,?,?,?)", rows()
            )
        return ids

    def facts(
        self,
        *,
        as_of: str,
        known_at: str | None = None,
        entity_id: str | None = None,
        metric: str | None = None,
    ) -> list[Fact]:
        terms = ["substr(effective_at,1,19)<=?", "substr(available_at,1,19)<=?"]
        args = [utc(as_of)[:19], utc(as_of)[:19]]
        if known_at is not None:
            terms.append("substr(ingested_at,1,19)<=?")
            args.append(utc(known_at)[:19])
        for column, value in (("entity_id", entity_id), ("metric", metric)):
            if value is not None:
                terms.append(f"{column}=?")
                args.append(value)
        rows = self.connection.execute(
            "SELECT payload FROM facts WHERE "
            + " AND ".join(terms)
            + " ORDER BY effective_at,available_at,ingested_at,id",
            args,
        )
        facts = [Fact(**json.loads(row["payload"])) for row in rows]
        return sorted(
            (
                fact
                for fact in facts
                if instant(fact.effective_at) <= instant(as_of)
                and instant(fact.available_at) <= instant(as_of)
                and (known_at is None or instant(fact.ingested_at) <= instant(known_at))
            ),
            key=lambda fact: (*_fact_time_key(fact), fact.id),
        )

    def latest_facts(self, **kwargs: object) -> list[Fact]:
        chosen: dict[str, Fact] = {}
        for fact in self.facts(**kwargs):
            key = series_id(fact.entity_id, fact.metric, fact.unit, fact.dimensions)
            previous = chosen.get(key)
            if (
                previous
                and _fact_time_key(previous) == _fact_time_key(fact)
                and previous.value != fact.value
            ):
                raise ValueError(
                    "conflicting facts at identical effective, public and ingestion times"
                )
            chosen[key] = fact
        return sorted(chosen.values(), key=lambda f: f.id)

    def historical_closes(
        self, ticker: str, start: str, end: str, known_at: str | None = None
    ) -> list[dict]:
        # Return-adjusted and provider split-adjusted closes are separate; neither
        # is an automatically supported historical nominal valuation price.
        start_at = utc(start + "T00:00:00Z" if len(start) == 10 else start)
        end_at = utc(end + "T00:00:00Z" if len(end) == 10 else end)
        terms = [
            "ticker=?",
            "metric='adjusted_close'",
            "substr(effective_at,1,19)>=?",
            "substr(effective_at,1,19)<=?",
        ]
        args = [ticker, start_at[:19], end_at[:19]]
        if known_at:
            terms.append("substr(ingested_at,1,19)<=?")
            args.append(utc(known_at)[:19])
        rows = self.connection.execute(
            "SELECT payload FROM facts WHERE "
            + " AND ".join(terms)
            + " ORDER BY effective_at,available_at,ingested_at,id",
            args,
        )
        prices: dict[int, dict] = {}
        facts = [Fact(**json.loads(row["payload"])) for row in rows]
        for fact in sorted(facts, key=lambda fact: (*_fact_time_key(fact), fact.id)):
            if fact.value is None or not instant(start_at) <= instant(fact.effective_at) < instant(
                end_at
            ):
                continue
            if known_at and instant(fact.ingested_at) > instant(known_at):
                continue
            date = int(instant(fact.effective_at).strftime("%Y%m%d"))
            prices[date] = {"date": date, "close": float(fact.value), "volume": None}
        return list(prices.values())

    def save_snapshot(self, payload: dict) -> str:
        snapshot_id = content_id("snapshot", payload)
        with self.transaction():
            self.connection.execute(
                "INSERT OR IGNORE INTO snapshots VALUES(?,?)",
                (snapshot_id, canonical_json(payload)),
            )
        return snapshot_id

    def snapshot(self, snapshot_id: str) -> dict | None:
        row = self.connection.execute(
            "SELECT payload FROM snapshots WHERE id=?", (snapshot_id,)
        ).fetchone()
        return {"snapshot_id": snapshot_id, **json.loads(row["payload"])} if row else None

    def dataset(
        self,
        *,
        as_of: str,
        entity_id: str | None = None,
        known_at: str | None = None,
        audience: str = "internal",
        required_metrics: Iterable[str] = (),
        freshness_days: int = 7,
    ) -> dict:
        if audience not in {"internal", "display", "export"}:
            raise ValueError("unknown dataset audience")
        if freshness_days < 0:
            raise ValueError("freshness_days must be nonnegative")
        facts = _current_period_facts(
            self.latest_facts(as_of=as_of, known_at=known_at, entity_id=entity_id)
        )
        retained: list[Fact] = []
        documents: dict[str, dict] = {}
        rights_versions: dict[str, str] = {}
        usage_rights: dict[str, dict] = {}
        withheld_sources: set[str] = set()
        for fact in facts:
            evidence = self.evidence(fact.evidence_id)
            assert evidence is not None
            rights = self.rights(evidence.source_id)
            if rights is not None:
                usage_rights[rights.id] = asdict(rights)
            if rights is None or not rights.allows(audience):
                withheld_sources.add(evidence.source_id)
                continue
            rights_versions[evidence.source_id] = rights.version_id
            retained.append(fact)
            documents[evidence.id] = asdict(evidence)
        required = sorted(set(required_metrics))
        present = {f.metric for f in retained if f.value is not None}
        missing = sorted(set(required) - present)
        stale = _stale_fact_ids(retained, as_of, freshness_days)
        payload = {
            "contract_version": CONTRACT_VERSION,
            "period_scope": "latest_reported_end_per_concept",
            "as_of": utc(as_of),
            "known_at": utc(known_at) if known_at else None,
            "entity_id": entity_id,
            "audience": audience,
            "facts": [f.to_dict() for f in retained],
            "evidence": [documents[k] for k in sorted(documents)],
            "rights_versions": rights_versions,
            "usage_rights": [usage_rights[key] for key in sorted(usage_rights)],
            "coverage": "unavailable"
            if not retained
            else "partial"
            if missing or withheld_sources
            else "complete",
            "freshness": "unavailable" if not retained else "stale" if stale else "fresh",
            "missing_metrics": missing,
            "stale_fact_ids": stale,
            "withheld_sources": sorted(withheld_sources),
            "required_metrics": required,
        }
        snapshot_id = self.save_snapshot(payload)
        return {"snapshot_id": snapshot_id, **payload}


Store = StockStore


def _stale_fact_ids(facts: list[Fact], as_of: str, freshness_days: int) -> list[str]:
    market_metrics = {"raw_close", "adjusted_close", "provider_close", "market_cap", "fx_rate"}
    return sorted(
        fact.id
        for fact in facts
        if instant(fact.effective_at)
        < instant(as_of)
        - timedelta(
            days=min(7, freshness_days) if fact.metric in market_metrics else freshness_days
        )
    )


def _current_period_facts(facts: list[Fact]) -> list[Fact]:
    """Current projections retain all durations ending at the latest reported date.

    The ledger retains older periods for as-of queries and replay. A companyfacts
    history must not become an unbounded current-publication or research payload.
    """
    keys = {
        fact.id: series_id(
            fact.entity_id,
            fact.metric,
            fact.unit,
            {
                key: value
                for key, value in fact.dimensions.items()
                if key not in {"period_start", "period_end"}
            },
        )
        for fact in facts
        if "period_end" in fact.dimensions
    }
    latest = {}
    for fact in facts:
        if fact.id in keys:
            key = keys[fact.id]
            latest[key] = max(latest.get(key, fact.effective_at), fact.effective_at)
    return [
        fact for fact in facts if fact.id not in keys or fact.effective_at == latest[keys[fact.id]]
    ]


def _fact_time_key(fact: Fact) -> tuple:
    return tuple(
        instant(value) for value in (fact.effective_at, fact.available_at, fact.ingested_at)
    )
