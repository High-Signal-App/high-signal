## Why

High Signal already computes AI visibility, citation gaps, competitor share of voice, and evidence tasks, but those capabilities are buried behind a configured brand workflow. A free, source-linked Evidence Report turns the existing engine into a useful public proof artifact that can be dogfooded across the fleet and shared as marketing without introducing a paid tier.

## What Changes

- Add a public company/domain intake that resolves an existing company or creates a bounded report request without requiring sign-in.
- Compose a cached Evidence Report showing how AI systems describe the company, which competitors they recommend, which sources support those answers, and what evidence is missing.
- Make every report claim traceable to captured answer evidence and cited URLs; incomplete runs render explicit unavailable states instead of inferred claims.
- Provide a stable, shareable report URL and a clear next step into High Signal's existing brand connection and monitoring workflow.
- Dogfood the report on High Signal, CodeVetter, Pace, and SaaS Maker before broad public promotion, with an explicit quality gate based on reviewed internal reports.
- Keep the product free, rate-limited, and bounded to cached/reused work; billing, paid tiers, and unbounded anonymous provider spend remain out of scope.

## Capabilities

### New Capabilities

- `public-ai-evidence-report`: Public report intake, evidence-backed report composition, stable sharing, quality states, cost controls, and dogfood readiness.

### Modified Capabilities

- `company-lookup-create`: Permit the public Evidence Report intake to resolve or create a bounded company record while preserving provenance and enrichment state.

## Impact

- Web: a public intake and report route in `apps/web`, linked from relevant company and Mentions surfaces.
- API: bounded report request/read endpoints in `workers/api`, reusing the existing Mentions report composer and company-universe lookup.
- Data: D1 persistence for report snapshots, request status, source evidence, expiry, and share identity; a migration will be required during implementation.
- Operations: anonymous rate limits, cache/reuse policy, run budget, observability, and an internal dogfood review checklist.
- No new paid tier, billing system, provider integration, or deployment is part of this proposal.
