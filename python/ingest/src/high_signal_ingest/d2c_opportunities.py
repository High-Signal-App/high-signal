"""India D2C Opportunity Pipeline — weekly source collector (plan 0013, Slice 2).

Pulls narrow public community samples for 20 curated India D2C niches and
writes a dated, cited JSON artifact under ``data/d2c-opportunities/``. The
renderer (``@high-signal/shared``) reads the latest artifact at build time and
falls back to seed-only briefs when no artifact exists.

Sources (free, public, citable):
  - Reddit (public JSON/RSS via the existing ``sources/reddit.py`` adapter)
  - Hacker News (Algolia API, free, key-less) — only for niches with a tech angle
  - Product Hunt RSS — new-entrant velocity (free, public)

Fragile sources are recorded as ``null`` with a ``freshnessDate`` so the
renderer can label staleness — they are NOT silently dropped:
  - Google Trends: no stable free API → ``demandScore`` may be null
  - Meta Ad Library: API limited for India commercial ads → ``adSaturationScore`` null
  - Marketplace / brand pages: per-site fragility → ``pricingScore`` / ``competitionScore`` null

Hard rules (PRD):
  - No impuls8 scraping or data copying. This module never requests impuls8.
  - No paid data provider dependency.
  - Cite or kill — every evidence item carries a URL.
  - Conservative wording on health/beauty claims (the niche seed carries the
    claim boundary; the collector does not generate claims).

Run::

    uv run python -m high_signal_ingest.d2c_opportunities [--days 7] [--limit 20] \\
        [--out data/d2c-opportunities]
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import re
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import httpx

from .sources.reddit import fetch_subreddit_async

LOGGER = logging.getLogger(__name__)
USER_AGENT = "linux:high-signal:0.1.0 (by /u/sarthak_research)"
HN_SEARCH_URL = "https://hn.algolia.com/api/v1/search_by_date"
PRODUCTHUNT_RSS_URL = "https://www.producthunt.com/feed"

# ---------------------------------------------------------------------------
# Niche seed — mirrors packages/shared/src/content/d2c-opportunities.ts.
# Keep in sync; the TS seed is the source of truth for rendering, this is the
# source of truth for collection queries.
# ---------------------------------------------------------------------------


@dataclass
class NicheQuery:
    slug: str
    name: str
    subs: list[str]
    keywords: list[str]
    hackernews: list[str] = field(default_factory=list)
    # Slice 4 — agent-visibility prompt fields. Optional so existing
    # constructor calls keep working; the agent-visibility runner fills them.
    category: str = ""
    targetUser: str = ""
    problem: str = ""


NICHES: list[NicheQuery] = [
    NicheQuery(
        "hair-growth-scalp-support",
        "Hair growth + scalp support",
        ["IndianSkincare", "IndianGlowup", "tressless"],
        ["hair fall", "scalp irritation", "minoxidil", "dandruff scalp"],
    ),
    NicheQuery(
        "lip-intimate-skincare-sensitive",
        "Lip + intimate skincare for sensitive skin",
        ["IndianSkincare", "IndianGlowup", "SkincareAddiction"],
        ["sensitive skin", "intimate wash", "fragrance free", "lip care"],
    ),
    NicheQuery(
        "hard-water-hair-care",
        "Hard-water hair care",
        ["IndianSkincare", "IndianGlowup", "bengaluru"],
        ["hard water", "hair fall", "shampoo", "chlorine"],
        hackernews=["hard water hair"],
    ),
    NicheQuery(
        "beard-dandruff-beard-scalp",
        "Beard dandruff / beard scalp care",
        ["IndianGlowup", "IndianSkincare", "beards"],
        ["beard dandruff", "beard itch", "beard flaking"],
    ),
    NicheQuery(
        "post-gym-mens-skin-wipes",
        "Post-gym men's skin wipes / sweat care",
        ["IndianFitness", "IndianGlowup", "fitness"],
        ["post gym", "sweat", "face wipe", "gym skincare"],
    ),
    NicheQuery(
        "delivery-rider-phone-accessories",
        "Delivery-rider phone accessories",
        ["IndianStartups", "bengaluru", "SwiggyZomato"],
        ["phone mount", "delivery rider", "rider phone", "bike mount"],
    ),
    NicheQuery(
        "heat-resistant-phone-mounts",
        "Heat-resistant phone mounts / commuter accessories",
        ["IndianStartups", "bengaluru", "motorcycles"],
        ["phone mount", "heat", "bike mount", "summer"],
        hackernews=["phone mount heat"],
    ),
    NicheQuery(
        "office-chai-healthy-snacks",
        "Office chai healthy snacks",
        ["IndianFoodAddicts", "IndianFitness", "EatCheapAndHealthy"],
        ["chai snack", "office snack", "protein biscuit", "healthy snack"],
    ),
    NicheQuery(
        "diabetic-friendly-travel-snacks",
        "Diabetic-friendly travel snacks",
        ["diabetes", "IndianFoodAddicts", "IndianFitness"],
        ["diabetic snack", "low gi", "travel snack", "sugar free"],
    ),
    NicheQuery(
        "high-protein-regional-snacks",
        "High-protein regional snacks",
        ["IndianFitness", "IndianFoodAddicts", "FitnessIndia"],
        ["protein snack", "khakhra", "chivda", "regional snack"],
    ),
    NicheQuery(
        "affordable-home-gym-under-5000",
        "Affordable home-gym accessories under INR 5,000",
        ["IndianFitness", "fitness", "homegym"],
        ["home gym", "resistance band", "budget gym", "under 5000"],
    ),
    NicheQuery(
        "womens-gym-shorts-fit",
        "Women's gym shorts / support and fit",
        ["IndianFitness", "xxfitness", "IndianGlowup"],
        ["gym shorts", "women fitness", "chafing", "leggings fit"],
    ),
    NicheQuery(
        "baby-lotions-transparent-ingredients",
        "Baby lotions/oils with transparent ingredients",
        ["IndianParents", "NewParents", "IndianSkincare"],
        ["baby lotion", "mineral oil", "fragrance free", "baby skincare"],
    ),
    NicheQuery(
        "ayurvedic-face-care-proof-first",
        "Ayurvedic face care with proof-first positioning",
        ["IndianSkincare", "IndianGlowup", "Ayurveda"],
        ["ayurvedic skincare", "kumkumadi", "herbal face", "proof"],
    ),
    NicheQuery(
        "sustainable-cleaning-laundry-refills",
        "Sustainable cleaning/laundry refills",
        ["IndianStartups", "environment", "IndianParents"],
        ["refill", "sustainable cleaning", "laundry", "plastic free"],
    ),
    NicheQuery(
        "pet-health-supplements",
        "Pet health supplements",
        ["IndianPetFood", "dogs", "pets"],
        ["pet supplement", "dog joint", "coat health", "gut"],
    ),
    NicheQuery(
        "oral-care-sub-niches",
        "Oral care sub-niches",
        ["IndianSkincare", "IndianGlowup", "Dentistry"],
        ["gum care", "sensitivity", "whitening", "oral care"],
    ),
    NicheQuery(
        "sleep-stress-support-products",
        "Sleep/stress support products",
        ["IndianFitness", "sleep", "IndianGlowup"],
        ["sleep", "ashwagandha", "magnesium", "stress"],
    ),
    NicheQuery(
        "intimate-hygiene",
        "Intimate hygiene",
        ["IndianSkincare", "IndianGlowup", "TwoXChromosomes"],
        ["intimate hygiene", "ph balanced", "fragrance free"],
    ),
    NicheQuery(
        "condiments-sauces-regional-identity",
        "Condiments/sauces with regional identity",
        ["IndianFoodAddicts", "cooking", "IndianCuisine"],
        ["regional sauce", "chettinad", "naga", "kashmiri", "curry paste"],
    ),
]


# Slice 4 — agent-visibility prompt fields. Enriched from the TS seed
# (packages/shared/src/content/d2c-opportunities.ts) so the Python runner
# can build category prompts without duplicating the seed.
_ENRICHMENT: dict[str, tuple[str, str, str]] = {
    "hair-growth-scalp-support": (
        "personal-care",
        "Indian men 22-35 seeing early thinning or scalp irritation",
        "People search for minoxidil compatibility and irritation support, not generic hair oil; existing ayurvedic oils make unverified claims.",
    ),
    "lip-intimate-skincare-sensitive": (
        "personal-care",
        "Indian women 20-40 with sensitive skin avoiding fragrance and common irritants",
        "Lip and intimate care products are either medicated (clinical) or heavily fragranced; a sensitive-skin middle ground is thin.",
    ),
    "hard-water-hair-care": (
        "personal-care",
        "Indian urban renters in hard-water cities (Bengaluru, Hyderabad, Chennai)",
        "Hard water causes hair fall and dullness complaints; most shampoos are not formulated for chelating calcium/magnesium.",
    ),
    "beard-dandruff-beard-scalp": (
        "personal-care",
        "Indian men 20-35 with beards experiencing flaking and itch",
        "Beard dandruff is treated with anti-dandruff shampoo for the scalp, not the beard; beard-specific care is underbuilt.",
    ),
    "post-gym-mens-skin-wipes": (
        "personal-care",
        "Indian men 20-35 who gym commute and need on-the-go refresh",
        "Gym-goers want a sweat-friendly wipe that does not over-dry; existing wipes are baby or facial, not sport-formulated.",
    ),
    "delivery-rider-phone-accessories": (
        "accessories",
        "Indian gig delivery riders (Zomato/Swiggy/Zepto) on 8-12 hour shifts",
        "Riders kill phones from heat, rain, and mount vibration; existing mounts are car-focused, not gig-shift-rated.",
    ),
    "heat-resistant-phone-mounts": (
        "accessories",
        "Indian two-wheeler commuters in high-heat cities",
        "Phone mounts fail in Indian summer heat and monsoon humidity; adhesive and suction mounts melt or slip.",
    ),
    "office-chai-healthy-snacks": (
        "food",
        "Indian office workers 25-40 replacing biscuit + chai with better-for-you",
        "Chai-time snacking defaults to sugar-heavy biscuits; protein-fortified or low-GI chai snacks are sparse.",
    ),
    "diabetic-friendly-travel-snacks": (
        "food",
        "Indian diabetics and pre-diabetics traveling for work",
        "Travel snacks for diabetics are either clinical (glucose biscuits) or unavailable; low-GI portable options are thin.",
    ),
    "high-protein-regional-snacks": (
        "food",
        "Indian fitness-curious 20-35 wanting regional flavors with protein",
        "Protein snacks are chocolate/vanilla imported formats; regional savory formats (khakhra, chivda) with protein are rare.",
    ),
    "affordable-home-gym-under-5000": (
        "fitness",
        "Indian 20-35 starting home workouts on a tight budget",
        "Home-gym kits are either expensive (INR 20k+) or low-quality; a curated under-INR-5k kit is missing.",
    ),
    "womens-gym-shorts-fit": (
        "apparel",
        "Indian women 20-35 lifting or running, frustrated by fit and chafing",
        "Women's gym shorts are either imported expensive brands or low-quality local; fit for Indian body shapes + chafe-free is underbuilt.",
    ),
    "baby-lotions-transparent-ingredients": (
        "baby-care",
        "Indian new parents 25-35 reading ingredient panels",
        "Parents want baby lotions without mineral oil, fragrance, and parabens; incumbents still lead with old formulations.",
    ),
    "ayurvedic-face-care-proof-first": (
        "personal-care",
        "Indian 22-40 open to ayurveda but skeptical of unverified claims",
        "Ayurvedic skincare makes traditional claims without evidence; a proof-first (patch test, panel results) brand is missing.",
    ),
    "sustainable-cleaning-laundry-refills": (
        "home",
        "Indian urban renters 25-40 reducing plastic and chemical load",
        "Refill-based, low-plastic cleaning products are niche in India; most cleaning is single-use plastic bottles.",
    ),
    "pet-health-supplements": (
        "pet-care",
        "Indian urban pet owners 25-45 spending on pet wellness",
        "Pet supplements (joint, coat, gut) are imported and expensive; affordable India-made supplements with vetted formulations are thin.",
    ),
    "oral-care-sub-niches": (
        "personal-care",
        "Indian 20-40 looking for specific oral care (sensitivity, whitening, gum)",
        "Oral care is dominated by Colgate/Pepsodent; sub-niche products (gum care, sensitivity serum) are underbuilt.",
    ),
    "sleep-stress-support-products": (
        "wellness",
        "Indian 25-45 with sleep/stress issues avoiding pharmaceuticals",
        "Sleep products are either pharmaceuticals or unverified herbal; a middle ground (mag glycinate + ashwagandha) with dosing transparency is missing.",
    ),
    "intimate-hygiene": (
        "personal-care",
        "Indian women 20-40 seeking pH-balanced intimate care without fragrance",
        "Intimate hygiene products are either clinical or heavily marketed; a transparent, pH-balanced, fragrance-free line is thin.",
    ),
    "condiments-sauces-regional-identity": (
        "food",
        "Indian 25-45 cooking regional cuisine, frustrated by generic sauces",
        "Sauces are either generic (Maggi, Ching's) or imported expensive; region-specific (Chettinad, Naga, Kashmiri) D2C sauces are emerging.",
    ),
}

for _n in NICHES:
    _cat, _tu, _prob = _ENRICHMENT.get(_n.slug, ("", "", ""))
    _n.category = _cat
    _n.targetUser = _tu
    _n.problem = _prob
del _n, _cat, _tu, _prob


# ---------------------------------------------------------------------------
# Evidence item + niche evidence (mirrors the TS D2CEvidenceItem / D2CNicheEvidence)
# ---------------------------------------------------------------------------


@dataclass
class EvidenceItem:
    sourceClass: (
        str  # community | search | product | review | ad-library | launch | agent-visibility
    )
    url: str
    source: str | None
    snippet: str
    observedAt: str  # ISO


@dataclass
class NicheEvidence:
    nicheSlug: str
    demandScore: float | None
    competitionScore: float | None
    pricingScore: float | None
    adSaturationScore: float | None
    agentVisibilityScore: float | None
    evidence: list[EvidenceItem]
    freshnessDate: str
    notes: str | None = None


@dataclass
class Artifact:
    generatedAt: str
    region: str
    niches: list[NicheEvidence]


# ---------------------------------------------------------------------------
# Collectors
# ---------------------------------------------------------------------------


def _matches(text: str, keywords: list[str]) -> bool:
    if not keywords:
        return False
    low = text.lower()
    return any(k.lower() in low for k in keywords)


def _snippet(text: str, max_len: int = 200) -> str:
    cleaned = re.sub(r"\s+", " ", text or "").strip()
    if len(cleaned) <= max_len:
        return cleaned
    return cleaned[: max_len - 1].rstrip() + "…"


async def collect_reddit(
    niche: NicheQuery,
    since: datetime,
    client: httpx.AsyncClient,
    limit_per_sub: int = 25,
    min_score: int = 5,
) -> list[EvidenceItem]:
    """Pull recent posts from the niche's Reddit subs, filtered by keywords."""
    out: list[EvidenceItem] = []
    for sub in niche.subs:
        events = await fetch_subreddit_async(
            sub, since, client, limit=limit_per_sub, min_score=min_score
        )
        for ev in events:
            text = f"{ev.title or ''} {ev.content or ''}"
            if not _matches(text, niche.keywords):
                continue
            out.append(
                EvidenceItem(
                    sourceClass="community",
                    url=ev.source_url or "",
                    source=f"reddit:{sub}",
                    snippet=_snippet(f"{ev.title or ''} — {ev.content or ''}".strip(" —")),
                    observedAt=ev.published_at.isoformat()
                    if ev.published_at
                    else datetime.now(timezone.utc).isoformat(),
                )
            )
    # Dedupe by URL, cap at 8 cited items per niche.
    seen: set[str] = set()
    deduped: list[EvidenceItem] = []
    for item in out:
        if not item.url or item.url in seen:
            continue
        seen.add(item.url)
        deduped.append(item)
        if len(deduped) >= 8:
            break
    return deduped


async def collect_hackernews(
    niche: NicheQuery, since: datetime, client: httpx.AsyncClient
) -> list[EvidenceItem]:
    """Algolia HN search for niches with a tech angle (commuter accessories, etc.)."""
    if not niche.hackernews:
        return []
    out: list[EvidenceItem] = []
    for query in niche.hackernews:
        params = {
            "query": query,
            "tags": "story",
            "numericFilters": f"created_at_i>={int(since.timestamp())},points>=8",
            "hitsPerPage": 10,
        }
        try:
            r = await client.get(HN_SEARCH_URL, params=params)
        except httpx.HTTPError as exc:
            LOGGER.debug("hn fetch failed query=%s error=%s", query, exc)
            continue
        if r.status_code != 200:
            continue
        try:
            hits = r.json().get("hits", []) or []
        except ValueError:
            continue
        for hit in hits:
            if not isinstance(hit, dict):
                continue
            title = str(hit.get("title") or "").strip()
            object_id = str(hit.get("objectID") or "").strip()
            if not title or not object_id:
                continue
            out.append(
                EvidenceItem(
                    sourceClass="community",
                    url=f"https://news.ycombinator.com/item?id={object_id}",
                    source="hackernews",
                    snippet=_snippet(title),
                    observedAt=datetime.fromtimestamp(
                        int(hit.get("created_at_i") or 0), tz=timezone.utc
                    ).isoformat(),
                )
            )
    return out


async def collect_producthunt(
    since: datetime, client: httpx.AsyncClient, limit: int = 30
) -> list[EvidenceItem]:
    """Product Hunt RSS — new-entrant velocity. Filtered by niche keywords at
    the niche level (this returns the raw feed; niches pick matching items)."""
    try:
        r = await client.get(PRODUCTHUNT_RSS_URL)
    except httpx.HTTPError as exc:
        LOGGER.debug("producthunt fetch failed error=%s", exc)
        return []
    if r.status_code != 200:
        return []
    # Minimal RSS parse — avoid a feedparser dependency for one feed.
    out: list[EvidenceItem] = []
    for match in re.finditer(r"<item>(.*?)</item>", r.text, re.DOTALL):
        block = match.group(1)
        title = _rss_field(block, "title")
        link = _rss_field(block, "link")
        pub = _rss_field(block, "pubDate")
        if not title or not link:
            continue
        try:
            ts = datetime.strptime(pub, "%a, %d %b %Y %H:%M:%S %Z").astimezone(timezone.utc)
        except (ValueError, TypeError):
            continue
        if ts < since:
            continue
        out.append(
            EvidenceItem(
                sourceClass="launch",
                url=link,
                source="producthunt",
                snippet=_snippet(title),
                observedAt=ts.isoformat(),
            )
        )
        if len(out) >= limit:
            break
    return out


def _rss_field(block: str, name: str) -> str | None:
    m = re.search(rf"<{name}>(.*?)</{name}>", block, re.DOTALL)
    return m.group(1).strip() if m else None


# ---------------------------------------------------------------------------
# Scoring (mirrors the TS scoreD2CNiche / verdictForScore conservatively)
# ---------------------------------------------------------------------------


def _demand_score(evidence: list[EvidenceItem]) -> float | None:
    """0–1 demand momentum from community evidence volume. null when empty."""
    community = [e for e in evidence if e.sourceClass == "community"]
    if not community:
        return None
    # 1 item → 0.3, 3 → 0.5, 6+ → 0.7, capped at 0.85.
    return min(0.85, 0.2 + 0.1 * len(community))


def _source_diversity(evidence: list[EvidenceItem]) -> float:
    classes = {e.sourceClass for e in evidence}
    return (
        len(classes) / 7.0
    )  # 7 source classes (community/search/product/review/ad-library/launch/agent-visibility)


def _assign_launch_evidence(niche: NicheQuery, ph_items: list[EvidenceItem]) -> list[EvidenceItem]:
    if not ph_items:
        return []
    matched = [
        e
        for e in ph_items
        if _matches(e.snippet, niche.keywords) or _matches(e.snippet, niche.subs)
    ]
    return matched[:3]


async def collect_niche(
    niche: NicheQuery,
    since: datetime,
    client: httpx.AsyncClient,
    ph_items: list[EvidenceItem],
) -> NicheEvidence:
    reddit = await collect_reddit(niche, since, client)
    hn = await collect_hackernews(niche, since, client)
    launch = _assign_launch_evidence(niche, ph_items)
    evidence = reddit + hn + launch

    demand = _demand_score(evidence)
    diversity = _source_diversity(evidence)
    # competition / pricing / ad-saturation / agent-visibility are null in
    # Slice 2 — their sources (marketplace pages, Meta Ad Library, agent
    # prompts) are deferred. The renderer labels staleness via freshnessDate.
    return NicheEvidence(
        nicheSlug=niche.slug,
        demandScore=demand,
        competitionScore=None,
        pricingScore=None,
        adSaturationScore=None,
        agentVisibilityScore=None,
        evidence=evidence,
        freshnessDate=datetime.now(timezone.utc).isoformat(),
        notes=(
            f"diversity={diversity:.2f}; competition/pricing/ad/agent deferred "
            f"(marketplace + Meta Ad Library + agent prompts are Slice 3/4)"
        ),
    )


# ---------------------------------------------------------------------------
# Runner
# ---------------------------------------------------------------------------


async def run(
    days: int = 7,
    limit: int = 20,
    out_dir: Path = Path("data/d2c-opportunities"),
) -> Path:
    since = datetime.now(timezone.utc) - timedelta(days=days)
    timeout = httpx.Timeout(20.0, connect=10.0)
    headers = {"User-Agent": USER_AGENT}
    niches = NICHES[:limit]
    async with httpx.AsyncClient(headers=headers, follow_redirects=True, timeout=timeout) as client:
        ph_items = await collect_producthunt(since, client)
        results = await asyncio.gather(*(collect_niche(n, since, client, ph_items) for n in niches))

    artifact = Artifact(
        generatedAt=datetime.now(timezone.utc).isoformat(),
        region="IN",
        niches=list(results),
    )
    out_dir.mkdir(parents=True, exist_ok=True)
    date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    out_path = out_dir / f"{date_str}.json"
    out_path.write_text(
        json.dumps(_artifact_to_dict(artifact), indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    LOGGER.info("wrote d2c artifact: %s (%d niches)", out_path, len(artifact.niches))
    return out_path


def _artifact_to_dict(artifact: Artifact) -> dict[str, Any]:
    return {
        "generatedAt": artifact.generatedAt,
        "region": artifact.region,
        "niches": [
            {
                **asdict(n),
                "evidence": [asdict(e) for e in n.evidence],
            }
            for n in artifact.niches
        ],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="India D2C opportunity collector")
    parser.add_argument("--days", type=int, default=7, help="lookback window in days")
    parser.add_argument("--limit", type=int, default=20, help="max niches to collect")
    parser.add_argument(
        "--out",
        type=str,
        default="data/d2c-opportunities",
        help="output directory for dated JSON artifacts",
    )
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    out_path = asyncio.run(run(days=args.days, limit=args.limit, out_dir=Path(args.out)))
    print(f"wrote {out_path}")


if __name__ == "__main__":
    main()
