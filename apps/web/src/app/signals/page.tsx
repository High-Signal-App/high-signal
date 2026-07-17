import {
  api,
  type Direction,
  type Confidence,
  type SignalRow,
  type MentionBrandConfig,
} from '@/lib/api';
import { isBackfillSignal } from '@/lib/signal-format';
import { SignalCard } from '@/components/molecules/SignalCard';
import { FilterBar, type Facets } from '@/components/molecules/FilterBar';
import { assessSignalQuality, type SignalContentCategory } from '@high-signal/shared';
import { getRequestAuth } from '@/lib/require-auth';
import { FaqJsonLd, SoftwareApplicationJsonLd } from '@/components/seo/structured-data';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Signals',
  alternates: { canonical: '/signals' },
};

interface SP {
  type?: string;
  direction?: Direction;
  confidence?: Confidence;
  entity?: string;
  category?: SignalContentCategory;
  country?: CountryId;
  company?: string;
}

const FILTER_KEYS = new Set(['category', 'type', 'direction', 'confidence', 'entity']);
const COMPANY_SIGNAL_LIMIT = 200;

type CountryId = 'global' | 'US' | 'CN' | 'IN';

const COUNTRY_FEEDS: Array<{ id: CountryId; label: string; short: string; sub: string }> = [
  { id: 'global', label: 'Global', short: 'GLB', sub: 'all sources' },
  { id: 'US', label: 'United States', short: 'US', sub: 'companies + policy' },
  { id: 'CN', label: 'China', short: 'CN', sub: 'SCMP + China news' },
  { id: 'IN', label: 'India', short: 'IN', sub: 'companies + policy' },
];

const COUNTRY_PROFILES: Record<
  Exclude<CountryId, 'global'>,
  { entityIds: string[]; terms: string[] }
> = {
  US: {
    entityIds: [
      'NVDA',
      'AMD',
      'INTC',
      'AAPL',
      'TSLA',
      'GOOGL',
      'AMZN',
      'MSFT',
      'META',
      'ORCL',
      'IBM',
      'OPENAI',
      'ANTHROPIC',
      'ANET',
      'AVGO',
      'MRVL',
      'DELL',
      'HPE',
      'SMCI',
      'CRWV',
    ],
    terms: [
      'united states',
      'u.s.',
      'us ',
      'america',
      'american',
      'washington',
      'sec.gov',
      'ftc',
      'doj',
      'nasdaq',
      'openai',
      'anthropic',
      'nvidia',
      'microsoft',
      'google',
      'amazon',
      'meta',
      'tesla',
      'apple',
    ],
  },
  CN: {
    entityIds: [
      'BABA',
      'BIDU',
      'TCEHY',
      'SMIC',
      'HHGRACE',
      'JCET',
      'LENOVO',
      'INSPUR',
      'DEEPSEEK',
      'MOONSHOT',
      'ZHIPU',
      'UNITREE',
      'HAILIANG',
      'BYTEDANCE',
    ],
    terms: [
      'china',
      'chinese',
      'hong kong',
      'beijing',
      'shanghai',
      'shenzhen',
      'scmp.com',
      'technode.com',
      'pandaily.com',
      'cgtn.com',
      'alibaba',
      'baidu',
      'tencent',
      'bytedance',
      'deepseek',
      'zhipu',
      'moonshot',
      'smic',
      'huawei',
      'lenovo',
      'pdd',
      'xpeng',
      'byd',
      'cxmt',
    ],
  },
  IN: {
    entityIds: [
      'TATAELXSI',
      'KPITTECH',
      'PERSISTENT',
      'LTIM',
      'TATACOMM',
      'YOTTA',
      'INFY',
      'TCS',
      'WIT',
      'HCLTECH',
      'RELIANCE',
    ],
    terms: [
      'india',
      'indian',
      'mumbai',
      'bengaluru',
      'delhi',
      'rbi',
      'sebi',
      'infosys',
      'tcs',
      'wipro',
      'hcltech',
      'reliance',
      'jio',
      'tata',
      'zerodha',
      'razorpay',
      'paytm',
      'groww',
      'upstox',
    ],
  },
};

const signalTabs = [
  { href: '/signals/today', label: 'today' },
  { href: '/signals', label: 'all signals' },
  { href: '/track-record', label: 'track record' },
  { href: '/signals/types', label: 'types' },
];

/**
 * Landing-page FAQ for GEO (generative-engine optimization). AI search
 * engines lift 35-60 word passages, so each answer is self-contained,
 * factual, and in that band. Mirrors the wording in agents.md and
 * /methodology so surfaces stay in sync.
 */
const LANDING_FAQ: Array<{ question: string; answer: string }> = [
  {
    question: 'What is High Signal?',
    answer:
      'High Signal is a daily synthesized intelligence brief covering technology, startups, and finance. It aggregates noisy public sources, curates and cleans them, and emits an end-of-day brief answering five questions for operators. Every claim cites at least two independent sources.',
  },
  {
    question: 'Is High Signal free?',
    answer:
      'Yes, everything is free for now. There is no paid tier, no billing, and no paywall. Region filters are free, and all features are accessible without payment. The brief renders identically for anonymous and signed-in users until a brand is connected.',
  },
  {
    question: 'How does High Signal ensure quality?',
    answer:
      'Every claim in the brief must cite at least two independent sources. A public hit-rate ledger tracks whether past signals were right. Confidence is rated as low, medium, or high, and calibrated post-hoc against outcomes. Prediction-market-only drafts are killed even when the pipeline marks them publishable.',
  },
  {
    question: 'What sources does High Signal use?',
    answer:
      'Reddit, news, Hacker News, YouTube transcripts, SEC filings, GitHub, IR pages, papers, government feeds, and prediction markets. The job is curation and de-duplication, not aggregation volume. Sources are grouped into classes — news, filing, ir, blog, regulator, transcript, repo, and market — so independence is checked by class, not just domain.',
  },
  {
    question: 'What is the hit-rate ledger?',
    answer:
      'A public track record showing whether past signals were accurate. It is the competitive moat — competitors cannot copy it without rebuilding the history from scratch. Every published market signal is scored against subsequent moves, and the hit-rate displays inline on each new signal.',
  },
  {
    question: 'Can I filter by region?',
    answer:
      'Yes, region is a free filter on every section. The default is global. Users can switch to any region and the brief recomputes scoped to that region\u2019s entities and sources. Preference persists for signed-in users via Clerk publicMetadata.',
  },
  {
    question: 'Does High Signal have an API or RSS feed?',
    answer:
      'Yes, RSS and Atom feeds are available at /digest/rss and /digest/atom. Signal-level feeds live at /signals/rss and /signals/atom. There is also an API docs page at /api-docs describing the REST endpoints for signals, entities, and the track record.',
  },
];

const nowIso = new Date(0).toISOString();
const DEFAULT_COMPANY_CONFIGS: MentionBrandConfig[] = [
  {
    id: 'default-nvidia',
    companyId: 'default',
    brandName: 'NVIDIA',
    brandAliases: ['NVDA', 'Nvidia', 'CUDA', 'Blackwell'],
    brandUrl: 'https://nvidia.com',
    competitors: [
      { name: 'AMD', url: 'https://amd.com' },
      { name: 'Intel', url: 'https://intel.com' },
    ],
    platforms: ['custom'],
    aiEndpointUrl: null,
    aiModel: null,
    createdAt: nowIso,
    updatedAt: nowIso,
  },
  {
    id: 'default-openai',
    companyId: 'default',
    brandName: 'OpenAI',
    brandAliases: ['ChatGPT', 'GPT-5', 'OpenAI'],
    brandUrl: 'https://openai.com',
    competitors: [
      { name: 'Anthropic', url: 'https://anthropic.com' },
      { name: 'Google Gemini', url: 'https://gemini.google.com' },
    ],
    platforms: ['custom'],
    aiEndpointUrl: null,
    aiModel: null,
    createdAt: nowIso,
    updatedAt: nowIso,
  },
  {
    id: 'default-apple',
    companyId: 'default',
    brandName: 'Apple',
    brandAliases: ['AAPL', 'iPhone', 'App Store', 'Apple Intelligence'],
    brandUrl: 'https://apple.com',
    competitors: [
      { name: 'Samsung', url: 'https://samsung.com' },
      { name: 'Google', url: 'https://google.com' },
    ],
    platforms: ['custom'],
    aiEndpointUrl: null,
    aiModel: null,
    createdAt: nowIso,
    updatedAt: nowIso,
  },
  {
    id: 'default-alibaba',
    companyId: 'default',
    brandName: 'Alibaba',
    brandAliases: ['BABA', 'Alibaba Cloud', 'Qwen', 'Aliyun'],
    brandUrl: 'https://alibabagroup.com',
    competitors: [
      { name: 'Tencent', url: 'https://tencent.com' },
      { name: 'Baidu', url: 'https://baidu.com' },
    ],
    platforms: ['custom'],
    aiEndpointUrl: null,
    aiModel: null,
    createdAt: nowIso,
    updatedAt: nowIso,
  },
  {
    id: 'default-smic',
    companyId: 'default',
    brandName: 'SMIC',
    brandAliases: ['SMIC', 'Semiconductor Manufacturing International', '0981.HK'],
    brandUrl: 'https://smics.com',
    competitors: [
      { name: 'TSMC', url: 'https://tsmc.com' },
      { name: 'Samsung Foundry', url: 'https://semiconductor.samsung.com' },
    ],
    platforms: ['custom'],
    aiEndpointUrl: null,
    aiModel: null,
    createdAt: nowIso,
    updatedAt: nowIso,
  },
  {
    id: 'default-reliance',
    companyId: 'default',
    brandName: 'Reliance / Jio',
    brandAliases: ['Reliance', 'Jio', 'RELIANCE', 'Jio Platforms'],
    brandUrl: 'https://ril.com',
    competitors: [
      { name: 'Bharti Airtel', url: 'https://airtel.in' },
      { name: 'Tata Communications', url: 'https://tatacommunications.com' },
    ],
    platforms: ['custom'],
    aiEndpointUrl: null,
    aiModel: null,
    createdAt: nowIso,
    updatedAt: nowIso,
  },
];

function countBy<T extends string>(values: T[]) {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return Array.from(counts.entries())
    .map(([k, n]) => ({ k, n }))
    .sort((a, b) => b.n - a.n || a.k.localeCompare(b.k));
}

function facetsFromSignals(signals: SignalRow[]): Facets {
  return {
    types: countBy(signals.map((signal) => signal.signalType)),
    categories: countBy(
      signals.map(
        (signal) =>
          signal.contentCategory ??
          assessSignalQuality({
            signalType: signal.signalType,
            confidence: signal.confidence,
            evidenceUrls: signal.evidenceUrls,
            bodyMd: signal.bodyMd,
          }).contentCategory
      )
    ),
    directions: countBy(signals.map((signal) => signal.direction)),
    confidences: countBy(signals.map((signal) => signal.confidence)),
    topEntities: countBy(signals.map((signal) => signal.primaryEntityId)).slice(0, 20),
  };
}

function signalFilters(sp: SP) {
  const { company: _company, country: _country, ...filters } = sp;
  return filters;
}

function countryFeed(id: string | undefined) {
  return COUNTRY_FEEDS.find((feed) => feed.id === id) ?? COUNTRY_FEEDS[0]!;
}

function norm(value: string | null | undefined) {
  return (value ?? '').trim().toLowerCase();
}

function host(value: string | null | undefined) {
  const raw = (value ?? '').trim();
  if (!raw) return '';
  try {
    return new URL(raw.startsWith('http') ? raw : `https://${raw}`).hostname
      .replace(/^www\./, '')
      .toLowerCase();
  } catch {
    return raw
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .split('/')[0]
      .toLowerCase();
  }
}

function companyTerms(config: MentionBrandConfig) {
  const competitors = config.competitors ?? [];
  return {
    direct: [config.brandName, ...(config.brandAliases ?? []), host(config.brandUrl)]
      .map(norm)
      .filter(Boolean),
    competitors: competitors
      .flatMap((competitor) => [competitor.name, host(competitor.url)])
      .map(norm)
      .filter(Boolean),
  };
}

function signalText(signal: SignalRow) {
  return [
    signal.primaryEntityId,
    signal.signalType,
    signal.bodyMd,
    ...(signal.sourceClasses ?? []),
    ...signal.evidenceUrls,
  ]
    .join('\n')
    .toLowerCase();
}

function includesTerm(text: string, term: string) {
  const needle = term.trim().toLowerCase();
  if (!needle) return false;
  if (/^[a-z0-9]+$/i.test(needle) && needle.length <= 4) {
    return new RegExp(
      `(^|[^a-z0-9])${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`
    ).test(text);
  }
  return text.includes(needle);
}

function countryRelevanceScore(signal: SignalRow, country: CountryId) {
  if (country === 'global') return 1;
  const profile = COUNTRY_PROFILES[country];
  const text = signalText(signal);
  let score = profile.entityIds.includes(signal.primaryEntityId) ? 20 : 0;
  for (const term of profile.terms) {
    if (includesTerm(text, term)) score += 3;
  }
  return score;
}

function countrySignals(signals: SignalRow[], country: CountryId) {
  if (country === 'global') return signals;
  return signals
    .map((signal) => ({ signal, relevance: countryRelevanceScore(signal, country) }))
    .filter((item) => item.relevance > 0)
    .sort(
      (a, b) =>
        b.relevance - a.relevance ||
        (b.signal.qualityScore ?? 0) - (a.signal.qualityScore ?? 0) ||
        new Date(b.signal.publishedAt).getTime() - new Date(a.signal.publishedAt).getTime()
    )
    .map((item) => item.signal);
}

function countryCounts(signals: SignalRow[]) {
  return Object.fromEntries(
    COUNTRY_FEEDS.map((feed) => [
      feed.id,
      feed.id === 'global' ? signals.length : countrySignals(signals, feed.id).length,
    ])
  ) as Record<CountryId, number>;
}

function scopedHref(country: CountryId, companyId?: string) {
  const params = new URLSearchParams();
  if (country !== 'global') params.set('country', country);
  if (companyId) params.set('company', companyId);
  const query = params.toString();
  return query ? `/signals?${query}` : '/signals';
}

function relevanceScore(signal: SignalRow, config: MentionBrandConfig) {
  const terms = companyTerms(config);
  const text = signalText(signal);
  let score = 0;
  for (const term of terms.direct) {
    if (term.length >= 2 && text.includes(term)) score += 8;
    if (term.length >= 2 && signal.primaryEntityId.toLowerCase() === term) score += 12;
  }
  for (const term of terms.competitors) {
    if (term.length >= 2 && text.includes(term)) score += 5;
    if (term.length >= 2 && signal.primaryEntityId.toLowerCase() === term) score += 7;
  }
  if (
    signal.contentCategory === 'customer-complaint' ||
    signal.contentCategory === 'product-opportunity'
  ) {
    score += 2;
  }
  if (signal.sourceClasses?.includes('community') || signal.sourceClasses?.includes('review')) {
    score += 1;
  }
  return score;
}

function companySignals(signals: SignalRow[], config: MentionBrandConfig) {
  return signals
    .map((signal) => ({ signal, relevance: relevanceScore(signal, config) }))
    .filter((item) => item.relevance > 0)
    .sort(
      (a, b) =>
        b.relevance - a.relevance ||
        (b.signal.qualityScore ?? 0) - (a.signal.qualityScore ?? 0) ||
        new Date(b.signal.publishedAt).getTime() - new Date(a.signal.publishedAt).getTime()
    )
    .map((item) => item.signal);
}

async function loadCompanyConfigs() {
  const auth = await getRequestAuth();
  const userId = auth && 'userId' in auth ? auth.userId : null;
  const orgId = auth && 'orgId' in auth ? auth.orgId : null;
  const ownerId = orgId ?? userId;
  if (!ownerId) return { ownerId: null, configs: DEFAULT_COMPANY_CONFIGS };
  try {
    const { configs } = await api.mentionConfigs(ownerId);
    return { ownerId, configs: configs.length ? configs : DEFAULT_COMPANY_CONFIGS };
  } catch {
    return { ownerId, configs: DEFAULT_COMPANY_CONFIGS };
  }
}

// Public per agents.md: signals are a "public web page" output channel.
export default async function SignalsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { ownerId, configs } = await loadCompanyConfigs();
  const activeCountry = countryFeed(sp.country);
  const activeCompany =
    sp.company && sp.company !== 'global'
      ? (configs.find((config) => config.id === sp.company) ?? null)
      : null;
  let allSignals: SignalRow[] = [];
  let signals: SignalRow[] = [];
  let counts: Record<CountryId, number> = { global: 0, US: 0, CN: 0, IN: 0 };
  let facets: Facets = {
    types: [],
    categories: [],
    directions: [],
    confidences: [],
    topEntities: [],
  };
  try {
    const filters = signalFilters(sp);
    const [s, f] = await Promise.all([
      api.signals(
        activeCompany || activeCountry.id !== 'global'
          ? { ...filters, limit: COMPANY_SIGNAL_LIMIT }
          : filters
      ),
      api.facets(),
    ]);
    allSignals = s.signals.filter((signal) => !isBackfillSignal(signal));
    counts = countryCounts(allSignals);
    const countryScoped = countrySignals(allSignals, activeCountry.id);
    signals = activeCompany
      ? companySignals(countryScoped, activeCompany).slice(0, 50)
      : countryScoped.slice(0, 50);
    facets = signals.length ? facetsFromSignals(signals) : f;
  } catch {
    /* api offline / empty */
  }

  const activeFilters = Object.entries(sp).filter(([key, v]) => FILTER_KEYS.has(key) && Boolean(v));

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:py-8">
      <FaqJsonLd items={LANDING_FAQ} />
      <SoftwareApplicationJsonLd />
      <section className="mb-8 max-w-3xl" aria-labelledby="homepage-intro">
        <h2
          id="homepage-intro"
          className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-accent)]"
        >
          evidence-first daily intelligence
        </h2>
        <p className="mt-3 text-sm leading-6 text-zinc-400">
          High Signal turns noisy public sources into a daily brief on technology, startups, and
          finance. Each published claim carries two independent citations and a confidence band, so
          the public hit-rate ledger can be checked over time.
        </p>
      </section>
      <div className="grid gap-8 lg:grid-cols-[248px_minmax(0,1fr)]">
        <SignalsSidebar
          configs={configs}
          activeCompanyId={activeCompany?.id ?? 'global'}
          activeCountryId={activeCountry.id}
          countryCounts={counts}
          ownerId={ownerId}
        />
        <div className="min-w-0">
          <Header company={activeCompany} country={activeCountry} />
          <FilterBar facets={facets} />
          <ActiveSummary
            count={signals.length}
            active={activeFilters}
            company={activeCompany}
            country={activeCountry}
          />
          {signals.length === 0 ? (
            <Empty
              filtered={activeFilters.length > 0}
              company={activeCompany}
              country={activeCountry}
            />
          ) : (
            <section className="mt-4 border-t border-zinc-800">
              {signals.map((s) => (
                <SignalCard key={s.id} s={s} />
              ))}
            </section>
          )}
        </div>
      </div>
      <LandingFaq />
      <FleetFooter />
    </main>
  );
}

function SignalsSidebar({
  configs,
  activeCompanyId,
  activeCountryId,
  countryCounts,
  ownerId,
}: {
  configs: MentionBrandConfig[];
  activeCompanyId: string;
  activeCountryId: CountryId;
  countryCounts: Record<CountryId, number>;
  ownerId: string | null;
}) {
  return (
    <aside className="min-w-0 overflow-hidden border-b border-zinc-800 pb-5 lg:sticky lg:top-20 lg:flex lg:h-[calc(100vh-6rem)] lg:flex-col lg:overflow-visible lg:border-b-0 lg:pb-0">
      <div className="min-h-0 min-w-0 max-w-full flex-1 pr-1 lg:overflow-y-auto lg:[scrollbar-color:var(--color-line)_transparent] lg:[scrollbar-width:thin]">
        <div className="min-w-0">
          <SectionLabel label="feeds" />
          <nav className="mt-2 grid min-w-0 grid-cols-2 gap-2 lg:block lg:space-y-1">
            {COUNTRY_FEEDS.map((feed) => (
              <SidebarLink
                key={feed.id}
                href={scopedHref(feed.id)}
                active={activeCountryId === feed.id}
                label={feed.label}
                eyebrow={feed.short}
                count={countryCounts[feed.id]}
                sub={feed.sub}
              />
            ))}
          </nav>
        </div>

        <div className="mt-7 min-w-0 pb-4">
          <SectionLabel label="companies / ideas" />
          {configs.length > 0 ? (
            <nav className="mt-2 flex max-w-full gap-2 overflow-x-auto pb-1 lg:block lg:space-y-1 lg:overflow-visible lg:pb-0">
              {configs.map((config) => (
                <SidebarLink
                  key={config.id}
                  href={scopedHref(activeCountryId, config.id)}
                  active={activeCompanyId === config.id}
                  label={config.brandName}
                  sub={host(config.brandUrl) || `${config.competitors.length} competitors`}
                />
              ))}
            </nav>
          ) : (
            <p className="mt-3 border border-dashed border-zinc-800 p-3 text-xs leading-5 text-zinc-500">
              Add a company or idea to make this feed personal.
            </p>
          )}
        </div>
      </div>

      <div className="mt-3 shrink-0 border-t border-zinc-800 pt-4">
        <a
          href={ownerId ? '/mentions' : '/sign-in'}
          className="block border border-zinc-800 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-accent)] hover:border-[var(--color-accent)]/60 hover:text-cyan-200"
        >
          + add new company
        </a>
      </div>
    </aside>
  );
}

function SectionLabel({ label }: { label: string }) {
  return (
    <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-600">{label}</div>
  );
}

function SidebarLink({
  href,
  active,
  label,
  eyebrow,
  count,
  sub,
}: {
  href: string;
  active: boolean;
  label: string;
  eyebrow?: string;
  count?: number;
  sub?: string;
}) {
  return (
    <a
      href={href}
      className={`grid min-w-[150px] grid-cols-[minmax(0,1fr)_auto] gap-3 border px-3 py-2 transition-colors lg:min-w-0 ${
        active
          ? 'border-[var(--color-accent)]/70 bg-cyan-400/5 text-zinc-100'
          : 'border-transparent text-zinc-500 hover:border-zinc-800 hover:bg-white/[0.015] hover:text-zinc-200'
      }`}
    >
      <span className="min-w-0">
        {eyebrow && (
          <span className="mb-1 block font-mono text-[9px] uppercase tracking-[0.16em] text-zinc-600">
            {eyebrow}
          </span>
        )}
        <span className="block truncate text-sm">{label}</span>
        {sub && (
          <span className="mt-1 block truncate font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-600">
            {sub}
          </span>
        )}
      </span>
      {typeof count === 'number' && (
        <span className="nums pt-0.5 font-mono text-xs tabular-nums text-zinc-500">{count}</span>
      )}
    </a>
  );
}

function SignalTabs() {
  return (
    <nav className="mt-6 flex flex-wrap gap-x-5 gap-y-2 font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-500">
      {signalTabs.map((item) => (
        <a className="hover:text-[var(--color-accent)]" href={item.href} key={item.href}>
          {item.label}
        </a>
      ))}
    </nav>
  );
}

function Header({
  company,
  country,
}: {
  company: MentionBrandConfig | null;
  country: (typeof COUNTRY_FEEDS)[number];
}) {
  const isGlobal = country.id === 'global';
  return (
    <header className="border-b border-zinc-800 pb-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
          <span>{isGlobal ? 'global feed' : `${country.label} feed`}</span>
          {company ? (
            <>
              <span className="mx-2 text-zinc-700">/</span>
              <span className="text-zinc-300">{company.brandName}</span>
            </>
          ) : null}
        </div>
        <SignalTabs />
      </div>
      <div className="mt-5 grid gap-4 md:grid-cols-[minmax(0,1fr)_180px] md:items-end">
        <div>
          <h1 className="text-3xl font-medium tracking-tight">
            {company
              ? `${company.brandName} signals`
              : isGlobal
                ? 'Signals'
                : `${country.label} signals`}
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
            {company
              ? `Company-focused reads from the ${isGlobal ? 'global' : country.label} source stream, ranked by direct mentions, competitors, domains, customer pain, and category movement.`
              : isGlobal
                ? 'Published directional reads with cited evidence, confidence, and a public hit-rate trail.'
                : `Country-focused reads for ${country.label}, including mapped companies plus local policy, market, and product language before it fully maps to a ticker.`}
          </p>
        </div>
        <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-500 md:text-right">
          <a className="hover:text-[var(--color-accent)]" href="/signals/rss">
            rss
          </a>
          <span className="mx-2">/</span>
          <a className="hover:text-[var(--color-accent)]" href="/track-record">
            ledger
          </a>
        </div>
      </div>
    </header>
  );
}

function ActiveSummary({
  count,
  active,
  company,
  country,
}: {
  count: number;
  active: [string, unknown][];
  company: MentionBrandConfig | null;
  country: (typeof COUNTRY_FEEDS)[number];
}) {
  return (
    <div className="mt-4 flex flex-wrap items-baseline justify-between gap-3 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
      <span>
        <span className="nums text-zinc-300">{count}</span> result{count === 1 ? '' : 's'}
        {country.id !== 'global' ? <span> in {country.label}</span> : null}
        {company ? <span> for {company.brandName}</span> : null}
      </span>
      {active.length > 0 && (
        <span className="max-w-full truncate">
          {active.map(([k, v]) => `${k}=${String(v)}`).join('  /  ')}
        </span>
      )}
    </div>
  );
}

function Empty({
  filtered,
  company,
  country,
}: {
  filtered: boolean;
  company: MentionBrandConfig | null;
  country: (typeof COUNTRY_FEEDS)[number];
}) {
  return (
    <div className="mt-12 border border-dashed border-zinc-800 p-10 text-center font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-500">
      {company
        ? 'no company-relevant signals yet - add aliases, competitors, or wait for the next source sweep'
        : country.id !== 'global'
          ? `no ${country.label.toLowerCase()} signals match yet - the next source sweep may fill this`
          : filtered
            ? 'no signals match these filters'
            : 'no signals published yet — first cards drop after phase 1'}
    </div>
  );
}

function LandingFaq() {
  return (
    <section className="mt-16 border-t border-zinc-800 pt-10" aria-labelledby="faq-heading">
      <h2
        id="faq-heading"
        className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-accent)]"
      >
        frequently asked
      </h2>
      <div className="mt-6 divide-y divide-zinc-800 border-y border-zinc-800">
        {LANDING_FAQ.map((item) => (
          <details key={item.question} className="group py-5">
            <summary className="cursor-pointer text-base font-medium tracking-tight text-zinc-100 hover:text-[var(--color-accent)]">
              {item.question}
            </summary>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-400">{item.answer}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

const FLEET_LINKS: Array<{ name: string; url: string; blurb: string }> = [
  { name: 'Foundry', url: 'https://sassmaker.com', blurb: 'SaaS factory floor' },
  { name: 'Aliveville', url: 'https://aliveville.com', blurb: 'AI world simulator' },
  { name: 'CodeVetter', url: 'https://codevetter.com', blurb: 'AI code review' },
  { name: 'Karte', url: 'https://karte.cc', blurb: 'AI link-in-bio' },
  { name: 'RolePatch', url: 'https://rolepatch.com', blurb: 'AI resume tailoring' },
  {
    name: 'Significant Hobbies',
    url: 'https://significanthobbies.com',
    blurb: 'Hobby journey mapper',
  },
  { name: 'Materia', url: 'https://materia.io', blurb: 'Evidence-graded remedies' },
];

function FleetFooter() {
  return (
    <footer className="mt-16 border-t border-zinc-800 pt-8">
      <h2
        id="fleet-heading"
        className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-600"
      >
        more from the fleet
      </h2>
      <ul className="mt-4 flex flex-wrap gap-x-6 gap-y-2 font-mono text-[11px] text-zinc-500">
        {FLEET_LINKS.map((link) => (
          <li key={link.url}>
            <a
              href={link.url}
              className="text-zinc-500 transition-colors hover:text-[var(--color-accent)]"
              rel="noopener"
            >
              {link.name}
            </a>
            <span className="ml-1.5 text-zinc-700">— {link.blurb}</span>
          </li>
        ))}
      </ul>
    </footer>
  );
}
