"""Read-only source availability diagnostic.

This reports whether optional credentials and local tools are present without
printing their values. It is intentionally cheaper than a source-yield audit:
use this first to distinguish "source cannot run here" from "source ran but
returned low-quality/noisy data".
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
from dataclasses import asdict, dataclass


@dataclass(frozen=True)
class Check:
    name: str
    kind: str
    status: str
    requirement: str
    notes: str


def _env_present(name: str) -> bool:
    return bool(os.environ.get(name))


def _all_env(names: list[str]) -> bool:
    return all(_env_present(name) for name in names)


def _any_env(names: list[str]) -> bool:
    return any(_env_present(name) for name in names)


def _env_check(
    name: str,
    env_names: list[str],
    *,
    required: bool,
    notes: str,
    any_of: bool = False,
) -> Check:
    present = _any_env(env_names) if any_of else _all_env(env_names)
    if present:
        status = "available"
    elif required:
        status = "credential-missing"
    else:
        status = "optional-missing"
    joiner = " or " if any_of else " + "
    return Check(
        name=name,
        kind="env",
        status=status,
        requirement=joiner.join(env_names),
        notes=notes,
    )


def _bin_check(name: str, bins: list[str], *, required: bool, notes: str) -> Check:
    present = all(shutil.which(binary) for binary in bins)
    if present:
        status = "available"
    elif required:
        status = "unavailable"
    else:
        status = "optional-missing"
    return Check(
        name=name,
        kind="binary",
        status=status,
        requirement=" + ".join(bins),
        notes=notes,
    )


def checks() -> list[Check]:
    return [
        Check(
            name="rss/news/reddit/gov/public feeds",
            kind="built-in",
            status="available",
            requirement="network",
            notes="Core public fetch paths do not require project secrets.",
        ),
        _env_check(
            "signal generation",
            ["AI_API_KEY", "HF_TOKEN"],
            required=False,
            any_of=True,
            notes="Without a model key, pipeline can still emit fallback drafts but quality is lower.",
        ),
        _env_check(
            "D1 admin writes",
            ["API_BASE", "ADMIN_TOKEN"],
            required=False,
            notes=(
                "Required for production event persistence. Without both values, fetches can "
                "succeed while /data and ingest_runs remain unchanged."
            ),
        ),
        _env_check(
            "SEC identity",
            ["SEC_USER_AGENT"],
            required=False,
            notes="Required for production EDGAR/SEC access hygiene; local adapters have a fallback identity.",
        ),
        _env_check(
            "GitHub API rate limit",
            ["GITHUB_TOKEN"],
            required=False,
            notes="Optional; unauthenticated GitHub release fetches are lower-rate.",
        ),
        _env_check(
            "Guardian",
            ["GUARDIAN_API_KEY"],
            required=True,
            notes="Guardian source returns no events without this key.",
        ),
        _env_check(
            "Companies House",
            ["COMPANIES_HOUSE_API_KEY"],
            required=True,
            notes="Manual/enrichment source; skipped without this key.",
        ),
        _env_check(
            "Regulations.gov",
            ["REGULATIONS_GOV_API_KEY"],
            required=True,
            notes="Regulatory follow-up source; skipped without this key.",
        ),
        _env_check(
            "OpenStates",
            ["OPENSTATES_API_KEY"],
            required=False,
            notes="Optional for local source audits; state-legislature bills are skipped without this key.",
        ),
        _env_check(
            "EIA energy",
            ["EIA_API_KEY"],
            required=False,
            notes="Optional for local source audits; industrial electricity-price events are skipped without this key.",
        ),
        _env_check(
            "US government API family",
            [
                "BEA_API_KEY",
                "CENSUS_API_KEY",
                "CONGRESS_API_KEY",
                "FEC_API_KEY",
                "LDA_API_KEY",
                "FDA_API_KEY",
                "USDA_NASS_API_KEY",
            ],
            required=False,
            notes="Optional depth for us-gov-api; one api.data.gov key can populate these env vars.",
        ),
        _env_check(
            "SAM.gov contracts",
            ["SAM_API_KEY"],
            required=False,
            notes="USAspending/SBIR still run; SAM opportunities are skipped without this key.",
        ),
        _env_check(
            "Bluesky",
            ["BLUESKY_IDENTIFIER", "BLUESKY_APP_PASSWORD"],
            required=True,
            notes="Bluesky search source is skipped unless both auth values are present.",
        ),
        _env_check(
            "Podcast Index",
            ["PODCAST_INDEX_KEY", "PODCAST_INDEX_SECRET"],
            required=True,
            notes="Podcast metadata source is skipped unless both values are present.",
        ),
        _env_check(
            "Metaculus",
            ["METACULUS_TOKEN"],
            required=True,
            notes="Forecast context source is skipped without this token.",
        ),
        _env_check(
            "FRED macro rates",
            ["FRED_API_KEY"],
            required=False,
            notes="ECB FX still runs; FRED series are skipped without this key.",
        ),
        _env_check(
            "Etherscan gas/on-chain",
            ["ETHERSCAN_API_KEY"],
            required=False,
            notes="Optional; crypto-onchain still uses keyless mempool.space/L2Beat/CoinMetrics paths.",
        ),
        _env_check(
            "Semantic Scholar rate limit",
            ["SEMANTIC_SCHOLAR_API_KEY"],
            required=False,
            notes="Optional; public research search can run without it at lower rate.",
        ),
        _bin_check(
            "pnpm workspace",
            ["pnpm"],
            required=True,
            notes="Needed for repo scripts, tests, and signal sync helpers.",
        ),
        _bin_check(
            "uv Python workspace",
            ["uv"],
            required=True,
            notes="Needed for Python ingest and lab commands.",
        ),
        _bin_check(
            "wrangler",
            ["wrangler"],
            required=False,
            notes="Needed for D1 migrate/seed/deploy commands when not using package scripts to resolve it.",
        ),
    ]


def run(
    json_output: bool = False,
    *,
    require_persistence: bool = False,
    require_sec_identity: bool = False,
) -> int:
    rows = checks()
    if json_output:
        print(json.dumps([asdict(row) for row in rows], indent=2))
    else:
        for row in rows:
            print(f"{row.name}: {row.status} ({row.kind}: {row.requirement})")
            print(f"  {row.notes}")

    credential_missing = [row for row in rows if row.status == "credential-missing"]
    unavailable = [row for row in rows if row.status == "unavailable"]
    fatal: list[str] = []
    by_name = {row.name: row for row in rows}
    if require_persistence and by_name["D1 admin writes"].status != "available":
        fatal.append("D1 admin writes require API_BASE + ADMIN_TOKEN")
    if require_sec_identity and by_name["SEC identity"].status != "available":
        fatal.append("SEC identity requires SEC_USER_AGENT")

    if unavailable or credential_missing:
        if unavailable:
            print(f"\n{len(unavailable)} required local tool(s) unavailable here.")
        if credential_missing:
            print(f"\n{len(credential_missing)} credential-gated source path(s) unavailable here.")
    else:
        print("\nsource availability diagnostic OK")

    if fatal:
        print("\nproduction ingest preflight failed:")
        for item in fatal:
            print(f"  - {item}")
        return 1

    return 0


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--json", action="store_true")
    parser.add_argument(
        "--require-persistence",
        action="store_true",
        help="Exit non-zero unless API_BASE and ADMIN_TOKEN are present.",
    )
    parser.add_argument(
        "--require-sec-identity",
        action="store_true",
        help="Exit non-zero unless SEC_USER_AGENT is present.",
    )
    args = parser.parse_args()
    raise SystemExit(
        run(
            json_output=args.json,
            require_persistence=args.require_persistence,
            require_sec_identity=args.require_sec_identity,
        )
    )


if __name__ == "__main__":
    main()
