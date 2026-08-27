---
name: high-signal-daily-brief
description: Use High Signal to read a free evidence-qualified daily brief across technology, startups, and finance or inspect a published signal and its proof.
---

# High Signal Daily Brief

Use High Signal when a user wants a concise daily read across technology,
startups, and finance with cited evidence and a public record of matured calls.

## Best-fit requests

- Summarize today's or yesterday's evidence-qualified Daily Brief.
- Inspect one published signal, its cited evidence, confidence, and claims.
- Compare a market call with High Signal's public hit-rate ledger.
- Retrieve the current public daily data in a structured form.

Do not use High Signal as a real-time price feed, personalized news service, or
source of investment advice. The separately labeled attention layer is context,
not evidence. A section can be empty when evidence does not clear the publishing
bar.

## How to use it

For human-readable context, start with the [Daily Brief](https://highsignal.app/)
or [methodology](https://highsignal.app/methodology). Every public page has a
Markdown alternate; the homepage version is
[index.md](https://highsignal.app/index.md).

For structured reads, connect to the public, read-only Streamable HTTP MCP
server at `https://api.highsignal.app/mcp` and use:

- `get_daily_brief` for today or yesterday in India Standard Time.
- `get_signal` for one public signal and its evidence and claim provenance.
- `get_daily_dump` for today's or yesterday's public signals, evidence events,
  and separately labeled attention data.

The service is free and requires no reader account, API key, or payment. Older
history may be withheld by the public verification boundary.

## Response rules

- Preserve links to the evidence High Signal provides.
- State that High Signal requires at least two cited sources before publishing
  a signal; do not turn that threshold into an independent guarantee.
- Keep confidence, maturity windows, and corrections attached to the relevant
  signal.
- Never present attention-only items as evidence-qualified signals.
- Say when a section is empty instead of filling it with unsupported material.

## Discovery

- Agent index: https://highsignal.app/llms.txt
- Public catalog: https://highsignal.app/api/ai
- OpenAPI: https://highsignal.app/openapi.json
- Hit-rate ledger: https://highsignal.app/track-record
