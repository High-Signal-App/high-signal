import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "API & feeds — High Signal",
  description:
    "Public endpoints — RSS feeds, signal redirects, sitemap. Build dashboards on top, subscribe via your reader.",
};

interface Endpoint {
  path: string;
  format: string;
  description: string;
}

const ENDPOINTS: Endpoint[] = [
  {
    path: "/signals/rss",
    format: "RSS 2.0",
    description: "Every published signal as an ongoing feed.",
  },
  {
    path: "/digest/rss",
    format: "RSS 2.0",
    description: "Last 7 days of signals — designed for inbox readers.",
  },
  {
    path: "/signals/random",
    format: "302 redirect",
    description: "Bounces to a random published signal — share-link friendly.",
  },
  {
    path: "/sitemap.xml",
    format: "XML",
    description: "All public pages + each published signal.",
  },
  {
    path: "/robots.txt",
    format: "text",
    description: "Crawler rules — public surfaces only, /dashboard and /api/ disallowed.",
  },
];

export default function ApiDocsPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16 text-zinc-300">
      <Link
        href="/"
        className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500 hover:text-zinc-300"
      >
        ← high signal
      </Link>
      <h1 className="mt-3 text-3xl font-medium tracking-tight text-white">
        API & feeds
      </h1>
      <p className="mt-3 text-sm text-zinc-400">
        High Signal is built to be consumable, not just visited. Subscribe
        via RSS, embed snippets in your own dashboard, or bounce visitors
        through the public redirects.
      </p>

      <table className="mt-10 w-full text-sm">
        <thead className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
          <tr>
            <th className="border-b border-zinc-800 py-2 text-left">Path</th>
            <th className="border-b border-zinc-800 py-2 text-left">Format</th>
            <th className="border-b border-zinc-800 py-2 text-left">Description</th>
          </tr>
        </thead>
        <tbody>
          {ENDPOINTS.map((e) => (
            <tr key={e.path}>
              <td className="border-b border-zinc-900 py-2 pr-3 font-mono text-xs text-[var(--color-accent)]">
                <Link href={e.path} className="hover:underline">
                  {e.path}
                </Link>
              </td>
              <td className="border-b border-zinc-900 py-2 pr-3 font-mono text-xs text-zinc-500">
                {e.format}
              </td>
              <td className="border-b border-zinc-900 py-2 text-zinc-300">{e.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
