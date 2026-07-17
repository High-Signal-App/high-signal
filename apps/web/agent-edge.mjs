/**
 * Portable agent-edge handler — copy or generate into each product.
 * Spec: fleet-ops/docs/agent-indexing-standard.md
 *
 * Usage in worker.mjs (before openNext.fetch):
 *   import { handleAgentEdge } from './agent-edge.mjs'
 *   const agent = handleAgentEdge(request)
 *   if (agent) return agent
 */

/** @type {{ name: string, url: string, llmsTxt: string, indexMd: string, catalog: object, llmsFull?: string | null }} */
export const AGENT_SURFACE = {
  "name": "High Signal",
  "url": "https://highsignal.app",
  "llmsTxt": "# High Signal\n\n> Daily synthesized brief on technology, startups, and finance — five sections with inline hit-rates, no signup required.\n\n## Product\n\n- [Daily brief](https://highsignal.app/): Primary composed brief\n- [Track record](https://highsignal.app/track-record): Public hit-rate ledger\n- [Markets](https://highsignal.app/markets): Market signals\n\n## Machine surfaces\n\n- [Agent catalog](https://highsignal.app/api/ai): JSON inventory of public surfaces\n- [Homepage markdown](https://highsignal.app/index.md): Product brief without JS\n- [This index](https://highsignal.app/llms.txt)\n\n## Optional\n\n- [Foundry](https://sassmaker.com): Parent fleet showcase\n",
  "indexMd": "# High Signal\n\nDaily synthesized intelligence brief on technology, startups, and finance.\n\n## What it is\n\n- Five-section composed brief at `/` and `/brief`\n- Inline hit-rates on market calls\n- Public track record and methodology pages\n- Free, no signup for the brief\n\n## Who it's for\n\nOperators and investors who want a high-signal daily read instead of raw feed noise.\n\n## Agent entrypoints\n\n- https://highsignal.app/llms.txt\n- https://highsignal.app/api/ai\n- https://highsignal.app/index.md\n- RSS: https://highsignal.app/signals/rss\n",
  "catalog": {
    "name": "High Signal",
    "version": "1",
    "url": "https://highsignal.app",
    "llms": "https://highsignal.app/llms.txt",
    "llmsFull": null,
    "sitemap": "https://highsignal.app/sitemap.xml",
    "markdown": {
      "suffix": ".md",
      "negotiation": true
    },
    "surfaces": [
      {
        "id": "home",
        "url": "https://highsignal.app/",
        "md": "https://highsignal.app/index.md",
        "kind": "static",
        "description": "Product home"
      },
      {
        "id": "daily-brief",
        "url": "https://highsignal.app/",
        "md": null,
        "kind": "static",
        "description": "Primary composed brief"
      },
      {
        "id": "track-record",
        "url": "https://highsignal.app/track-record",
        "md": null,
        "kind": "static",
        "description": "Public hit-rate ledger"
      },
      {
        "id": "markets",
        "url": "https://highsignal.app/markets",
        "md": null,
        "kind": "static",
        "description": "Market signals"
      }
    ],
    "auth": {
      "public": true,
      "notes": "Auth-walled app routes are not agent-indexed unless listed here."
    }
  },
  "llmsFull": null
};

/**
 * @param {Request} request
 * @returns {Response | null}
 */
export function handleAgentEdge(request) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return null;
  const url = new URL(request.url);
  const path = url.pathname === '' ? '/' : url.pathname;

  if (path === '/llms.txt') {
    return text(AGENT_SURFACE.llmsTxt, 'text/plain; charset=utf-8');
  }
  if (path === '/llms-full.txt' && AGENT_SURFACE.llmsFull) {
    return text(AGENT_SURFACE.llmsFull, 'text/plain; charset=utf-8');
  }
  if (path === '/index.md') {
    return text(AGENT_SURFACE.indexMd, 'text/markdown; charset=utf-8');
  }
  if (path === '/api/ai') {
    // Re-bind origin so preview/custom domains stay correct
    const catalog = {
      ...AGENT_SURFACE.catalog,
      url: url.origin,
      llms: `${url.origin}/llms.txt`,
      sitemap: AGENT_SURFACE.catalog.sitemap
        ? String(AGENT_SURFACE.catalog.sitemap).replace(AGENT_SURFACE.url, url.origin)
        : `${url.origin}/sitemap.xml`,
      surfaces: (AGENT_SURFACE.catalog.surfaces || []).map((s) => ({
        ...s,
        url: s.url ? String(s.url).replace(AGENT_SURFACE.url, url.origin) : s.url,
        md: s.md ? String(s.md).replace(AGENT_SURFACE.url, url.origin) : s.md,
      })),
    };
    return json(catalog);
  }

  // Homepage markdown negotiation
  if ((path === '/' || path === '') && wantsMarkdown(request)) {
    return text(AGENT_SURFACE.indexMd, 'text/markdown; charset=utf-8', {
      Link: '</index.md>; rel="alternate"; type="text/markdown"',
      Vary: 'Accept',
    });
  }

  return null;
}

function wantsMarkdown(request) {
  const accept = (request.headers.get('accept') || '').toLowerCase();
  if (!accept.includes('text/markdown')) return false;
  if (!accept.includes('text/html')) return true;
  return accept.indexOf('text/markdown') < accept.indexOf('text/html');
}

function text(body, type, extra = {}) {
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': type,
      'Cache-Control': 'public, max-age=300',
      ...extra,
    },
  });
}

function json(data) {
  return new Response(`${JSON.stringify(data, null, 2)}\n`, {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
    },
  });
}
