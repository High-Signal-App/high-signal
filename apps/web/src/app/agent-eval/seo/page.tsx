import { PageShell, Panel, SectionHeader, StatGrid } from '@/components/system/HighSignalUI';
import { BreadcrumbJsonLd, SeoGeoAuditJsonLd } from '@/components/seo/structured-data';
import { ReadableMutedTheme } from '@/components/content/ReadableMutedTheme';
import { api, type SeoAuditReport } from '@/lib/api';
import { SITE_URL } from '@/lib/site';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'AI visibility and search-readiness audit',
  description:
    "Audit a site's SEO and AI-readiness primitives, understand what the grade proves, and separate technical crawlability from actual AI mentions and citations.",
  alternates: { canonical: `${SITE_URL}/agent-eval/seo` },
};

const STATUS_TONE: Record<SeoAuditReport['band'], string> = {
  strong: 'text-[var(--color-accent)]',
  clear: 'text-zinc-100',
  weak: 'text-amber-300',
  missing: 'text-rose-300',
};

const AXIS_LABEL: Record<'seo' | 'geo' | 'both', string> = {
  seo: 'SEO',
  geo: 'GEO',
  both: 'SEO + GEO',
};

const CHECK_PRIORITY: Record<SeoAuditReport['checks'][number]['status'], number> = {
  missing: 0,
  weak: 1,
  clear: 2,
  strong: 3,
};

const DEFAULT_URL = SITE_URL; // eat our own dog food — audit ourselves by default.

const READINESS_SECTIONS = [
  {
    title: 'What the public audit checks',
    body: 'Enter any public URL to inspect its SEO and GEO primitives. The audit grades canonical metadata, Open Graph and Twitter metadata, Schema.org JSON-LD, robots and sitemap discovery, RSS where present, and agent-readable surfaces such as llms.txt. It separates the search axis from the agent-readiness axis so a technically strong Google surface is not mistaken for complete AI visibility.',
  },
  {
    title: 'What a passing audit means',
    body: 'A strong technical grade means crawlers and assistants have clearer paths to canonical, structured, citable material. It does not prove that Google has indexed every page, that a page ranks for a target query, or that ChatGPT, Claude, Perplexity, or Gemini currently cite the brand. Those outcomes require observation over time. Technical readiness is a prerequisite, not the awareness result.',
  },
  {
    title: 'What to do with a weak result',
    body: 'Fix missing or conflicting canonicals first. Ensure public pages are allowed by robots policy and present in one canonical sitemap. Add structured data that matches visible content. Publish concise product facts, methodology, evidence, and change history in human-readable pages. Expose stable Markdown or API surfaces for agent retrieval where they genuinely represent the product. Then rerun the audit and measure search and provider observations separately.',
  },
  {
    title: 'Move from readiness to awareness',
    body: "For a connected brand, High Signal can store provider observations and mention evidence through its AI-visibility engine. Useful measurement asks specific, repeatable questions: whether the brand is mentioned, whether it is cited, which competitors appear, which source URLs are used, and how those results change after the site's content or technical surfaces change. A zero should mean an observed absence, not a missing run.",
  },
  {
    title: 'Audit High Signal itself',
    body: 'The page defaults to highsignal.app so its own readiness remains visible. High Signal publishes a canonical sitemap, robots policy, structured data, llms.txt, a full agent brief, Markdown alternates, an agent catalog, source-backed signals, methodology, and a changelog. The same public audit can be rerun after each release.',
  },
] as const;

export default async function SeoAuditPage({
  searchParams,
}: {
  searchParams?: Promise<{ url?: string }>;
}) {
  const params = (await searchParams) ?? {};
  const targetUrl = (params.url ?? DEFAULT_URL).trim();

  let report: SeoAuditReport | null = null;
  let error: string | null = null;
  try {
    report = await api.seoAudit(targetUrl);
    if (report.error) error = report.error;
  } catch (e) {
    error = e instanceof Error ? e.message : 'audit_failed';
  }

  const orderedChecks = report
    ? [...report.checks].sort(
        (left, right) => CHECK_PRIORITY[left.status] - CHECK_PRIORITY[right.status]
      )
    : [];
  const highestLeverageCheck = orderedChecks.find((check) => check.status !== 'strong') ?? null;

  return (
    <>
      <ReadableMutedTheme />
      <PageShell>
        <BreadcrumbJsonLd
          trail={[
            { name: 'Home', path: '/' },
            { name: 'Agent Eval', path: '/agent-eval' },
            { name: 'AI visibility audit', path: '/agent-eval/seo' },
          ]}
        />
        <SeoGeoAuditJsonLd />
        <a
          href="/agent-eval"
          className="inline-flex min-h-11 items-center font-mono text-xs uppercase tracking-[0.18em] text-[var(--color-muted)] hover:text-[var(--color-accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
        >
          back to agent eval
        </a>
        <SectionHeader
          eyebrow="ai visibility + search readiness"
          title="Is your site discoverable, structured, and citable?"
        >
          AI visibility has two layers. A site must first be technically discoverable and
          understandable; providers must then actually mention or cite it for relevant questions.
          This public audit measures the first layer. Connected-brand observations belong to the
          second.
        </SectionHeader>

        <form
          id="audit-form"
          className="mt-8 grid gap-3 border-y border-[var(--color-line)] py-4 md:grid-cols-[1fr_auto]"
        >
          <label className="mt-5 block text-sm text-[var(--color-muted)]" htmlFor="url">
            URL to audit
            <input
              id="url"
              name="url"
              type="url"
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              required
              defaultValue={targetUrl}
              className="mt-2 block w-full border border-[var(--color-line)] bg-transparent px-3 py-2 text-sm text-[var(--color-fg)] outline-none focus:border-[var(--color-accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
            />
          </label>
          <div className="md:self-end">
            <button
              className="mt-5 w-full border border-[var(--color-line)] px-4 py-2 font-mono text-xs uppercase tracking-[0.18em] text-[var(--color-fg)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
              type="submit"
            >
              run audit
            </button>
          </div>
        </form>

        {error ? (
          <Panel eyebrow="audit error" title="Audit could not complete">
            <p className="mt-3 text-sm leading-6 text-[var(--color-muted)]">
              The auditor couldn&apos;t complete a clean fetch. Common causes: site blocks
              non-browser user agents, HTTP/2 negotiation failed, or the path returned a non-2xx.
            </p>
            <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--color-muted)]">
              target: {targetUrl} · code: {error}
            </p>
            <a
              className="mt-4 inline-flex min-h-11 items-center text-sm text-[var(--color-fg)] hover:text-[var(--color-accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
              href="#audit-form"
            >
              Check the URL and run the audit again →
            </a>
          </Panel>
        ) : null}

        {report && !error ? (
          <>
            <StatGrid
              items={[
                {
                  label: 'overall readiness',
                  value: `${report.score}/100`,
                  sub: `band: ${report.band} · technical checks`,
                },
                {
                  label: 'search readiness',
                  value: `${report.seoScore}/100`,
                  sub: 'technical checks only',
                },
                {
                  label: 'agent readiness',
                  value: `${report.geoScore}/100`,
                  sub: 'technical checks only',
                },
                {
                  label: 'checks',
                  value: report.checks.length.toString(),
                  sub: `${report.checks.filter((c) => c.status === 'strong').length} strong`,
                },
              ]}
            />

            {highestLeverageCheck ? (
              <section
                className="mt-8 border-y border-[var(--color-line)] py-5"
                aria-labelledby="highest-leverage-fix"
              >
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-accent)]">
                  highest-leverage fix
                </p>
                <h2
                  id="highest-leverage-fix"
                  className="mt-3 text-xl font-medium tracking-tight text-[var(--color-fg)]"
                >
                  {highestLeverageCheck.title}
                </h2>
                <p className="mt-2 max-w-[72ch] text-sm leading-7 text-[var(--color-muted)]">
                  {highestLeverageCheck.recommendation}
                </p>
              </section>
            ) : null}

            <section
              className="mt-10 border-t border-[var(--color-line)]"
              aria-labelledby="technical-checks"
            >
              <h2
                id="technical-checks"
                className="py-4 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-accent)]"
              >
                technical checks · fix-first order
              </h2>
              {orderedChecks.map((check) => (
                <article
                  key={check.key}
                  className="grid gap-3 border-b border-[var(--color-line)] py-5 md:grid-cols-[180px_1fr]"
                >
                  <div>
                    <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
                      {AXIS_LABEL[check.axis]}
                    </div>
                    <div className={`mt-2 text-lg font-medium ${STATUS_TONE[check.status]}`}>
                      {check.status}
                    </div>
                    <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
                      {check.key}
                    </div>
                  </div>
                  <div>
                    <h3 className="text-base font-medium tracking-tight text-[var(--color-fg)]">
                      {check.title}
                    </h3>
                    <p className="mt-2 text-sm leading-6 text-[var(--color-muted)]">
                      {check.notes}
                    </p>
                    <p className="mt-3 text-sm leading-6 text-[var(--color-fg)]">
                      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-accent)]">
                        fix
                      </span>{' '}
                      — {check.recommendation}
                    </p>
                  </div>
                </article>
              ))}
            </section>

            {report.evidenceUrls.length ? (
              <section className="mt-8 border border-[var(--color-line)] p-5">
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-accent)]">
                  discovered surfaces
                </div>
                <ul className="mt-3 grid gap-2 font-mono text-[11px]">
                  {report.evidenceUrls.map((url) => (
                    <li key={url}>
                      <a
                        className="inline-flex min-h-11 items-center text-[var(--color-muted)] hover:text-[var(--color-accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
                        href={url}
                        rel="noreferrer"
                        target="_blank"
                      >
                        {url}
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            <p className="mt-8 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
              audited {report.finalUrl} at {report.fetchedAt.slice(0, 16).replace('T', ' ')} UTC
            </p>
          </>
        ) : null}

        <section
          className="mt-14 border-t border-[var(--color-line)]"
          aria-label="Understanding the audit"
        >
          {READINESS_SECTIONS.map((section) => (
            <article
              key={section.title}
              className="grid gap-3 border-b border-[var(--color-line)] py-7 md:grid-cols-[minmax(12rem,0.65fr)_minmax(0,1.6fr)] md:gap-10"
            >
              <h2 className="text-lg font-medium tracking-tight text-[var(--color-fg)]">
                {section.title}
              </h2>
              <p className="max-w-[72ch] text-sm leading-7 text-[var(--color-muted)]">
                {section.body}
              </p>
            </article>
          ))}
        </section>

        <footer className="mt-10 border border-[var(--color-line)] p-5">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-accent)]">
            next step
          </p>
          <p className="mt-4 max-w-[72ch] text-sm leading-7 text-[var(--color-muted)]">
            Run the audit on a canonical page, fix the weakest technical primitive, and then re-run
            the full{' '}
            <a
              className="inline-flex min-h-11 items-center text-[var(--color-fg)] hover:text-[var(--color-accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
              href="/agent-eval"
            >
              agent evaluation
            </a>
            .
          </p>
        </footer>
      </PageShell>
    </>
  );
}
