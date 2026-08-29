import type { Metadata } from 'next';
import Link from 'next/link';

import { SITE_URL } from '@/lib/site';
export const metadata: Metadata = {
  // Self-canonical: the root layout deliberately sets none (a site-wide
  // canonical de-indexes the corpus), so a route without this ships none.
  alternates: { canonical: `${SITE_URL}/api-docs` },
  title: 'API & feeds',
  description:
    'The small public High Signal interface: MCP tools, daily data, signal feeds, and discovery.',
};

interface Endpoint {
  path: string;
  format: string;
  description: string;
}

const ENDPOINTS: Endpoint[] = [
  {
    path: 'https://api.highsignal.app/mcp',
    format: 'MCP · Streamable HTTP',
    description:
      'Three stable read-only tools: today/yesterday brief, signal proofs, and the complete daily dump.',
  },
  {
    path: '/signals/rss',
    format: 'RSS 2.0',
    description: 'Every published signal as an ongoing feed.',
  },
  {
    path: 'https://api.highsignal.app/data/daily',
    format: 'JSON',
    description:
      'Complete UTC daily dump of published signals, linked evidence events, and the separate Digg attention overlay. `withheldCount` reports rows that were published but held back by the publishability gate, so signalCount 0 is distinguishable from a withheld day. Add ?date=YYYY-MM-DD for an archive day.',
  },
  {
    path: '/signals/random',
    format: '302 redirect',
    description: 'Bounces to a random published signal — share-link friendly.',
  },
  {
    path: '/sitemap.xml',
    format: 'XML',
    description: 'All public pages + each published signal.',
  },
  {
    path: '/robots.txt',
    format: 'text',
    description: 'Crawler rules — public surfaces only, /dashboard and /api/ disallowed.',
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
      <h1 className="mt-3 text-3xl font-medium tracking-tight text-white">API & feeds</h1>
      <p className="mt-3 text-sm text-zinc-400">
        Connect an MCP client once, read the complete daily dataset as JSON, or subscribe to the
        chronological signal feed. The same published evidence powers every interface.
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
                {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
                <a href={e.path} className="hover:underline">
                  {e.path}
                </a>
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
