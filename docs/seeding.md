# Seeding High Signal

Status: operating note
Updated: 2026-05-17

Seeding should create an evidence base for decisions, not fill the product with
random insight cards.

## What To Seed

### 1. Graph Seed

This is already committed:

- entities
- relationships
- source catalog
- signal taxonomy

Commands:

```bash
pnpm db:migrate:local
pnpm db:seed:local
```

Remote:

```bash
pnpm db:migrate:remote
pnpm db:seed:remote
```

### 2. Market Evidence Seed

Use this to build historical track-record memory for the AI-infra market
collection.

Recommended first pass:

```bash
cd python/ingest
uv run python -m high_signal_ingest.backfill \
  --start 2026-03-01 \
  --end 2026-05-17 \
  --sources gdelt,edgar \
  --chunk-days 7
```

Use `API_BASE` + `ADMIN_TOKEN` when seeding remote production. Without those,
drafts write to local `signals/YYYY-MM-DD/*.md`.

### 3. Product-Idea Flow Seed

This is the important seed for `/ideas`.

Do not seed it by dumping random Reddit posts into market signals. Seed it as
world-flow evidence:

- community pain and demand from tracked subreddits
- AI visibility and citation gaps from mention checks
- competitor launches, pricing changes, docs/changelog updates
- GitHub release/adoption activity for developer products
- market/company signals only when they affect product timing, budget, or distribution

The useful unit is:

```txt
source -> evidence item -> product implication -> suggested action
```

Not:

```txt
source -> generic interesting news
```

The reviewed seed artifact lives at `data/product-flow-seed.json` and writes to
the existing Community Intelligence tables that `/ideas` already reads through
`/products/communities/discover`.

Commands:

```bash
pnpm product-flow:seed:local
pnpm product-flow:seed:remote
```

After seeding locally, start the API/web stack and check:

```bash
curl "http://localhost:8787/products/communities/discover?period=week"
```

## Minimum Useful Seed

For idea intelligence to be credible:

- 30 days of daily source runs
- 500-2,000 raw events
- 100+ reviewed product/community evidence items
- 20-50 idea evaluations
- reviewer labels: useful, noise, validated, invalidated

## Review Policy

Seeded drafts should stay `draft` until reviewed.

Kill a seed item when:

- it is a generic stock or news item
- it cannot affect product direction
- it has no clear buyer, workflow, pain, timing, distribution, or budget implication
- it is duplicate syndication
- it only says "interesting"
