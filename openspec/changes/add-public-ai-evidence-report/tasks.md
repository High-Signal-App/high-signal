## 1. Contracts and Persistence

- [ ] 1.1 Define shared request, lifecycle, snapshot, evidence-reference, and report-version contracts with fixture coverage
- [ ] 1.2 Add a reversible D1 migration for report requests and immutable snapshots, including company, status, freshness, and public-id indexes
- [ ] 1.3 Extend company lookup provenance for bounded public report requests and test duplicate, invalid, and rate-limited creation paths

## 2. Bounded Report Orchestration

- [ ] 2.1 Implement canonical input normalization and company resolution before cache or provider admission
- [ ] 2.2 Implement compatible-snapshot reuse plus per-identity, per-company, concurrency, and daily-budget admission checks
- [ ] 2.3 Add queued/running/ready/partial/failed orchestration around the existing Mentions provider and judge pipeline
- [ ] 2.4 Persist immutable snapshots with per-claim captured-answer, cited-URL, competitor, and evidence-task references
- [ ] 2.5 Add request/read endpoints that fail closed on missing evidence and do not expose credentials or internal limits

## 3. Public Experience

- [ ] 3.1 Build a signed-out company/domain intake with resolved-identity confirmation and safe lifecycle states
- [ ] 3.2 Build the stable snapshot page with description, competitors, citations, evidence gaps, coverage, generated time, and newer-report link
- [ ] 3.3 Add report entry points from relevant company/Mentions surfaces and route the call to action into existing brand monitoring
- [ ] 3.4 Add metadata, canonical sharing behavior, and analytics for intake, cache hit, ready, partial, failure, share, and connect actions

## 4. Evidence and Abuse Verification

- [ ] 4.1 Add unit tests for claim provenance, insufficient-evidence rendering, snapshot immutability, and lifecycle transitions
- [ ] 4.2 Add integration tests for anonymous admission, cache reuse, duplicate company resolution, quotas, and partial provider failure
- [ ] 4.3 Add browser coverage for signed-out intake, queued/ready/partial report reads, sharing, and monitoring handoff
- [ ] 4.4 Run security review for input normalization, public identifiers, URL rendering, identity hashing, and provider-budget bypasses

## 5. Dogfood and Promotion Gate

- [ ] 5.1 Generate internal reports for High Signal, CodeVetter, Pace, and SaaS Maker without enabling broad public promotion
- [ ] 5.2 Review each artifact for attribution, citation traceability, competitor accuracy, missing-evidence honesty, and usefulness; record failures
- [ ] 5.3 Fix systemic report defects and repeat the failed cohort checks
- [ ] 5.4 Record the operator's promotion decision and approved example set after the quality gate passes
- [ ] 5.5 Update `PROJECT_STATUS.md` and operator documentation with shipped scope, limits, quality evidence, and any deferred provider/deploy work
