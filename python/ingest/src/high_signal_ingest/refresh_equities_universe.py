"""Refresh the cached Wikipedia constituents file (committed to seed/).

    uv run python -m high_signal_ingest.refresh_equities_universe

Runs from a local machine (where Wikipedia tolerates the User-Agent) and
rewrites ``seed/wikipedia_constituents_cache.json``. The daily cron in GH
Actions reads this file — Wikipedia 403s GH Actions IPs regardless of UA.

Run this quarterly, or whenever index constituents change materially.
"""

from __future__ import annotations

import logging
import sys

from .sources.equities.wikipedia_constituents import (
    fetch_all_wikipedia_constituents,
    write_cache,
)


def main() -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )
    log = logging.getLogger(__name__)
    log.info("fetching all Wikipedia constituent tables…")
    specs = fetch_all_wikipedia_constituents()
    if not specs:
        log.error("no specs fetched — refusing to overwrite cache with empty data")
        return 1
    path = write_cache(specs)
    log.info("wrote %d rows to %s", len(specs), path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
