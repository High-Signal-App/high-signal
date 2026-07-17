import { BackLink, HeroHeader, PageShell } from '@/components/system/HighSignalUI';

export const metadata = {
  title: 'Domains — Web Authority Signals',
  description:
    'Leaderboard of high-signal websites by Ahrefs Domain Rating (DR). Companion lens powered by the drank app.',
};

const RAW_DATA_URL =
  'https://raw.githubusercontent.com/High-Signal-App/drank/main/data/global-dr.json';
const DRANK_APP_URL = 'https://drank-sand.vercel.app';

interface DrankData {
  lastUpdated: string;
  domains: Record<string, { history: Array<{ ts: number; dr: number }> }>;
  communityNominations?: Array<{ domain: string; note?: string }>;
}

async function getDrankData(): Promise<DrankData> {
  try {
    // Prefer locally synced copy (see scripts/sync-drank-domains.ts)
    const local = await import('../../../../../data/dr-domains.json');
    const d = local.default ?? local;
    if (d.domains && Object.keys(d.domains).length > 0) {
      return {
        lastUpdated: d.lastUpdated,
        domains: d.domains,
        communityNominations: d.communityNominations || [],
      };
    }
  } catch {}

  try {
    const res = await fetch(RAW_DATA_URL, {
      next: { revalidate: 3600 },
    });

    if (!res.ok) {
      return {
        lastUpdated: new Date().toISOString(),
        domains: {},
        communityNominations: [],
      };
    }

    const remote = await res.json();
    return {
      lastUpdated: remote.lastUpdated,
      domains: remote.domains || {},
      communityNominations: remote.communityNominations || [],
    };
  } catch {
    return {
      lastUpdated: new Date().toISOString(),
      domains: {},
      communityNominations: [],
    };
  }
}

function getCurrentDR(history: Array<{ ts: number; dr: number }> = []): number | null {
  if (!history.length) return null;
  return history[history.length - 1].dr;
}

function get7dDelta(history: Array<{ ts: number; dr: number }> = []): number | null {
  if (history.length < 2) return null;
  const sorted = [...history].sort((a, b) => a.ts - b.ts);
  const latest = sorted[sorted.length - 1];
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  for (let i = sorted.length - 2; i >= 0; i--) {
    if (sorted[i].ts <= weekAgo) {
      return latest.dr - sorted[i].dr;
    }
  }
  // No data point old enough to compute a true 7-day delta.
  return null;
}

export default async function DomainsPage() {
  const data = await getDrankData();

  const ranked = Object.entries(data.domains)
    .map(([domain, entry]) => {
      const dr = getCurrentDR(entry.history);
      const delta = get7dDelta(entry.history);
      return { domain, dr, delta, history: entry.history };
    })
    .filter(
      (
        d
      ): d is {
        domain: string;
        dr: number;
        delta: number | null;
        history: Array<{ ts: number; dr: number }>;
      } => d.dr !== null
    )
    .sort((a, b) => b.dr - a.dr);

  const nominations = data.communityNominations || [];

  return (
    <PageShell>
      <div className="mx-auto max-w-5xl">
        <BackLink href="/">back to high signal</BackLink>

        <HeroHeader eyebrow="web lens • powered by drank" title="Domains">
          Leaderboard of websites by Ahrefs Domain Rating (DR) — a strong external signal of
          backlink authority and source quality. Data is shared and updated weekly.
        </HeroHeader>

        <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
          <a
            href={DRANK_APP_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded border border-[var(--color-line)] px-4 py-2 font-mono text-xs uppercase tracking-[0.18em] hover:bg-[var(--color-bg-elevated)]"
          >
            Open full drank app for predictions &amp; tracking →
          </a>
          {data.lastUpdated && !Number.isNaN(new Date(data.lastUpdated).getTime()) && (
            <span className="text-[var(--color-muted)] text-xs">
              Last updated: {new Date(data.lastUpdated).toLocaleDateString()}
            </span>
          )}
        </div>

        <div className="mt-10">
          <div className="mb-3 font-mono text-xs uppercase tracking-[0.2em] text-[var(--color-accent)]">
            authority leaderboard
          </div>
          <div className="overflow-hidden rounded-lg border border-[var(--color-line)] bg-[var(--color-bg)]">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-line)] bg-[var(--color-bg-elevated)] text-left text-[var(--color-muted)]">
                  <th className="px-4 py-3 font-normal w-12">#</th>
                  <th className="px-4 py-3 font-normal">Domain</th>
                  <th className="px-4 py-3 font-normal text-right">DR</th>
                  <th className="px-4 py-3 font-normal text-right">7d Δ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-line)]">
                {ranked.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-[var(--color-muted)]">
                      No data.
                    </td>
                  </tr>
                ) : (
                  ranked.slice(0, 25).map((item, idx) => {
                    const rank = idx + 1;
                    const drStr = item.dr.toFixed(1);
                    const deltaStr =
                      item.delta !== null
                        ? (item.delta > 0 ? '+' : '') + item.delta.toFixed(1)
                        : '—';
                    const deltaClass =
                      item.delta !== null && item.delta > 0
                        ? 'text-emerald-400'
                        : item.delta !== null && item.delta < 0
                          ? 'text-rose-400'
                          : 'text-[var(--color-muted)]';
                    return (
                      <tr key={item.domain} className="hover:bg-[var(--color-bg-elevated)]">
                        <td className="px-4 py-3 font-mono text-[var(--color-muted)] tabular-nums">
                          #{rank}
                        </td>
                        <td className="px-4 py-3 font-medium">{item.domain}</td>
                        <td className="px-4 py-3 text-right font-semibold tabular-nums">{drStr}</td>
                        <td className={`px-4 py-3 text-right tabular-nums ${deltaClass}`}>
                          {deltaStr}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-[var(--color-muted)]">
            Interactive predictions and personal tracking live in the standalone{' '}
            <a href={DRANK_APP_URL} target="_blank" rel="noopener noreferrer" className="underline">
              drank
            </a>{' '}
            app.
          </p>
        </div>

        {nominations.length > 0 && (
          <div className="mt-12">
            <div className="mb-3 font-mono text-xs uppercase tracking-[0.2em] text-[var(--color-accent)]">
              community nominations
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {nominations.map((n) => (
                <a
                  key={n.domain}
                  href={DRANK_APP_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block rounded border border-[var(--color-line)] bg-[var(--color-bg)] p-4 hover:border-[var(--color-accent)]"
                >
                  <div className="font-mono font-medium">{n.domain}</div>
                  {n.note && <div className="mt-1 text-sm text-[var(--color-muted)]">{n.note}</div>}
                  <div className="mt-2 text-xs text-[var(--color-accent)]">
                    Track &amp; predict in drank →
                  </div>
                </a>
              ))}
            </div>
          </div>
        )}

        <div className="mt-12 rounded border border-[var(--color-line)] bg-[var(--color-bg-elevated)] p-6 text-sm text-[var(--color-muted)]">
          <p>
            This lens is powered by the independent{' '}
            <a href={DRANK_APP_URL} target="_blank" rel="noopener noreferrer" className="underline">
              drank
            </a>{' '}
            companion app. The shared DR data (global sites + history + nominations) is maintained
            in a public GitHub JSON updated by Actions and consumed here.
          </p>
          <p className="mt-2">
            Use drank for the full experience: localStorage personal lists, "I think this will be at
            the top" predictions, detailed charts, and export.
          </p>
        </div>
      </div>
    </PageShell>
  );
}
