## 1. Shared Contract And Seed Data

- [x] 1.1 Add the Opportunity Brief types to the shared Daily Brief contract.
- [x] 1.2 Enrich seeded fallback ideas with decision-grade opportunity payloads.
- [x] 1.3 Ensure fallback ideas return the enriched payload without breaking existing fields.

## 2. API Composition

- [x] 2.1 Enrich real digest-derived brief ideas with conservative Opportunity Brief defaults.
- [x] 2.2 Preserve precomputed and seed fallback behavior for `/brief/daily`.

## 3. Web Rendering

- [x] 3.1 Render Opportunity Brief fields compactly inside section 02 idea cards.
- [x] 3.2 Preserve legacy idea rendering when the optional payload is absent.

## 4. Verification And Status

- [x] 4.1 Add or update focused tests for fallback opportunity payloads and API shape.
- [x] 4.2 Run the smallest relevant checks.
- [x] 4.3 Update `PROJECT_STATUS.md` with the shipped feature and timeline entry.
