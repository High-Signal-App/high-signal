"""Canonical stock facts, retained evidence and deterministic valuation models.

Network adapters belong to the existing ingestion orchestrators. This module is
the shared storage/calculation boundary used by those adapters and their consumers.
"""

from .models import Entity, Evidence, Fact, Security, SourceRights
from .store import StockStore

__all__ = ["Entity", "Evidence", "Fact", "Security", "SourceRights", "StockStore"]
