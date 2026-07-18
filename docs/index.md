---
title: High Signal Knowledge Base
description: Canonical documentation for the High Signal repository — product, architecture, operations, and durable learnings.
---

# High Signal Knowledge Base

This `docs/` tree is the **canonical, source-of-truth documentation** for the
High Signal repository. It is committed Markdown, versioned in git alongside
the code. [Blume](https://useblume.dev) (`docs-site/blume.config.ts`) is only
the presentation and search layer over these files — it never owns the content.

Agent-facing operating rules live one level up in [`agents.md`](https://github.com/High-Signal-App/high-signal/blob/main/agents.md).
Day-to-day status lives in [`STATUS.md`](https://github.com/High-Signal-App/high-signal/blob/main/STATUS.md) (short view) and
[`PROJECT_STATUS.md`](https://github.com/High-Signal-App/high-signal/blob/main/PROJECT_STATUS.md) (detailed ledger). The full
product spec is [`SPEC.md`](https://github.com/High-Signal-App/high-signal/blob/main/SPEC.md).

**New to the system?** Start with
[`architecture/how-it-works.md`](architecture/how-it-works.md) — a learning-tier
walkthrough that traces one signal from a noisy public source to a published
brief and explains the major components, boundaries, and key decisions.

## How this tree is organized

| Section | What it holds | Start here |
| --- | --- | --- |
| `product/` | Product direction, scope, feature audit, commercial handoff | [`product/direction.md`](product/direction.md) |
| `architecture/` | How it works end-to-end, system structure, data boundaries, architecture decisions (ADRs) | [`architecture/how-it-works.md`](architecture/how-it-works.md) |
| `development/` | Setup, seeding, local workflows | [`development/seeding.md`](development/seeding.md) |
| `operations/` | Source catalog/coverage, data audits, cron jobs, runbooks | [`operations/source-catalog.md`](operations/source-catalog.md) |
| `knowledge/` | Durable learnings, failed approaches, external references, retros | [`knowledge/learnings/lessons.md`](knowledge/learnings/lessons.md) |
| `archive/` | One-time snapshots kept for history (not maintained) | [`archive/`](https://github.com/High-Signal-App/high-signal/tree/main/docs/archive) |

## Top-level entry points (repo root)

- [`agents.md`](https://github.com/High-Signal-App/high-signal/blob/main/agents.md) — concise agent bootloader: purpose, commands, constraints, doc navigation.
- [`STATUS.md`](https://github.com/High-Signal-App/high-signal/blob/main/STATUS.md) — current objective, active work, blockers, next steps (short).
- [`PROJECT_STATUS.md`](https://github.com/High-Signal-App/high-signal/blob/main/PROJECT_STATUS.md) — detailed, dated status ledger (authoritative for "what shipped").
- [`SPEC.md`](https://github.com/High-Signal-App/high-signal/blob/main/SPEC.md) — full product spec and working thesis.
- [`README.md`](https://github.com/High-Signal-App/high-signal/blob/main/README.md) — setup, architecture overview, data-pipeline reference.
- [`plans/`](https://github.com/High-Signal-App/high-signal/tree/main/plans) — numbered active plans; prior versions in `plans/archive/`.
- [`research/`](https://github.com/High-Signal-App/high-signal/tree/main/research) — domain notes, source experiments, market research.
- [`signals/`](https://github.com/High-Signal-App/high-signal/tree/main/signals) — append-only, git-versioned signal markdown (the product's memory layer).

## Documentation maintenance rules

1. **Markdown in this tree is the source of truth.** Blume, the website, and any
   generated view are downstream presentations — never edit a fact only in a
   generated artifact.
2. **One canonical home per fact.** Do not re-explain a concept in two places.
   Link with a one-line pointer instead. When consolidating, preserve the old
   page under `archive/` rather than deleting (keeps git rename history).
3. **Code is authoritative for implementation detail and schedules.** Don't
   duplicate what's easily discoverable from code (exact cron expressions, env
   var lists, schema columns). Document *why* systems work, non-obvious
   constraints, operational procedures, decisions, and reusable failures.
4. **Mark unresolved questions explicitly** (`TBD:`, `Unresolved:`) rather than
   guessing. See `architecture/decisions.md` for the `TBD: capture rationale`
   convention.
5. **No empty folders or placeholder pages.** Every committed file must carry
   useful content.
6. **Keep pages focused** — target 150–300 lines. Split catch-all pages into
   per-topic pages rather than growing one mega-doc.
7. **When you move a doc**, use `git mv` and update cross-references in the same
   change. Run `pnpm docs:check` before committing (broken-link guard).
8. **ADRs are append-only.** A superseded decision gets a new ADR that
   references the prior one; never rewrite history. See
   [`architecture/decisions.md`](architecture/decisions.md).

## Validating and previewing docs

```bash
pnpm docs:check        # internal-link check + empty-dir sanity (no frontmatter validation)
pnpm docs:blume:dev    # local Blume dev server (presentation only)
pnpm docs:blume:build  # static build into dist/ (git-ignored)
```

`docs:check` runs in CI (`.github/workflows/docs.yml`) on every push and PR.
