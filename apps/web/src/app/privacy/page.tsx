import type { Metadata } from 'next';
import Link from 'next/link';

import { SITE_URL } from '@/lib/site';
export const metadata: Metadata = {
  // Self-canonical: the root layout deliberately sets none (a site-wide
  // canonical de-indexes the corpus), so a route without this ships none.
  alternates: { canonical: `${SITE_URL}/privacy` },
  title: 'Privacy',
  description: 'What High Signal stores about public readers and its bounded operator session.',
};

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16 text-zinc-300">
      <Link
        href="/"
        className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500 hover:text-zinc-300"
      >
        ← high signal
      </Link>
      <h1 className="mt-3 text-3xl font-medium tracking-tight text-white">Privacy</h1>
      <p className="mt-4 text-xs text-zinc-500">Last updated: 2026-05-15.</p>

      <h2 className="mt-8 text-base font-semibold text-white">Public surfaces</h2>
      <p className="mt-2 text-sm leading-7">
        The Daily Brief, signals, sources, Company Universe, Track Record, and signal feeds are
        public and require no account. We do not maintain reader profiles or watchlists.
      </p>

      <h2 className="mt-8 text-base font-semibold text-white">Operator access</h2>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm marker:text-zinc-600">
        <li>Cloudflare Access protects the private review and publishing tools.</li>
        <li>That bounded operator session is not a reader account or personalization layer.</li>
      </ul>

      <h2 className="mt-8 text-base font-semibold text-white">What we don&apos;t do</h2>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm marker:text-zinc-600">
        <li>No remarketing pixels.</li>
        <li>No selling of subscriber data.</li>
        <li>
          No retroactive editing of signals or evidence — corrections are new signals citing prior
          ones.
        </li>
      </ul>
    </main>
  );
}
