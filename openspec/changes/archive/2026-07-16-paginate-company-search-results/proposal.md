## Why

Company search currently returns one unpaginated result slice and gives no immediate feedback while a server-rendered query is loading. Operators need a fast, legible ranked search that clearly progresses and never floods the page with the full company universe.

## What Changes

- Return exactly 20 ranked matches per search page.
- Preserve the query and stable match ranking across previous, next, and numbered pagination links.
- Show an accessible pending state immediately for both new searches and result-page navigation.
- Add regression coverage for pagination boundaries, stable ranking, and invalid page inputs.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `accelerator-company-universe`: Define ranked 20-result pagination and pending feedback for company search.

## Impact

Affected surfaces are the company search scorer contract, `/case-studies/search`, the search form, result pagination controls, and focused tests. No schema migration, production dependency, or external API change is required.
