"""Synthetic, openly permitted fixture for the actual Python-to-Worker contract."""

import json
from datetime import datetime, timezone

from high_signal_ingest.stock_data import Entity, Fact, Security, SourceRights, StockStore
from high_signal_ingest.stock_data.replication import records
from high_signal_ingest.stock_data_refresh import materialize

now = datetime.now(timezone.utc).isoformat()
with StockStore(":memory:") as store:
    store.put_entity(Entity("parent", "Fixture holding company", "IN"))
    store.put_entity(Entity("asset", "Fixture listed company", "IN"))
    store.put_security(Security("security:asset", "asset", "FIXTURE.NS", "INR"))
    store.put_rights(
        SourceRights(
            "fixture",
            "https://example.org/fixture-licence",
            "permitted",
            "permitted",
            "prohibited",
            reviewed_at=now,
        )
    )
    evidence = store.retain_evidence(
        source_id="fixture",
        url="https://example.org/fixture-filing",
        body=b'{"shares_owned":10,"raw_close":20,"market_cap":100}' + b" " * 600_000,
        available_at=now,
        ingested_at=now,
    )
    for entity, metric, value, unit, dimensions in [
        (
            "parent",
            "shares_owned",
            "10",
            "shares",
            {"asset_entity_id": "asset", "security_id": "security:asset", "share_basis": "basis-1"},
        ),
        (
            "asset",
            "raw_close",
            "20",
            "INR",
            {"security_id": "security:asset", "share_basis": "basis-1", "price_basis": "nominal"},
        ),
        ("parent", "market_cap", "100", "INR", {}),
    ]:
        store.put_fact(
            Fact(entity, metric, value, unit, now, now, now, evidence.id, f"/{metric}", dimensions)
        )
    publication = {
        "display": materialize(store, as_of=now),
        "export": materialize(store, as_of=now, audience="export"),
    }
    print(json.dumps({"records": list(records(store)), "publication": publication}))
