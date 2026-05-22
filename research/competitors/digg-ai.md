# Competitor note — Digg AI (`digg.com/ai`)

Reviewed: 2026-05-23
Status: notes for decision. Adopted items are folded into `plans/0007-highsignal-lab-substrate.md`; everything else below is undecided.

## What it is

Digg's third incarnation in 14 months:

| Date | What | Outcome |
|---|---|---|
| Mar 2025 | Kevin Rose + Alexis Ohanian buy Digg; $15–20M raised | — |
| Jan 14 2026 | Reboot #1 — Reddit-rival community, "digg/bury", AI moderation | Shut down Mar 14 2026 — killed by an AI-bot spam invasion in 2 months |
| May 11 2026 | Reboot #2 — pivot to an AI news aggregator (`digg.com/ai`) | ~2 weeks old at review time; unproven |

It is a wounded competitor, not a confident incumbent — two failures, layoffs, a "hard reset."

## How `digg.com/ai` works

- **Input:** ~1,000 curated AI voices on X/Twitter. Single source.
- **Ranking:** engagement velocity (views / likes / bookmarks / comments), weighted so fast pickup among trusted accounts beats slow broad attention.
- **Story clustering:** fragmented posts about one event consolidated into one story unit.
- **Influence graph:** "9M+ connections"; an entity-tracking view of people / companies / politicians.
- **Surfaces:** Top / Rising / "GitHub Stars"; momentum labels (fastest-climbing, "missed items").
- **Extras:** AI-generated podcasts, sentiment analysis, sparse dashboard UI.
- **Thesis:** an attention engine — "see what the right people are talking about." Measures who is loud and how fast, not what is true.

## Structural weaknesses

1. Single-source monocrop (100% X) — and X is the most bot-saturated surface, the exact thing that killed reboot #1.
2. Measures hype, not truth — engagement amplifies coordinated launches and confident-but-wrong viral takes.
3. No accountability — never predicts, so never wrong; no scorecard to trust or distrust.
4. Rich-get-richer bias — prominent-voice amplification buries non-famous substance.
5. Opaque methodology — rankings can feel arbitrary.
6. No habit moat vs. Twitter lists / newsletters / Discord.

## Steal / don't steal ledger

### Adopted → folded into plan 0007
- **Story clustering** — consolidate documents about one event into a story unit.
- **Velocity score factor** — rate of mention/link accumulation; surfaces things early.
- **Entity momentum** — per-entity change-in-attention; later `/entities` overlay.

### Rejected — structural, do not copy
- **X as the only / spine source** — single-source fragility, bot-exposed. Lab stays multi-source and primary-document-first.
- **Engagement as the primary ranking** — botted and gameable. Lab ranks on evidence + post-hoc calibration; engagement is at most a discounted input.
- **Influence-first thesis ("who is amplifying")** — reinforces power centers over substance. High Signal ranks substance and cites it.
- **Open-posting community + AI-only moderation** — this is what bots killed twice. High Signal has no engagement-ranked, bot-exposed posting surface by design.

### Decide later — open questions
- **X API as a curated *seed* source inside Lab** — high signal value (X breaks AI news hours before HN; some researcher threads never reach HN at all). Cost as of 2026: X moved to pay-per-use ($0.005/post read, no free tier for new developers, Basic/Pro closed to new signups). A targeted pull is ~$50–250/mo; comprehensive monitoring of ~1,000 accounts is ~$1–2k/mo — either way it breaks the ₹0 Phase-1 constraint. If adopted: curated accounts feed the same one-hop primary-source pipeline, and engagement numbers become a discounted score input, never the ranking. Sequence after the free milestone proves the feed is useful. Cheaper third-party X data resellers exist but carry ToS/reliability risk.
- **AI-generated audio brief** — cheap distribution add alongside RSS / Substack / Twitter; not core.
- **"Missed items" surface** — a "you should have seen this" view; depends on the velocity factor existing.
- **Public methodology page** — turn ranking transparency into a trust feature (the thing Digg cannot credibly do).

## Positioning takeaway

Digg = attention engine. High Signal = accountable analysis layer.

> "Digg tells you what's loud. High Signal tells you whether it's real, what it means downstream, and keeps a public scorecard."

Compete on the axis Digg structurally cannot: accountability (the public hit-rate ledger), primary-source defensibility, and second-order reasoning (the spillover map). Do not try to out-aggregate them on speed.

## Sources

- TechCrunch — Digg launches its Reddit rival (2026-01-14)
- ALM Corp — How the new Digg AI news aggregator works
- Método Viral — Digg uses AI to rank influence in tech news
- TechBuzz — Digg shuts down after 2 months as AI bot spam overwhelms platform
- Columbia Journalism Review — The new Digg's plan to use AI for community moderation
