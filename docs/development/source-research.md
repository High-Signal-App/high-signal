---
title: Source corroboration
description: Use retained evidence and optional public web research to verify a Daily Brief claim.
---

# Source corroboration

Start with the claim and its retained evidence. Open the original links, record the
exact assertion they support, and identify the missing evidence before searching.
Use the [source coverage map](../operations/source-coverage.md) to find the
relevant existing sources and the [editorial rules](../product/direction.md#hard-rules-baked-in)
to determine whether a claim can publish.

## Optional public search in Cursor

Parallel documents `https://mcp.parallel.ai/mcp` for new installs and offers a
limited keyless tier for `web_search` and `web_fetch`. In a local Cursor
workspace, merge this entry into the existing MCP server list and confirm that
Cursor shows both tools connected. [Parallel MCP setup](https://docs.parallel.ai/integrations/mcp/quickstart)

```json
{
  "mcpServers": {
    "parallel": {
      "url": "https://mcp.parallel.ai/mcp"
    }
  }
}
```

Use public search terms and public URLs. Keep unpublished briefs, internal
notes, operator URLs and credentials inside High Signal. Start with
`web_search` to find candidates, then use `web_fetch` or open the publisher
page to inspect the original. Record the original source URL, publisher,
publication date, access date and short supporting excerpt for each candidate.

## Research prompt

> Review the retained public sources for this claim first. Identify the exact
> assertion that still needs support. Search with short queries for an original
> filing, notice, announcement or independent report. For each useful candidate,
> return the publisher, original URL, publication date and a short excerpt that
> supports the same assertion. Identify copied or syndicated coverage and show
> which records share an origin. Flag contradictions and missing evidence.

Record useful candidates through the existing review process. Two copies of
the same press release supply one origin. Keep search snippets, neighboring
claims and conflicting sources as research context. Apply the existing
publication rules and use append-only corrections for previously published
signals.
