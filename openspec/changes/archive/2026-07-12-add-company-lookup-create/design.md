## Context

`/case-studies` currently renders a generated JSON cache for crawlable SEO
pages, while the same run can be synced into D1. The API exposes
`GET /company-universe` and `GET /company-universe/:slug` from D1.

The missing product behavior is on-demand creation for a company that is not in
the generated universe.

## Design

### 1. D1 stores both batch and requested rows

Extend `company_universe_companies` with:

- `status`: `generated`, `pending_enrichment`, `enriched`, `failed`
- `domain`: optional normalized domain
- `requested_by`: optional operator/user id
- `requested_at`: epoch ms
- `last_enriched_at`: epoch ms

Batch sync writes `status='generated'`. Lookup-created rows write
`status='pending_enrichment'` first.

### 2. Lookup endpoint

`POST /company-universe/lookup`

Input:

```json
{ "name": "Acme AI", "domain": "acme.ai", "requestedBy": "optional-user" }
```

Behavior:

1. Normalize name/domain and derive slug.
2. Search existing company by slug, exact name, or domain.
3. If found, return `{ created: false, company, competitors }`.
4. If not found, insert a row with source evidence showing
   `operator-submitted`, infer category from name/domain tokens, map competitors
   from existing category/company rows, insert competitor edges, and return
   `{ created: true, company, competitors }`.

### 3. First-pass competitor mapping

The first pass is deterministic and honest:

- Prefer companies in the inferred category.
- Score shared token overlap between new company name/domain and existing
  company names/descriptions/categories.
- Fall back to high-signal cohort peers from the same broad category.
- Reasons are explicit: `same inferred category`, `name/domain token overlap`,
  `fallback cohort peer`.

This is not a full web enrichment pass yet. It is enough to create a persisted
profile and unblock the product flow, while `status=pending_enrichment`
signals that deeper evidence collection can run later.

### 4. Web entry point

Add a small form on `/case-studies`. Submitting posts to the API through a
Next.js route handler, then redirects to `/case-studies/<slug>`.

For now, static detail pages still cover the generated artifact. On-demand
companies are available through the API response; a future app-authenticated
brand page can read live D1 rows directly.

## Out Of Scope

- Remote production migration/sync.
- LLM/web crawling enrichment.
- Auth ownership/tenant gates.
- Background queues.
