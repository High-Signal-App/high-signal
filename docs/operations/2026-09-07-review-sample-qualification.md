# Review sample qualification — 2026-09-07

## Reproduced defect

The public signal at https://highsignal.app/signals/openai-openai-s-chatgpt-sees-surge-in-positive-reviews rendered six individual app-review excerpts as a satisfaction surge/developer adoption spike. It simultaneously displayed LOW confidence, CONFIDENCE SCORE 99, Strong evidence, and two independent source classes. The citations provide no verified comparison window, sample denominator or adoption measurement. Two review platforms cannot establish that trend.

The prior checked source corrected only the numeric score label. This bounded regression repair continues [issue #133](https://github.com/High-Signal-App/high-signal/issues/133); it does not modify the append-only signal store or production records.

## Source contract

- A shared web helper recognizes explicit Play Store/App Store review identities from all cited URLs. It deduplicates review IDs within an app/platform and counts platforms separately. Unknown, malformed, lookalike-host, non-review and mixed-source inputs are not silently classified as review-only.
- Review-only records lead with a factual sample headline, distinct record count and platforms. They explicitly state that adoption/satisfaction change and a surge are not established. No arbitrary sample threshold or replacement confidence score is invented.
- Original generated event/impact/narrative text remains inspectable in a closed disclosure labelled as an unverified trend hypothesis. Original excerpts, URLs and stored claim annotations remain intact. Stored score and confidence are separate diagnostic fields, without prominent pass-gate/strong-evidence badges.
- Review samples do not display generated direction, prediction window, price interpretation or inferred spillover as supported outcomes. Detail, list cards, embeds, metadata, taxonomy/archive titles and RSS/Atom summaries use the shared presentation. The web corpus policy gives review-only signals a stable ineligibility reason, noindex/follow and no Article JSON-LD; source links stay accessible.
- No storage, schema, API publication evaluator, generator or publisher changes. Mixed-source semantic validation, calibrated confidence, API/MCP/Daily Brief consistency and corpus correction remain open. This is not portfolio shareability qualification.

## Verification

The existing plain-node suites cover high stored score/confidence with review-only evidence, duplicate review URLs with language parameters, two reviews on one platform, lookalike hosts, missing IDs, mixed sources, immutable inputs and unchanged non-review corpus eligibility. They are included in the normal root runner; all 30 suites pass. Web typecheck and the production Next build pass.

A read-only copy of the actual public signal and claim response was served by an isolated localhost fixture API. The actual Next app rendered it at desktop 1440×1000 and mobile 390×844. Browser assertions verified six original excerpt blocks, factual lead, no strong-evidence/surge promotion, hidden diagnostics that expose 99/low when opened, original generated narrative when opened, qualified list/embed/RSS/Atom, noindex, omitted NewsArticle, and no document overflow. External browser requests were blocked for the completed local check. No generation, publishing, migration, model or paid provider request ran.

[Desktop render](evidence/review-sample-2026-09-07/local-1440.png) · [Mobile render](evidence/review-sample-2026-09-07/local-390.png) · [Assertions](evidence/review-sample-2026-09-07/local-render.json).

The two temporary local services and isolated browsers were stopped. The existing `sweep-abandoned-20260906` stash remains untouched. Public fixture files are temporary and not committed; no original stored content was edited.

## Reviewed release required

No deployment was performed. This requires only a web Worker release after exact-head checks and review; no API deployment, D1 migration, seed or publication rerun is needed. Rebuild through the existing web OpenNext path and tag the exact source at release time; do not deploy a fixture-configured development build.

Read-only provider preflight found current `high-signal-web` version 403 `608508e0-0f44-46fa-8e80-e26eb2c679d5`, tag `50beb67b62cb3fc21044fd8da6abbdb5bdf33ffc`, at 100% traffic in deployment `76e0bcfc-a20e-4478-a2b3-89dcb81eeb28`. Recheck immediately before any approved release. The rollback command is `pnpm --filter @high-signal/web exec wrangler rollback 608508e0-0f44-46fa-8e80-e26eb2c679d5 --name high-signal-web --message 'Revert review sample presentation regression' --yes`.

Hosted acceptance must repeat the exact public record, list/embed/feed and mobile checks, retain all original sources, and confirm the numeric score cannot override the evidence limitation. Broader claim calibration and publication consistency remain #133 gates even if this web candidate passes.
