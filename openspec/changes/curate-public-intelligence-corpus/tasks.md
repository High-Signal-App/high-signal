## 1. Operational Setup

- [x] 1.1 Create one GitHub issue for the approved corpus-curation change and use it as the implementation work queue.
- [x] 1.2 Capture the current sitemap membership and company-corpus counts as the pre-change comparison fixture.

## 2. Eligibility Policy

- [x] 2.1 Add route-family fixtures covering qualified and withheld companies, signals, entities, archives, taxonomies, and directory pages.
- [x] 2.2 Implement the pure versioned eligibility contract with explicit tier and reason codes.
- [x] 2.3 Test deterministic verdicts, company threshold boundaries, and the prohibition on affiliation-only similarity qualifying a profile.

## 3. Company Provenance

- [x] 3.1 Update the web-artifact generator to retain compact official provenance for every company without duplicating long descriptions.
- [x] 3.2 Regenerate the web artifact and verify its evidence counts, content counts, and bounded file size.
- [x] 3.3 Update company profiles to render retained official provenance and remove the unavailable-evidence fallback for qualified records.

## 4. Search-Useful Templates

- [x] 4.1 Update company-profile metadata, headings, structured data, and internal links to answer company, product, provenance, and similar-company intent.
- [x] 4.2 Apply eligibility-aware metadata to signal, entity, entity-period, dated-brief, signal-type, and company routes.
- [x] 4.3 Mark numbered directory pagination `noindex,follow` while preserving crawlable company links.

## 5. Shared Discovery Corpus

- [x] 5.1 Make the canonical sitemap consume the shared verdict and exclude withheld pages and numbered directory pagination.
- [x] 5.2 Make agent-readable route generation consume rendered eligibility and expose the eligible sitemap as the sole external IndexNow contract.
- [x] 5.3 Add parity tests proving HTML metadata, sitemap, agent inventory, and submission selection agree for each fixture.

## 6. Receipts and Regression Gates

- [x] 6.1 Generate a corpus receipt with policy revision, per-family and per-reason totals, and added or removed canonical URLs.
- [x] 6.2 Fail closed when a route family unexpectedly empties or exceeds its configured eligibility-change boundary.
- [x] 6.3 Review representative eligible and withheld pages from every route family and accept the first baseline receipt.

## 7. Verification and Handoff

- [x] 7.1 Run the smallest focused tests after each task group, then run the web typecheck and production build.
- [x] 7.2 Validate the OpenSpec change strictly and retire the superseded one-page High Signal content manifest in favor of the approved corpus policy.
- [x] 7.3 Commit and push the reviewed implementation with `Closes #65`; do not deploy.
