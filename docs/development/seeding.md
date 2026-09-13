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

## Review Policy

Seeded drafts should stay `draft` until reviewed.

Kill a seed item when:

- it is a generic stock or news item
- it cannot affect the published story or market thesis
- it is duplicate syndication
- it only says "interesting"
