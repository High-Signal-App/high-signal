## Why

High Signal already has a large publishable corpus, but the current sitemap treats every generated route as equally indexable. The company universe alone emits 12,964 profiles even though 949 have no description, 3,881 have fewer than 80 description characters, and the web artifact preserves source counts without the source-evidence records needed to substantiate the page; publishing more generic articles before curating this corpus would waste the stronger asset already present.

## What Changes

- Introduce one shared indexability policy used by metadata, sitemaps, agent-readable routes, and search-engine submissions.
- Classify dynamic pages by evidence and content completeness instead of indexing every generated route by default.
- Keep below-threshold pages reachable for product exploration while applying `noindex` and excluding them from discovery feeds until enrichment makes them eligible.
- Strengthen the company-profile, signal, entity, entity-period, brief-archive, and taxonomy templates around the search questions their underlying evidence can actually answer.
- Preserve enough first-party source evidence in the web artifact for every indexable company profile to substantiate its provenance.
- Add deterministic corpus receipts with eligible, withheld, newly eligible, and regressed counts so a refresh cannot silently flood or empty the index.
- Use High Signal's existing briefs, signals, entities, sectors, markets, communities, and company graph as the content program; do not create a parallel thin-article farm.

## Capabilities

### New Capabilities

- `public-intelligence-corpus`: Defines evidence-based index eligibility, shared discovery behavior, template search value, and measurable corpus receipts for High Signal's public dynamic pages.

### Modified Capabilities

- `accelerator-company-universe`: Requires the generated web artifact and company-detail surface to preserve sufficient source provenance and expose only qualified profiles to search discovery.

## Impact

- Affects `apps/web/src/app/sitemap.ts`, dynamic-route metadata, structured data, the public route registry, agent-readable surfaces, IndexNow inputs, and the company-universe artifact builder.
- Changes public discovery behavior but does not remove product routes or company records.
- Requires focused tests for eligibility consistency, sitemap membership, `robots` metadata, source provenance, and corpus receipts.
- Adds no production dependency and does not require a data migration; production deployment remains a separate manual action.
