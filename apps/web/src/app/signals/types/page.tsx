import type { Metadata } from 'next';
import { BackLink, PageShell, SectionHeader } from '@/components/system/HighSignalUI';
import { BreadcrumbJsonLd } from '@/components/seo/structured-data';
import { api, type SignalRow } from '@/lib/api';
import { familyForSignalType, familyLabel, type SignalFamily } from '@high-signal/shared';
import { SITE_URL } from '@/lib/site';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Signal types — taxonomy of every call we publish',
  description:
    'Every signal type High Signal publishes, grouped by family with the all-time count. Click into a type for its definition, recent examples, and public hit-rate.',
  alternates: { canonical: `${SITE_URL}/signals/types` },
};

interface TypeRow {
  type: string;
  family: SignalFamily;
  total: number;
  lastSeenAt: string | null;
}

function dateLabel(raw: string | null): string {
  if (!raw) return '—';
  return raw.slice(0, 10);
}

export default async function SignalTypesIndexPage() {
  let signals: SignalRow[] = [];
  try {
    signals = (await api.signals({ limit: 1000 })).signals;
  } catch {
    /* offline — render empty */
  }

  const byType = new Map<string, TypeRow>();
  for (const s of signals) {
    const row = byType.get(s.signalType) ?? {
      type: s.signalType,
      family: familyForSignalType(s.signalType),
      total: 0,
      lastSeenAt: null,
    };
    row.total += 1;
    const ts = new Date(s.publishedAt).toISOString();
    if (!row.lastSeenAt || ts > row.lastSeenAt) row.lastSeenAt = ts;
    byType.set(s.signalType, row);
  }

  const types = Array.from(byType.values()).sort((a, b) => b.total - a.total);
  const byFamily = new Map<SignalFamily, TypeRow[]>();
  for (const row of types) {
    const bucket = byFamily.get(row.family) ?? [];
    bucket.push(row);
    byFamily.set(row.family, bucket);
  }
  const families = Array.from(byFamily.entries()).sort(
    (a, b) => b[1].reduce((sum, r) => sum + r.total, 0) - a[1].reduce((sum, r) => sum + r.total, 0)
  );

  return (
    <PageShell>
      <BackLink href="/signals">back to signals</BackLink>
      <BreadcrumbJsonLd
        trail={[
          { name: 'Home', path: '/' },
          { name: 'Signals', path: '/signals' },
          { name: 'Types', path: '/signals/types' },
        ]}
      />

      <SectionHeader eyebrow="taxonomy" title="Signal types">
        Every published-signal type in High Signal, grouped by family. Each type has its own page
        with definition, recent examples, and public hit-rate.
      </SectionHeader>

      <section className="mt-10 divide-y divide-[var(--color-line)] border-y border-[var(--color-line)]">
        {families.map(([family, rows]) => (
          <article key={family} className="py-8">
            <div className="flex items-baseline justify-between">
              <h2 className="text-xl font-medium tracking-tight">{familyLabel(family)}</h2>
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
                {rows.length} types · {rows.reduce((sum, r) => sum + r.total, 0)} signals
              </div>
            </div>
            <ul className="mt-4 divide-y divide-[var(--color-line)] border-t border-[var(--color-line)]">
              {rows.map((row) => (
                <li
                  key={row.type}
                  className="grid items-baseline gap-3 py-3 md:grid-cols-[1fr_120px_120px]"
                >
                  <a
                    className="text-base text-[var(--color-fg)] hover:text-[var(--color-accent)]"
                    href={`/signals/types/${row.type}`}
                  >
                    {row.type.replaceAll('_', ' ')}
                  </a>
                  <span className="font-mono text-[11px] text-[var(--color-muted)]">
                    {row.total} signals
                  </span>
                  <span className="font-mono text-[11px] text-[var(--color-muted)]">
                    last {dateLabel(row.lastSeenAt)}
                  </span>
                </li>
              ))}
            </ul>
          </article>
        ))}
        {families.length === 0 ? (
          <p className="py-8 text-sm text-[var(--color-muted)]">
            No signals indexed yet. The first ingest cycle will populate this page.
          </p>
        ) : null}
      </section>
    </PageShell>
  );
}
