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

To add a small, explicitly selected set of curated entity rows without
rewriting the rest of the production roster, use the additive mode:

```bash
pnpm tsx scripts/seed-d1.ts --remote --add-entities=CRWD,ZS
```

The additive mode accepts at most 25 unique IDs present in the CSV roster. It
uses one atomic `INSERT ... ON CONFLICT` statement: an identical existing row is
left unchanged, a new row is added, and a same-ID row with different identity
data causes the statement to fail without partially applying other requested
rows. It does not seed relationships. The ordinary `db:seed:remote` command
continues to seed the full entity and relationship roster.

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
