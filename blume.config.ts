// blume.config.ts — Blume presentation layer for the High Signal knowledge base.
//
// Blume is ONLY the presentation + search layer. The committed Markdown under
// `docs/` remains the source of truth (see docs/index.md). This file makes the
// existing docs render as a static site without changing any content.
//
// Commands (wired into package.json):
//   pnpm docs:blume:dev    # local dev server
//   pnpm docs:blume:build  # static build into dist/ (git-ignored)
//   pnpm docs:blume:preview
//   pnpm docs:blume:check  # astro type-check
//   pnpm docs:blume:validate  # internal/anchor/asset/external link validation
//
// Blume is an optional devDependency. If `blume` is not installed, the
// docs:blume:* scripts no-op gracefully and `pnpm docs:check` (Node, no deps)
// remains the CI-enforced validator.
import { defineConfig } from 'blume';

export default defineConfig({
  title: 'High Signal',
  description:
    'Canonical documentation for the High Signal repository — product, architecture, operations, and durable learnings.',

  content: {
    // The knowledge base lives in docs/. Blume scans this folder for .md/.mdx.
    root: 'docs',
    // Exclude the one-time archive snapshots from navigation/search.
    exclude: ['**/archive/**', '**/_*'],
  },

  // Dark, monochrome, single-accent — matches the product's locked UI direction
  // (docs/product/direction.md). Cyan accent only.
  theme: {
    accent: 'cyan',
    radius: 'sm',
    mode: 'dark',
  },

  search: {
    // Local search, no hosted index. Works in dev and production.
    provider: 'orama',
  },

  markdown: {
    imageZoom: true,
    code: { icons: true, wrap: false },
  },

  ai: {
    // Expose llms.txt / llms-full.txt so coding agents can read the docs.
    llmsTxt: true,
  },

  seo: {
    og: { enabled: true },
    sitemap: true,
    robots: true,
    structuredData: true,
  },

  deployment: {
    output: 'static',
    // Set when a docs domain is chosen. Blume auto-detects on Vercel/Netlify/
    // Cloudflare Pages; set explicitly for GitHub Pages / S3 / custom CDN.
    // site: "https://docs.highsignal.app",
  },
});
