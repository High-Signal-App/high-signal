"""India D2C Opportunity Pipeline — weekly source collector (plan 0013, Slice 2).

Pulls narrow public community samples for 20 curated India D2C niches and
writes a dated, cited JSON artifact under ``data/d2c-opportunities/``. The
renderer (``@high-signal/shared``) reads the latest artifact at build time and
falls back to seed-only briefs when no artifact exists.

Sources (free, public, citable):
  - Reddit (OAuth or RSS via the existing ``sources/reddit.py`` adapter)
  - Hacker News (Algolia API, free, key-less) — only for niches with a tech angle
  - Product Hunt RSS — new-entrant velocity (free, public)
  - Amazon India search — product listings with prices and ratings
    (sourceClass="product"; competition + pricing scores derived from these)
  - Meta Ad Library API — ad saturation signal (requires META_ACCESS_TOKEN;
    fail-closed when not set)

Fragile sources are recorded as ``null`` with a ``freshnessDate`` so the
renderer can label staleness — they are NOT silently dropped:
  - Google Trends: no stable free API → ``demandScore`` may be null
  - Meta Ad Library: requires identity verification → ``adSaturationScore`` null

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
import os
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


def _competition_score(evidence: list[EvidenceItem]) -> float | None:
    """0–1 competition gap (higher = less competition = more opportunity).
    Based on the number of Amazon products found: 0 products → null (no
    data), 1-2 → high gap (0.8), 3-5 → medium (0.5), 6+ → low (0.2)."""
    products = [e for e in evidence if e.sourceClass == "product"]
    if not products:
        return None
    n = len(products)
    if n <= 2:
        return 0.8
    if n <= 5:
        return 0.5
    return 0.2


def _pricing_score(evidence: list[EvidenceItem]) -> float | None:
    """0–1 pricing accessibility (higher = more affordable = more opportunity).
    Extracts prices from Amazon product snippets. null when no prices found."""
    products = [e for e in evidence if e.sourceClass == "product"]
    prices: list[float] = []
    for p in products:
        # Extract price from snippet: "Product Title — ₹960 — 4.3 out of 5"
        match = re.search(r"₹([\d,]+)", p.snippet)
        if match:
            price = float(match.group(1).replace(",", ""))
            prices.append(price)
    if not prices:
        return None
    median = sorted(prices)[len(prices) // 2]
    # ₹0-300 → 0.9 (very affordable), ₹300-800 → 0.6, ₹800-2000 → 0.4, ₹2000+ → 0.2
    if median <= 300:
        return 0.9
    if median <= 800:
        return 0.6
    if median <= 2000:
        return 0.4
    return 0.2


def _ad_saturation_score(evidence: list[EvidenceItem]) -> float | None:
    """0–1 ad saturation (higher = less saturation = more opportunity).
    Based on Meta Ad Library results: 0 ads → null (no data), 1-2 → high
    gap (0.8), 3+ → low gap (0.2)."""
    ads = [e for e in evidence if e.sourceClass == "ad-library"]
    if not ads:
        return None
    if len(ads) <= 2:
        return 0.8
    return 0.2


def _source_diversity(evidence: list[EvidenceItem]) -> float:
    classes = {e.sourceClass for e in evidence}
    return (
        len(classes) / 7.0
    )  # 7 source classes (community/search/product/review/ad-library/launch/agent-visibility)


# ---------------------------------------------------------------------------
# Amazon India collector — sourceClass "product"
# ---------------------------------------------------------------------------

AMAZON_IN_SEARCH_URL = "https://www.amazon.in/s"
# Amazon blocks default httpx User-Agent; use a real browser UA.
AMAZON_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml",
    "Accept-Language": "en-IN,en;q=0.9",
    "Accept-Encoding": "identity",  # avoid gzip — easier to parse
}

# Semaphore: Amazon will block if we hit too many searches concurrently.
# 1 at a time with a small delay is safe. Lazy-initialized to avoid
# cross-event-loop issues in tests.
_AMAZON_SEMAPHORE: asyncio.Semaphore | None = None
_AMAZON_DELAY = 5.0  # seconds between Amazon requests (avoid 503)
_AMAZON_RETRIES = 2  # retry on 503 with exponential backoff


def _get_amazon_semaphore() -> asyncio.Semaphore:
    global _AMAZON_SEMAPHORE
    if _AMAZON_SEMAPHORE is None:
        _AMAZON_SEMAPHORE = asyncio.Semaphore(1)
    return _AMAZON_SEMAPHORE


def _parse_amazon_search(html: str, query: str) -> list[EvidenceItem]:
    """Extract product listings from an Amazon.in search results page."""
    out: list[EvidenceItem] = []
    seen_asins: set[str] = set()

    # Each product card has data-asin="B0XXXXXX". Extract the card block.
    # Amazon's HTML is messy — we use a tolerant approach: find each asin,
    # then look for the nearest title and price.
    card_re = re.compile(
        r'data-asin="([A-Z0-9]{10})".*?(?=data-asin="[A-Z0-9]{10}"|$)',
        re.DOTALL,
    )
    for match in card_re.finditer(html):
        asin = match.group(1)
        if asin in seen_asins:
            continue
        seen_asins.add(asin)
        block = match.group(0)

        # Title: <h2>...<span>Product Title</span>...</h2>
        title_match = re.search(
            r'<h2[^>]*>.*?<span[^>]*>([^<]{15,200})</span>',
            block,
            re.DOTALL,
        )
        if not title_match:
            continue
        title = title_match.group(1).strip()
        # Skip navigation/pagination text
        if "results for" in title or "buying options" in title:
            continue

        # Price: a-price-whole">NNN
        price_match = re.search(r'a-price-whole">([^<]+)<', block)
        price = price_match.group(1).strip() if price_match else ""

        # Rating: a-icon-alt">X.X out of 5
        rating_match = re.search(r'a-icon-alt">([\d.]+ out of 5)', block)
        rating = rating_match.group(1) if rating_match else ""

        # Review count
        review_match = re.search(r'(\d[\d,]*)\s+ratings?', block)
        reviews = review_match.group(1) if review_match else ""

        url = f"https://www.amazon.in/dp/{asin}"
        snippet_parts = [title]
        if price:
            snippet_parts.append(f"₹{price}")
        if rating:
            snippet_parts.append(f"{rating}")
        if reviews:
            snippet_parts.append(f"{reviews} ratings")
        snippet = " — ".join(snippet_parts)

        out.append(
            EvidenceItem(
                sourceClass="product",
                url=url,
                source="amazon:in",
                snippet=snippet[:300],
                observedAt=datetime.now(timezone.utc).isoformat(),
            )
        )
        if len(out) >= 5:
            break

    return out


async def collect_amazon(
    niche: NicheQuery,
    client: httpx.AsyncClient,
) -> list[EvidenceItem]:
    """Search Amazon.in for the niche's primary keyword. Returns up to 5
    product listings as `sourceClass="product"` evidence."""
    # Use the first keyword as the search query — it's the most specific.
    query = niche.keywords[0] if niche.keywords else niche.name
    params = {"k": query}
    async with _get_amazon_semaphore():
        await asyncio.sleep(_AMAZON_DELAY)
        for attempt in range(_AMAZON_RETRIES + 1):
            try:
                r = await client.get(
                    AMAZON_IN_SEARCH_URL,
                    params=params,
                    headers=AMAZON_HEADERS,
                )
            except httpx.HTTPError as exc:
                LOGGER.debug("amazon fetch failed niche=%s error=%s", niche.slug, exc)
                return []
            if r.status_code == 200:
                break
            if r.status_code == 503 and attempt < _AMAZON_RETRIES:
                # 503 = rate-limited/captcha. Wait and retry.
                wait = 10.0 * (attempt + 1)
                LOGGER.info(
                    "amazon 503 niche=%s, retrying in %.0fs (attempt %d/%d)",
                    niche.slug, wait, attempt + 1, _AMAZON_RETRIES,
                )
                await asyncio.sleep(wait)
                continue
            LOGGER.debug("amazon fetch failed niche=%s status=%s", niche.slug, r.status_code)
            return []
    products = _parse_amazon_search(r.text, query)
    LOGGER.info(
        "amazon niche=%s query=%r → %d products", niche.slug, query, len(products)
    )
    return products


# ---------------------------------------------------------------------------
# Meta Ad Library collector — sourceClass "ad-library"
# ---------------------------------------------------------------------------

# The Meta Ad Library API requires identity verification + a developer
# account, which is a multi-day process. Instead, we use the public Ad
# Library search page which is accessible without auth. We don't scrape ad
# details — we just check whether ads exist for the niche's keywords in
# India and count them as a binary signal (ads present = saturated).
AD_LIBRARY_URL = "https://www.facebook.com/ads/library/"
_AD_LIBRARY_SEMAPHORE: asyncio.Semaphore | None = None
_AD_LIBRARY_DELAY = 3.0


def _get_ad_library_semaphore() -> asyncio.Semaphore:
    global _AD_LIBRARY_SEMAPHORE
    if _AD_LIBRARY_SEMAPHORE is None:
        _AD_LIBRARY_SEMAPHORE = asyncio.Semaphore(1)
    return _AD_LIBRARY_SEMAPHORE


async def collect_ad_library(
    niche: NicheQuery,
    client: httpx.AsyncClient,
) -> list[EvidenceItem]:
    """Check Meta Ad Library for ads targeting the niche's keywords in India.

    The public Ad Library page is JS-rendered, so we can't scrape ad details
    without a headless browser. Instead, we use the official Graph API if a
    META_ACCESS_TOKEN is set; otherwise we return empty (fail-closed).
    """
    token = os.environ.get("META_ACCESS_TOKEN", "")
    if not token:
        # No token — fail-closed. The Ad Library API requires identity
        # verification which is a multi-day process. Skip gracefully.
        return []

    query = niche.keywords[0] if niche.keywords else niche.name
    async with _get_ad_library_semaphore():
        await asyncio.sleep(_AD_LIBRARY_DELAY)
        try:
            r = await client.get(
                "https://graph.facebook.com/v19.0/ads_archive",
                params={
                    "access_token": token,
                    "search_terms": query,
                    "ad_reached_countries": '["IN"]',
                    "ad_active_status": "ACTIVE",
                    "fields": '["id","ad_snapshot_url","start_date"]',
                    "limit": 5,
                },
            )
        except httpx.HTTPError as exc:
            LOGGER.debug("ad-library fetch failed niche=%s error=%s", niche.slug, exc)
            return []
    if r.status_code != 200:
        LOGGER.debug("ad-library fetch failed niche=%s status=%s", niche.slug, r.status_code)
        return []
    data = r.json()
    ads = data.get("data", [])
    out: list[EvidenceItem] = []
    for ad in ads[:3]:
        url = ad.get("ad_snapshot_url", "")
        start = ad.get("start_date", "")
        out.append(
            EvidenceItem(
                sourceClass="ad-library",
                url=url,
                source="meta:ad-library",
                snippet=f"Active ad since {start} for '{query}' in India",
                observedAt=datetime.now(timezone.utc).isoformat(),
            )
        )
    LOGGER.info("ad-library niche=%s → %d ads", niche.slug, len(out))
    return out


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
    amazon = await collect_amazon(niche, client)
    ads = await collect_ad_library(niche, client)
    launch = _assign_launch_evidence(niche, ph_items)
    evidence = reddit + hn + amazon + ads + launch

    demand = _demand_score(evidence)
    diversity = _source_diversity(evidence)
    # competition / pricing / ad-saturation are computed from marketplace +
    # ad-library evidence when available; otherwise null.
    competition = _competition_score(evidence)
    pricing = _pricing_score(evidence)
    ad_saturation = _ad_saturation_score(evidence)
    return NicheEvidence(
        nicheSlug=niche.slug,
        demandScore=demand,
        competitionScore=competition,
        pricingScore=pricing,
        adSaturationScore=ad_saturation,
        agentVisibilityScore=None,
        evidence=evidence,
        freshnessDate=datetime.now(timezone.utc).isoformat(),
        notes=(
            f"diversity={diversity:.2f}; "
            f"community={len(reddit)} search={len(hn)} "
            f"product={len(amazon)} ad-library={len(ads)} launch={len(launch)}"
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
