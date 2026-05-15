import type { MetadataRoute } from "next";

const siteUrl = "https://high-signal-web.sarthakagrawal927.workers.dev";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/signals", "/digest", "/track-record"],
        disallow: ["/dashboard", "/watchlist", "/review", "/api/", "/discover", "/sectors", "/markets", "/entities", "/mentions", "/communities", "/backtest-workbench"],
      },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
