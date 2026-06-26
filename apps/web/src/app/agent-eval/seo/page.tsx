import {
  BackLink,
  CommandButton,
  Field,
  PageShell,
  Panel,
  SectionHeader,
  StatGrid,
} from '@/components/system/HighSignalUI';
import { api, type SeoAuditReport } from '@/lib/api';
import { SITE_URL } from '@/lib/site';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'SEO + GEO audit',
  description:
    'Live SEO + GEO audit for any URL. Grades canonical, OG, Twitter, Schema.org JSON-LD, llms.txt, robots, sitemap, RSS — the technical primitives that decide whether you surface in Google + Bing AND in ChatGPT / Claude / Perplexity / Gemini.',
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

const DEFAULT_URL = SITE_URL; // eat our own dog food — audit ourselves by default.

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

  return (
    <PageShell>
      <BackLink href="/agent-eval">back to agent eval</BackLink>
      <SectionHeader
        eyebrow="seo + geo audit"
        title="Is your site legible to humans AND citable by agents?"
      >
        Live grade of the technical primitives that decide whether you appear in Google + Bing (SEO)
        and whether ChatGPT, Claude, Perplexity, and Gemini can extract structured facts about you
        (GEO). Defaults to <code className="text-[var(--color-fg)]">highsignal.app</code> so you can
        watch us eat our own dog food.
      </SectionHeader>

      <form className="mt-8 grid gap-3 border-y border-[var(--color-line)] py-4 md:grid-cols-[1fr_auto]">
        <Field label="URL to audit" name="url" defaultValue={targetUrl} />
        <div className="md:self-end">
          <CommandButton>run audit</CommandButton>
        </div>
      </form>

      {error ? (
        <Panel eyebrow="audit error" title={error}>
          <p className="mt-3 text-sm leading-6 text-[var(--color-muted)]">
            The auditor couldn&apos;t complete a clean fetch. Common causes: site blocks non-browser
            user agents, HTTP/2 negotiation failed, or the path returned a non-2xx.
          </p>
        </Panel>
      ) : null}

      {report && !error ? (
        <>
          <StatGrid
            items={[
              {
                label: 'overall',
                value: `${report.score}/100`,
                sub: `band: ${report.band}`,
              },
              {
                label: 'seo axis',
                value: `${report.seoScore}/100`,
                sub: 'indexed by google + bing',
              },
              {
                label: 'geo axis',
                value: `${report.geoScore}/100`,
                sub: 'citable by ai assistants',
              },
              {
                label: 'checks',
                value: report.checks.length.toString(),
                sub: `${report.checks.filter((c) => c.status === 'strong').length} strong`,
              },
            ]}
          />

          <section className="mt-10 border-t border-[var(--color-line)]">
            {report.checks.map((check) => (
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
                  <p className="mt-2 text-sm leading-6 text-[var(--color-muted)]">{check.notes}</p>
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
                      className="text-[var(--color-muted)] hover:text-[var(--color-accent)]"
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
    </PageShell>
  );
}
