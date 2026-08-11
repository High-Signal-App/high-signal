import type { Metadata } from 'next';
import Link from 'next/link';
import {
  DATA_PARITY_REFERENCES,
  DATA_PARITY_VERIFIED_ON,
  MATERIAL_DATA_PARITY_GAPS,
  type DataParityStatus,
} from '@high-signal/shared';
import { PageShell } from '@/components/system/HighSignalUI';
import { SITE_URL } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Public-data parity methodology',
  description:
    'How High Signal verifies public-data capability coverage against referenced intelligence tools while disclosing premium and restricted gaps.',
  alternates: { canonical: `${SITE_URL}/methodology/data-parity` },
};

function statusTone(status: DataParityStatus) {
  if (status === 'covered') return 'text-emerald-300';
  if (status === 'partial') return 'text-amber-300';
  return 'text-rose-300';
}

export default function DataParityMethodologyPage() {
  return (
    <PageShell>
      <header className="border-b border-[var(--color-line)] pb-8">
        <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--color-accent)]">
          methodology · verified {DATA_PARITY_VERIFIED_ON}
        </div>
        <h1 className="mt-4 max-w-4xl text-4xl font-medium tracking-[-0.03em] sm:text-5xl">
          Public-data parity, without pretending public data is premium data.
        </h1>
        <p className="mt-5 max-w-[72ch] text-sm leading-6 text-[var(--color-muted)]">
          This ledger compares data capabilities, not source count, language coverage, latency,
          proprietary models, or licensed archives. A covered capability must map to a live High
          Signal source or an implemented product workflow. Partial and unavailable rows stay
          visible until the underlying access genuinely changes.
        </p>
        <div className="mt-5 flex flex-wrap gap-4 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-muted)]">
          <Link href="/methodology" className="hover:text-[var(--color-accent)]">
            publication methodology →
          </Link>
          <Link href="/data" className="hover:text-[var(--color-accent)]">
            live source directory →
          </Link>
        </div>
      </header>

      <section className="border-b border-[var(--color-line)] py-9" aria-labelledby="known-gaps">
        <h2 id="known-gaps" className="text-2xl font-medium tracking-[-0.02em]">
          Material gaps we do not rename as parity
        </h2>
        <ul className="mt-5 grid gap-x-8 gap-y-3 border-y border-[var(--color-line)] py-5 text-sm text-[var(--color-muted)] sm:grid-cols-2">
          {MATERIAL_DATA_PARITY_GAPS.map((gap) => (
            <li
              key={gap}
              className="border-t border-[var(--color-line)] pt-3 first:border-t-0 sm:first:border-t"
            >
              {gap}
            </li>
          ))}
        </ul>
      </section>

      <section className="py-9" aria-labelledby="reference-ledger">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-accent)]">
              {DATA_PARITY_REFERENCES.length} attributable references
            </div>
            <h2 id="reference-ledger" className="mt-2 text-3xl font-medium tracking-[-0.025em]">
              Capability ledger
            </h2>
          </div>
          <p className="max-w-[46ch] text-xs leading-5 text-[var(--color-muted)]">
            Covered source mappings are regression-tested against the generated source catalog.
          </p>
        </div>

        <div className="mt-6 border-t border-[var(--color-line)]">
          {DATA_PARITY_REFERENCES.map((reference) => (
            <article
              key={reference.id}
              className="grid gap-5 border-b border-[var(--color-line)] py-7 lg:grid-cols-[190px_minmax(0,1fr)]"
            >
              <div>
                <h3 className="text-lg font-medium">{reference.name}</h3>
                <a
                  href={reference.officialUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-block font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-muted)] hover:text-[var(--color-accent)]"
                >
                  official reference ↗
                </a>
              </div>
              <div className="divide-y divide-[var(--color-line)] border-y border-[var(--color-line)]">
                {reference.capabilities.map((capability) => (
                  <div
                    key={capability.id}
                    className="grid gap-3 py-4 md:grid-cols-[140px_minmax(0,1fr)]"
                  >
                    <div
                      className={`font-mono text-[10px] uppercase tracking-[0.14em] ${statusTone(capability.status)}`}
                    >
                      {capability.status}
                    </div>
                    <div>
                      <div className="text-sm font-medium text-[var(--color-fg)]">
                        {capability.label}
                      </div>
                      <p className="mt-2 max-w-[72ch] text-sm leading-6 text-[var(--color-muted)]">
                        {capability.limitation}
                      </p>
                      {capability.highSignalSourceIds.length > 0 ? (
                        <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--color-muted)]">
                          sources · {capability.highSignalSourceIds.join(' · ')}
                        </p>
                      ) : capability.productCapability ? (
                        <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--color-muted)]">
                          product capability · {capability.productCapability}
                        </p>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>
    </PageShell>
  );
}
