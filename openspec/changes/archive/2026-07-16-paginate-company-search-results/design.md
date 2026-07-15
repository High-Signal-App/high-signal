## Context

The search route ranks the generated 12,964-company web snapshot on the server and currently renders one fixed slice. Its native GET form has no client-visible navigation state, and there is no query-aware pagination contract. The browser must not receive or rank the full snapshot.

## Goals / Non-Goals

**Goals:**

- Preserve the existing multi-field match scoring and deterministic rank order.
- Slice the global ranked set into 20-result pages on the server.
- Preserve `q` and `page` in navigable URLs.
- Give form and pagination interactions immediate accessible pending feedback.
- Avoid repeated normalization work on warm server requests.

**Non-Goals:**

- Replacing lexical/NER-assisted ranking with vector search.
- Automatically refreshing the source snapshot.
- Adding a D1 schema migration or client-side company index.

## Decisions

### Rank globally, then page

The scorer will calculate the deterministic match order for the complete server-side snapshot and only then apply the page offset and 20-row slice. Paging an alphabetical or pre-filtered source query would weaken relevance and violate the match-first expectation.

### Cache normalized search documents per artifact array

A module-level weak cache will retain normalized searchable fields for the stable artifact array. This keeps the first request deterministic and makes subsequent searches avoid re-normalizing every company without adding a dependency or persistent cache.

### Use client transitions around URL navigation

The search form and query-aware pagination will use App Router navigation inside React transitions. The original GET action and link hrefs remain present as progressive-enhancement fallbacks, while pending controls disable duplicate actions and announce loading through `aria-live`.

## Risks / Trade-offs

- **Cold searches still scan the server-side snapshot** → Keep the snapshot server-only, cache normalized documents for warm requests, and benchmark the production-shaped artifact locally.
- **Invalid or stale page numbers can exceed the result count** → Normalize invalid values and clamp requested pages to the current ranked result range.
- **Client navigation can fail** → Preserve real GET URLs so reload, open-in-new-tab, and no-JavaScript navigation continue to work.

## Migration Plan

Deploy as a web-only behavior change. Rollback is the previous search route and form; no database or data migration is involved.

## Open Questions

None.
