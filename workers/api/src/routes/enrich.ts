/**
 * Entity enrichment — query Wikidata SPARQL for ticker → company metadata.
 *
 * Used by /unmapped page's "promote to gazetteer" button: given a $TICKER,
 * return the company name + country + industry + Wikipedia URL + Wikidata Q-id
 * so the client can generate a fully-populated ai_infra_entities.csv row.
 *
 * Wikidata's SPARQL endpoint tolerates cloud-IP traffic if the User-Agent
 * follows their policy (includes contact info).
 */

import { Hono } from "hono";

type Env = Record<string, never>;

const SPARQL_ENDPOINT = "https://query.wikidata.org/sparql";
const USER_AGENT =
  "high-signal-enrich/0.1 " +
  "(+https://github.com/sarthakagrawal927/high-signal; " +
  "contact: sarthak@vaultwealth.com)";

interface Binding<T = string> {
  value: T;
}

interface SparqlBindings {
  item?: Binding;
  itemLabel?: Binding;
  countryLabel?: Binding;
  industryLabel?: Binding;
  exchangeLabel?: Binding;
  article?: Binding;
  cik?: Binding;
  isin?: Binding;
}

export interface EnrichmentResult {
  ticker: string;            // bare ticker, no `$`
  wikidataId: string | null; // Q12345
  name: string | null;
  country: string | null;
  industry: string | null;
  exchange: string | null;
  wikiUrl: string | null;
  cik: string | null;
  isin: string | null;
}

/**
 * Parse Wikidata's SPARQL JSON response → first binding.
 * Pure function so we can TDD it without network.
 */
export function parseSparql(
  ticker: string,
  body: { results?: { bindings?: SparqlBindings[] } } | null,
): EnrichmentResult {
  const fallback: EnrichmentResult = {
    ticker,
    wikidataId: null,
    name: null,
    country: null,
    industry: null,
    exchange: null,
    wikiUrl: null,
    cik: null,
    isin: null,
  };
  if (!body || !body.results || !body.results.bindings || body.results.bindings.length === 0) {
    return fallback;
  }
  const b = body.results.bindings[0];
  const itemUrl = b.item?.value ?? null;
  return {
    ...fallback,
    wikidataId: itemUrl ? itemUrl.split("/").pop() ?? null : null,
    name: b.itemLabel?.value ?? null,
    country: b.countryLabel?.value ?? null,
    industry: b.industryLabel?.value ?? null,
    exchange: b.exchangeLabel?.value ?? null,
    wikiUrl: b.article?.value ?? null,
    cik: b.cik?.value ?? null,
    isin: b.isin?.value ?? null,
  };
}

/**
 * Build the SPARQL query for a given ticker.
 *
 * Wikidata's P249 ("ticker symbol") values are often qualified — many entries
 * store the ticker as ``NASDAQ: NVDA`` or just ``NVDA`` depending on who
 * edited the record. A literal-equality match on bare ``NVDA`` misses the
 * qualified form. We use ``p:P249 / ps:P249`` (the property statement) +
 * a regex filter that matches the ticker as a standalone token within the
 * stored string. Covers both forms.
 */
export function buildSparql(ticker: string): string {
  // P249 = ticker symbol; P17 = country; P452 = industry; P414 = stock exchange;
  // P5531 = CIK; P946 = ISIN.
  //
  // Wikidata stores ticker symbols in TWO patterns and you only get one or
  // the other depending on the editor:
  //   1. Direct claim:  Subject --P249--> "NVDA"  (most cleanly editable)
  //   2. As a qualifier on the stock-exchange claim:
  //        Subject --P414--> Q83533 (NASDAQ) --P249 qualifier--> "NVDA"
  //
  // Verified live: NVIDIA (Q182477) uses pattern (2). UNION catches both.
  const escaped = ticker.replace(/"/g, '\\"');
  return `SELECT ?item ?itemLabel ?countryLabel ?industryLabel ?exchangeLabel ?article ?cik ?isin WHERE {
  {
    ?item wdt:P249 ?tk .
  } UNION {
    ?item p:P414 ?stmt .
    ?stmt pq:P249 ?tk .
  }
  FILTER(REGEX(STR(?tk), "(^|[^A-Za-z0-9])${escaped}([^A-Za-z0-9]|$)", "i"))
  OPTIONAL { ?item wdt:P17 ?country }
  OPTIONAL { ?item wdt:P452 ?industry }
  OPTIONAL { ?item wdt:P414 ?exchange }
  OPTIONAL { ?item wdt:P5531 ?cik }
  OPTIONAL { ?item wdt:P946 ?isin }
  OPTIONAL {
    ?article schema:about ?item ;
             schema:isPartOf <https://en.wikipedia.org/> .
  }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en" }
} LIMIT 1`;
}

/**
 * Generate a CSV row matching ai_infra_entities.csv columns:
 *   id, ticker, name, type, country, sector, subsector, aliases, wiki_url, ir_url
 */
export function enrichmentToCsvRow(e: EnrichmentResult): string {
  const cells = [
    e.ticker,            // id (default to ticker)
    e.ticker,            // ticker
    e.name ?? "",        // name
    "public",            // type
    e.country ?? "",     // country
    e.industry ?? "",    // sector (best-effort from industry label)
    "",                  // subsector
    "",                  // aliases
    e.wikiUrl ?? "",     // wiki_url
    "",                  // ir_url
  ];
  return cells.map((cell) => (cell.includes(",") ? `"${cell}"` : cell)).join(",");
}

export const enrichRoute = new Hono<{ Bindings: Env }>();

/**
 * Wikipedia OpenSearch — single-call best-effort fallback when SPARQL misses.
 * Returns a (name, wikiUrl) pair if anything resembles the ticker.
 */
async function wikipediaSearchFallback(
  ticker: string,
): Promise<{ name: string | null; wikiUrl: string | null }> {
  try {
    const url =
      `https://en.wikipedia.org/w/api.php?action=opensearch&format=json` +
      `&search=${encodeURIComponent(`${ticker} stock`)}&limit=1`;
    const r = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (!r.ok) return { name: null, wikiUrl: null };
    // OpenSearch returns [query, [titles], [descriptions], [urls]]
    const j = (await r.json()) as [string, string[], string[], string[]];
    const title = j[1]?.[0] ?? null;
    const wikiUrl = j[3]?.[0] ?? null;
    return { name: title, wikiUrl };
  } catch {
    return { name: null, wikiUrl: null };
  }
}

enrichRoute.get("/ticker", async (c) => {
  // Strip a leading `$` and any whitespace.
  const raw = (c.req.query("token") ?? "").trim();
  const ticker = raw.startsWith("$") ? raw.slice(1) : raw;
  if (!ticker) {
    return c.json({ error: "missing token" }, 400);
  }

  const sparql = buildSparql(ticker);
  const url = `${SPARQL_ENDPOINT}?query=${encodeURIComponent(sparql)}&format=json`;

  let body: { results?: { bindings?: SparqlBindings[] } } | null = null;
  try {
    const r = await fetch(url, {
      headers: { Accept: "application/sparql-results+json", "User-Agent": USER_AGENT },
    });
    if (r.ok) body = await r.json();
  } catch {
    // Network failures fall through to fallback result.
  }

  let result = parseSparql(ticker, body);

  // If Wikidata didn't return a name, try Wikipedia OpenSearch as a backup
  // so the user gets something useful even when SPARQL misses.
  let source: "wikidata" | "wikipedia" | "fallback" = "fallback";
  if (result.name) {
    source = "wikidata";
  } else {
    const wiki = await wikipediaSearchFallback(ticker);
    if (wiki.name) {
      result = { ...result, name: wiki.name, wikiUrl: wiki.wikiUrl };
      source = "wikipedia";
    }
  }

  console.log(
    JSON.stringify({
      route: "/enrich/ticker",
      ticker,
      source,
      hasName: result.name !== null,
    }),
  );

  return c.json({
    enrichment: result,
    csvRow: enrichmentToCsvRow(result),
    source,
  });
});
