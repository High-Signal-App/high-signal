import type { MetadataRoute } from "next";

import { SITE_URL } from "@/lib/site";

/**
 * Crawler policy.
 *
 * Allow: every operator-facing or reader-facing surface, including the
 * public hit-rate ledger at /track-record (the moat — being indexed is
 * the entire point). Disallow only review/admin/api machinery and auth
 * pages with no shareable content.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: [
          "/",
          "/brief",
          "/signals",
          "/signals/today",
          "/digest",
          "/digest/rss",
          "/digest/atom",
          "/markets",
          "/markets/history",
          "/communities",
          "/mentions",
          "/agent-eval",
          "/lab",
          "/entities",
          "/sectors",
          "/opportunities",
          "/ideas",
          "/track-record",
          "/personal",
          "/teardowns",
          "/featured",
          "/dashboard",
          "/about",
          "/privacy",
          "/terms",
          "/api-docs",
          "/embed",
          "/llms.txt",
        ],
        disallow: ["/review", "/api/", "/sign-in", "/sign-up", "/backtest-workbench"],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
