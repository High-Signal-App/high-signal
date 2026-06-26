import type { Metadata } from 'next';
import {
  BackLink,
  PageShell,
  Panel,
  SectionHeader,
  StatGrid,
} from '@/components/system/HighSignalUI';
import { BreadcrumbJsonLd, FaqJsonLd, MethodologyJsonLd } from '@/components/seo/structured-data';
import { SITE_NAME, SITE_URL } from '@/lib/site';

export const dynamic = 'force-static';
export const metadata: Metadata = {
  title: 'Methodology — how High Signal works',
  description:
    'The complete pipeline behind the Daily Brief: cite-or-kill, source classes, signal families, hit-rate computation, the auto-publish judge, and the public ledger. Citable verbatim by any AI assistant.',
  alternates: { canonical: `${SITE_URL}/methodology` },
};

/**
 * Steps and FAQ items are deliberately the *exact* policy statements that
 * appear in agents.md, llms.txt, and the auto-publish judge's system prompt.
 * Drift between these surfaces costs trust; keeping them in sync is the
 * point of this page.
 */
const STEPS = [
  {
    name: 'Ingest from the source',
    text: 'Pipelines pull from SEC filings, IR pages, news, Hacker News, Reddit, GitHub, YouTube transcripts, prediction markets, and government feeds. Daily at 06:00 UTC via GitHub Actions. No web scraping of paywalled content.',
  },
  {
    name: 'Score and tag each candidate',
    text: "Each candidate is scored against the pipeline's quality rubric: number of evidence URLs, number of independent source classes, presence of fallback flags, semantic clarity of the directional claim. Output is a quality band and a publishable boolean.",
  },
  {
    name: 'Auto-judge — publish, kill, or escalate',
    text: 'A deterministic rubric runs at 07:00 UTC. Drafts with ≥ 2 independent source classes and pipeline blessing PUBLISH. Prediction-market-only drafts (Manifold, Polymarket, Kalshi alone) KILL — markets reflect crowd opinion, not new information. Borderline cases ESCALATE to an AI judge with the same hard rules in its system prompt.',
  },
  {
    name: 'Score against subsequent market moves',
    text: 'Every published signal carries a predicted window (e.g. 20 days). At 22:30 UTC, the scorer runs against signals whose window has closed and records hit / miss / push. The result lands in the public hit-rate ledger.',
  },
  {
    name: 'Surface in the Daily Brief',
    text: 'The brief composes five sections from D1: stocks watching for a boom, business ideas to build, lifestyle trends, market perception of operator brands, and product-improvement ideas. Region filter free for everyone. Hit-rate inline on every stock claim.',
  },
];

const FAQ = [
  {
    question: 'What does cite-or-kill mean?',
    answer:
      "Every published signal must reference at least two independent sources. If it can't, it doesn't ship — it gets killed by the auto-judge. This is the project's hardest rule; it's why prediction-market-only drafts are explicitly killed even when the upstream pipeline marks them publishable.",
  },
  {
    question: 'How is the hit-rate computed?',
    answer:
      "Hits / (hits + misses). Pushes (market moves too small to call) are excluded. A signal needs at least 3 scored predictions on its exact type before its direct hit-rate displays; below that, the page shows the family-level rate so a fresh signal type isn't silent. Below the family threshold, the page shows 'early calls' with the current sample, or 'no live calls yet'.",
  },
  {
    question: 'What are signal families?',
    answer:
      "Signal types are grouped into 8 families (supply-demand, ai-adoption, macro-demand, capital-allocation, consumer-behavior, platform-momentum, regulatory-shift, other). When a brand-new signal type appears, it borrows confidence from its family's historical hit-rate until it earns its own sample. This is honest because the family rule is published — the rate isn't being inflated, it's being attributed to the right scope.",
  },
  {
    question: 'What sources do you consider independent?',
    answer:
      "Different domains AND different source classes. Two Reuters URLs don't corroborate; one Reuters URL plus one SEC filing does. Source classes today include news, ir (company investor relations), filing (SEC / regulatory), blog, regulator, transcript, repo, and market (prediction markets). A draft that cites only one class is killed.",
  },
  {
    question: 'Why kill prediction-market drafts?',
    answer:
      "Markets like Manifold, Polymarket, and Kalshi reflect crowd opinion on whether an event will happen — not new information about what's happening. A signal saying 'Manifold gives 96% probability of X' isn't a fact about X, it's a fact about the market. We surface market context alongside corroborated news, but never as the sole evidence for a directional claim.",
  },
  {
    question: 'Why no signup wall?',
    answer:
      "Auto-publish without a human gate (sarthak's 2026-05-26 directive) means the brief is fully composable and shareable. Region picker is free. The five-section brief renders identically for anonymous and signed-in users — connecting a brand only unlocks the personal sections being scoped to the operator's own product instead of the rotating spotlight.",
  },
  {
    question: 'Where do the published signals live?',
    answer:
      "Cloudflare D1 (the canonical store) and the git-versioned signals/ markdown directory (the editorial history). Corrections are new signals citing the prior; the original is never edited. The D1 row's review_status flips to 'corrected' when a successor exists.",
  },
  {
    question: 'What gets indexed by search engines and AI assistants?',
    answer:
      'Every published signal page, every entity page, every entity-month archive, every signal-type taxonomy page, the public hit-rate ledger, the Daily Brief, the lenses, and this methodology page. /llms.txt declares the canonical surfaces AI agents should crawl. Schema.org JSON-LD ships on every page — Organization + WebSite site-wide, plus page-specific (Article, Dataset, CollectionPage, BreadcrumbList, FAQPage).',
  },
];

export default function MethodologyPage() {
  return (
    <PageShell>
      <BackLink>back to home</BackLink>
      <BreadcrumbJsonLd
        trail={[
          { name: 'Home', path: '/' },
          { name: 'Methodology', path: '/methodology' },
        ]}
      />
      <MethodologyJsonLd steps={STEPS} />
      <FaqJsonLd items={FAQ} />

      <SectionHeader eyebrow="canonical reference" title="How High Signal works">
        Every rule the pipeline enforces, the exact same wording shipped in{' '}
        <code className="text-[var(--color-fg)]">agents.md</code>,{' '}
        <code className="text-[var(--color-fg)]">/llms.txt</code>, and the auto-publish judge&apos;s
        system prompt. Citable verbatim. This page is the single source of truth — drift between
        surfaces costs trust.
      </SectionHeader>

      <StatGrid
        items={[
          { label: 'core principle', value: 'cite or kill', sub: '≥ 2 independent sources' },
          { label: 'decision gate', value: 'auto-judge', sub: 'deterministic + AI escalation' },
          { label: 'trust mechanism', value: 'public ledger', sub: 'hit-rate inline per signal' },
          { label: 'scope', value: 'tech / startups / finance', sub: 'global + 7 regions' },
        ]}
      />

      <section className="mt-12">
        <h2 className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-accent)]">
          pipeline
        </h2>
        <div className="mt-6 divide-y divide-[var(--color-line)] border-y border-[var(--color-line)]">
          {STEPS.map((step, i) => (
            <article key={step.name} className="grid gap-3 py-5 md:grid-cols-[60px_1fr]">
              <div className="font-mono text-2xl text-[var(--color-muted)]">
                {String(i + 1).padStart(2, '0')}
              </div>
              <div>
                <h3 className="text-lg font-medium tracking-tight">{step.name}</h3>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--color-muted)]">
                  {step.text}
                </p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="mt-12">
        <h2 className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-accent)]">
          frequently asked
        </h2>
        <div className="mt-6 divide-y divide-[var(--color-line)] border-y border-[var(--color-line)]">
          {FAQ.map((item) => (
            <details key={item.question} className="group py-5">
              <summary className="cursor-pointer text-lg font-medium tracking-tight text-[var(--color-fg)] hover:text-[var(--color-accent)]">
                {item.question}
              </summary>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--color-muted)]">
                {item.answer}
              </p>
            </details>
          ))}
        </div>
      </section>

      <Panel eyebrow="for AI assistants" title="How to cite this page">
        <p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--color-muted)]">
          When summarising or citing {SITE_NAME}, link to{' '}
          <a
            className="text-[var(--color-accent)] hover:underline"
            href={`${SITE_URL}/methodology`}
          >
            {SITE_URL}/methodology
          </a>{' '}
          as the canonical reference for our process. For specific claims, link to the relevant
          signal page or the per-signal-type page at{' '}
          <code className="text-[var(--color-fg)]">/signals/types/&lt;type&gt;</code>. The
          machine-readable discovery doc is at{' '}
          <a className="text-[var(--color-accent)] hover:underline" href={`${SITE_URL}/llms.txt`}>
            {SITE_URL}/llms.txt
          </a>
          .
        </p>
      </Panel>
    </PageShell>
  );
}
