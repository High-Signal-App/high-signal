"""Replay manually checked PDF extractions against exact retained source pages."""

from __future__ import annotations

import hashlib
import io
import re
from decimal import Decimal

from pypdf import PdfReader

from ..stock_data.models import Fact
from ..stock_data.store import StockStore


def retain_reviewed_pdf(
    store: StockStore, body: bytes, packet: dict, *, ingested_at: str
) -> list[Fact]:
    """A changed PDF invalidates the extraction instead of reusing an old annotation.

    The packet is a manual extraction, not permission to display or export. The
    store's independent source-rights registry still controls every consumer.
    """
    if hashlib.sha256(body).hexdigest() != packet["sha256"]:
        raise ValueError("filing bytes changed; manual extraction requires review")
    if not packet.get("reviewed_by") or not packet.get("extractor_version"):
        raise ValueError("manual extraction requires reviewer and version")
    document = PdfReader(io.BytesIO(body))
    evidence = store.retain_evidence(
        source_id=packet["source_id"],
        url=packet["source_url"],
        body=body,
        available_at=packet["available_at"],
        ingested_at=ingested_at,
        media_type="application/pdf",
    )
    facts = []
    pages = {}
    for item in packet["facts"]:
        page_number = item["page"]
        if not isinstance(page_number, int) or not 1 <= page_number <= len(document.pages):
            raise ValueError("source page outside retained filing")
        if page_number not in pages:
            pages[page_number] = " ".join(
                document.pages[page_number - 1].extract_text(extraction_mode="layout").split()
            )
        excerpt = " ".join(item["excerpt"].split())
        if not excerpt or excerpt not in pages[page_number]:
            raise ValueError("supporting excerpt absent from retained source page")
        # Boundaries exclude a different amount which merely contains the token.
        raw_value = item["raw_value"]
        if not re.search(r"(?<![\d.,])" + re.escape(raw_value) + r"(?![\d.,])", excerpt):
            raise ValueError("source excerpt does not contain the exact numerical token")
        amount = Decimal(raw_value.replace(",", "")) * Decimal(str(item.get("scale", "1")))
        fact = Fact(
            entity_id=item["entity_id"],
            metric=item["metric"],
            value=str(amount),
            unit=item["unit"],
            effective_at=item["effective_at"],
            available_at=packet["available_at"],
            ingested_at=ingested_at,
            evidence_id=evidence.id,
            locator=f"PDF page {page_number}; {item['locator']}",
            dimensions=item.get("dimensions", {}),
            kind=item.get("kind", "observed"),
            extractor_version=packet["extractor_version"],
        )
        facts.append(fact)
    with store.transaction():
        store.put_facts(facts)
        store.save_snapshot(
            {
                "retained_evidence_id": evidence.id,
                "reviewed_extraction": packet,
                "input_fact_ids": sorted(f.id for f in facts),
            }
        )
    return facts
