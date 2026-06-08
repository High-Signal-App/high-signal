"""Typed dicts + Pydantic models shared across the ingest pipeline."""

from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field

Direction = Literal["up", "down", "neutral"]
Confidence = Literal["low", "medium", "high"]
EntityType = Literal["public", "private", "sector", "product"]
ReviewStatus = Literal["draft", "published", "corrected"]
RelationshipType = Literal["supplier", "customer", "peer", "subsidiary", "partner", "competitor"]


class Entity(BaseModel):
    id: str
    ticker: Optional[str] = None
    name: str
    type: EntityType
    country: Optional[str] = None
    sector: Optional[str] = None
    subsector: Optional[str] = None
    aliases: list[str] = Field(default_factory=list)
    wiki_url: Optional[str] = None
    ir_url: Optional[str] = None


class Relationship(BaseModel):
    from_entity_id: str
    to_entity_id: str
    type: RelationshipType
    weight: float = 1.0
    evidence_url: Optional[str] = None
    note: Optional[str] = None


class SourceDocument(BaseModel):
    canonical_url: Optional[str] = None
    document_key: Optional[str] = None
    fetched_at: Optional[datetime] = None
    published_at: Optional[datetime] = None
    raw_hash: Optional[str] = None
    raw_text: Optional[str] = None
    raw_json: Optional[dict] = None
    parsed_fields: Optional[dict] = None


class Event(BaseModel):
    id: str
    source: str
    source_url: str
    published_at: datetime
    title: Optional[str] = None
    content: Optional[str] = None
    primary_entity_id: Optional[str] = None
    raw_hash: str
    source_document: Optional[SourceDocument] = None


class EvidenceItem(BaseModel):
    url: str
    source_type: str
    excerpt: Optional[str] = None
    published_at: Optional[datetime] = None


class SignalCandidate(BaseModel):
    """LLM/rule-extracted signal awaiting review."""

    slug: str
    signal_type: str
    primary_entity_id: str
    direction: Direction
    confidence: Confidence
    predicted_window_days: int
    published_at: datetime
    evidence: list[EvidenceItem]
    spillover_entity_ids: list[str] = Field(default_factory=list)
    body_md: str
    supersedes_signal_id: Optional[str] = None
