import type { Metadata } from 'next';
import Link from 'next/link';
import type { Route } from 'next';

export const metadata: Metadata = {
  title: 'Explore — every surface in High Signal',
  description:
    'Sitemap of every reachable page in High Signal — the daily brief, lenses (markets, mentions, agent eval, domains, communities, lab), settings, operator surfaces, and supporting docs.',
};

interface Surface {
  href: string;
  label: string;
  note: string;
  flag?: 'new' | 'operator' | 'admin' | 'parked';
}

interface Group {
  title: string;
  blurb: string;
  surfaces: Surface[];
}

const GROUPS: Group[] = [
  {
    title: 'Daily Brief',
    blurb: 'The product. One synthesized brief per day, region-scoped, with cited evidence.',
    surfaces: [
      {
        href: '/',
        label: 'Brief (homepage)',
        note: 'Anonymous + signed-in homepage. Five sections.',
      },
      {
        href: '/brief',
        label: 'Brief (full surface)',
        note: 'Same content as homepage, deep-linkable region/product.',
      },
      {
        href: '/settings/delivery',
        label: 'Delivery preferences',
        note: 'Email channel, timezone, region. Plan 0009.',
        flag: 'new',
      },
    ],
  },
  {
    title: 'Signals + evidence',
    blurb: 'Public claims store. Every signal carries cited evidence; provenance shows why.',
    surfaces: [
      {
        href: '/data',
        label: 'Data sources',
        note: 'All 37 ingestion sources — storage, history, and live availability.',
        flag: 'new',
      },
      { href: '/signals', label: 'Signal feed', note: 'All published signals with filters.' },
      { href: '/signals/today', label: "Today's signals", note: "Just today's window." },
      { href: '/signals/types', label: 'Signals by type', note: 'Browse by signal type.' },
      { href: '/track-record', label: 'Track record', note: 'Public hit-rate ledger.' },
      {
        href: '/track-record/labels',
        label: 'Track record (labels)',
        note: 'Per-label rates: breakout vs divergence.',
      },
      { href: '/digest', label: 'Weekly digest', note: 'Curated weekly read.' },
    ],
  },
  {
    title: 'Entities',
    blurb: 'Companies, products, sectors, and the spillover graph between them.',
    surfaces: [
      { href: '/entities', label: 'Entity directory', note: 'All entities in the graph.' },
      { href: '/sectors', label: 'Sector pressure', note: 'Per-sector hit rates and momentum.' },
      {
        href: '/watchlist/entities',
        label: 'Watched entities',
        note: 'Personal watchlist + impact chain. Plan 0010.',
        flag: 'new',
      },
      {
        href: '/convergence',
        label: 'Convergence',
        note: 'Multi-source clustering of fresh mentions.',
      },
      {
        href: '/unmapped',
        label: 'Unmapped entities',
        note: 'Surface entities seen by ingest but not in graph.',
      },
    ],
  },
  {
    title: 'Lenses',
    blurb: 'Engine-room surfaces that feed the brief.',
    surfaces: [
      { href: '/markets', label: 'Markets', note: 'Narrow markets lens.' },
      { href: '/markets/history', label: 'Markets history', note: 'Historical market context.' },
      { href: '/mentions', label: 'Mentions', note: 'Brand mention intelligence.' },
      {
        href: '/agent-eval',
        label: 'Agent Eval',
        note: 'Agent-readiness audits + reel briefs. Sample audit at /agent-eval/sample; SEO variant at /agent-eval/seo.',
      },
      {
        href: '/domains',
        label: 'Domains',
        note: 'Domain rating (DR) leaderboard via the drank app.',
      },
      {
        href: '/communities',
        label: 'Communities',
        note: 'Tracked subreddits + digests. Parked.',
        flag: 'parked',
      },
      {
        href: '/lab',
        label: 'Lab',
        note: 'Local-first ingest substrate + ranked feed. Parked.',
        flag: 'parked',
      },
    ],
  },
  {
    title: 'Ideas, opportunities, teardowns',
    blurb: 'Deep views that branch from the brief.',
    surfaces: [
      {
        href: '/ideas',
        label: 'Ideas',
        note: 'Business ideas to build — surfaced from communities + tech.',
      },
      {
        href: '/opportunities',
        label: 'Opportunities',
        note: 'Concrete opportunities with evidence.',
      },
      {
        href: '/teardowns',
        label: 'Teardowns',
        note: 'Product teardowns and approved task outcomes.',
      },
      { href: '/featured', label: 'Featured', note: 'Featured selections from the editorial.' },
    ],
  },
  {
    title: 'Equities',
    blurb: 'Equity snapshot pipeline. Parked as a product direction.',
    surfaces: [
      {
        href: '/equities',
        label: 'Equities snapshot',
        note: '5k-ticker rolling closes + derived fields. Parked.',
        flag: 'parked',
      },
      {
        href: '/backtest-workbench',
        label: 'Backtest workbench',
        note: 'Cohort + label backtest UI.',
      },
      { href: '/dashboard', label: 'Dashboard', note: 'Operator dashboard view.' },
    ],
  },
  {
    title: 'Operator + admin',
    blurb: 'Internal surfaces and the review queue.',
    surfaces: [
      {
        href: '/review',
        label: 'Review queue',
        note: 'Inline claim provenance editor. Plan 0008.',
        flag: 'operator',
      },
      {
        href: '/review/lab-candidates',
        label: 'Lab candidates',
        note: 'Top Lab docs ready to become signals.',
        flag: 'operator',
      },
      {
        href: '/admin/delivery',
        label: 'Delivery admin',
        note: 'Per-day delivery counts + failure reasons. Plan 0009.',
        flag: 'admin',
      },
      {
        href: '/daily',
        label: 'Daily cockpit',
        note: 'Operator daily working view. Parked surface.',
        flag: 'operator',
      },
      {
        href: '/daily/history',
        label: 'Daily history',
        note: 'Snapshot history.',
        flag: 'operator',
      },
      {
        href: '/daily/sources',
        label: 'Daily sources',
        note: 'Source registry + diagnostics.',
        flag: 'operator',
      },
      { href: '/daily/tasks', label: 'Daily tasks', note: 'Requirements queue.', flag: 'operator' },
      {
        href: '/personal',
        label: 'Personal brief',
        note: "Sarthak's command brief. Internal.",
        flag: 'operator',
      },
      {
        href: '/watchlist',
        label: 'Unified watchlist',
        note: 'Operator cross-surface action queue.',
      },
    ],
  },
  {
    title: 'Docs + API',
    blurb: 'How High Signal works, and how to call it.',
    surfaces: [
      { href: '/about', label: 'About', note: 'What High Signal is.' },
      { href: '/methodology', label: 'Methodology', note: 'How evidence-first scoring works.' },
      { href: '/api-docs', label: 'API docs', note: 'Worker API reference.' },
      { href: '/privacy', label: 'Privacy', note: 'Privacy policy.' },
      { href: '/terms', label: 'Terms', note: 'Terms of use.' },
    ],
  },
];

function flagLabel(flag?: Surface['flag']): { text: string; tone: string } | null {
  if (!flag) return null;
  if (flag === 'new') return { text: 'new', tone: 'border-emerald-500/40 text-emerald-300' };
  if (flag === 'admin') return { text: 'admin', tone: 'border-rose-500/40 text-rose-300' };
  if (flag === 'operator') return { text: 'operator', tone: 'border-zinc-700 text-zinc-400' };
  return { text: 'parked', tone: 'border-amber-500/40 text-amber-300' };
}

export default function ExplorePage() {
  return (
    <main className="mx-auto max-w-5xl px-6 py-16">
      <a
        href="/"
        className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500 hover:text-zinc-300"
      >
        ← high signal
      </a>
      <header className="mt-3 border-b border-zinc-800 pb-6">
        <h1 className="text-3xl font-medium tracking-tight">Explore</h1>
        <p className="mt-2 max-w-2xl text-sm text-zinc-400">
          Every surface in High Signal. The brief is the homepage; everything else is either a deep
          view, a lens, an operator tool, or supporting docs. Operator and admin surfaces are gated
          behind Clerk.
        </p>
      </header>

      <div className="mt-10 space-y-12">
        {GROUPS.map((group) => (
          <section key={group.title}>
            <h2 className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">
              {group.title}
            </h2>
            <p className="mt-2 max-w-3xl text-sm text-zinc-400">{group.blurb}</p>
            <ul className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {group.surfaces.map((s) => {
                const flag = flagLabel(s.flag);
                return (
                  <li key={s.href} className="border border-zinc-900 p-3 hover:border-zinc-700">
                    <Link href={s.href as Route} className="block group">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-zinc-200 group-hover:text-[var(--color-accent)]">
                          {s.label}
                        </span>
                        {flag && (
                          <span
                            className={`border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em] ${flag.tone}`}
                          >
                            {flag.text}
                          </span>
                        )}
                      </div>
                      <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                        {s.href}
                      </div>
                      <p className="mt-2 text-xs leading-5 text-zinc-400">{s.note}</p>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>

      <p className="mt-16 border-l-2 border-zinc-800 pl-3 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
        Some surfaces are parked (per PROJECT_STATUS.md) or operator-only. They remain reachable so
        nothing built becomes invisible.
      </p>
    </main>
  );
}
