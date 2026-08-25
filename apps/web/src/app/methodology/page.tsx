import type { Metadata } from 'next';
import Link from 'next/link';
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
    text: 'Pipelines pull from SEC filings, IR pages, news, Hacker News, Reddit, GitHub, YouTube transcripts, prediction markets, and government feeds. Daily at 08:00 IST via GitHub Actions. No web scraping of paywalled content.',
  },
  {
    name: 'Score and tag each candidate',
    text: "Each candidate is scored against the pipeline's quality rubric and converted into a structured assertion. Supporting links must be semantically aligned, retained as source receipts, and assigned explicit primary, corroboration, context, or contradiction roles.",
  },
  {
    name: 'Auto-judge — publish, kill, or escalate',
    text: 'A mandatory publishability gate runs at 09:00 IST. A structured claim needs one aligned primary source and independently originating aligned corroboration on the same normalized claim tuple. Context does not count, contradiction blocks, and unusable receipts fail closed. Prediction-market-only and future-dated drafts KILL. Ambiguous alignment may escalate to the configured AI judge; unavailable judging still fails closed.',
  },
  {
    name: 'Score against subsequent market moves',
    text: 'Every published signal carries a predicted window (e.g. 20 days). At 22:30 UTC, the scorer runs against signals whose window has closed and records hit / miss / push. The result lands in the public hit-rate ledger.',
  },
  {
    name: 'Surface in the Daily Brief',
    text: 'The public brief composes three categories from retained evidence: Markets & companies, Business opportunities, and Behavior & culture. It has no target item count and inserts no seed fallback. Each market item states what changed, why it matters, and what remains uncertain; only reliable direct hit-rate history appears inline.',
  },
  {
    name: 'Gate the permanent edition',
    text: 'Before a dated snapshot is written, the edition gate verifies category states, editorial sentence integrity, supporting evidence roles, usable links, and the absence of synthetic markers. Valid partial editions may archive with explicit empty categories; unavailable infrastructure leaves the prior snapshot unchanged.',
  },
  {
    name: 'Correct with a successor, never rewrite',
    text: 'Published signals are append-only. Errors are fixed by publishing a new signal that cites the prior slug; the original row flips to corrected. This preserves the public ledger and the hit-rate history.',
  },
];

const FAQ = [
  {
    question: 'What does cite-or-kill mean?',
    answer:
      'Every published claim needs a semantically aligned primary source and independent aligned corroboration attached to the same assertion. Context links do not count as support, unresolved contradiction blocks publication, and required evidence without a retained receipt fails closed.',
  },
  {
    question: 'How is the hit-rate computed?',
    answer:
      'Hits / (hits + misses). Pushes (market moves too small to call) are excluded. A signal needs at least 3 scored predictions on its exact type before its direct hit-rate displays. Smaller direct samples are labeled early; generic family percentages remain available for internal calibration but are withheld from the public brief.',
  },
  {
    question: 'What are signal families?',
    answer:
      'Signal types are grouped into 8 families (supply-demand, ai-adoption, macro-demand, capital-allocation, consumer-behavior, platform-momentum, regulatory-shift, other). Families help internal calibration and sparse-sample analysis, but a family percentage is not presented as the public track record of a new exact signal type.',
  },
  {
    question: 'What sources do you consider independent?',
    answer:
      'The supporting links must come from different hosts or qualifying source classes and support the same assertion in different roles. Two links from one host are not independent, two primary links do not replace corroboration, and entity-adjacent context never becomes support merely because it was attached to the draft.',
  },
  {
    question: 'Why kill prediction-market drafts?',
    answer:
      "Markets like Manifold, Polymarket, and Kalshi reflect crowd opinion on whether an event will happen — not new information about what's happening. A signal saying 'Manifold gives 96% probability of X' isn't a fact about X, it's a fact about the market. We surface market context alongside corroborated news, but never as the sole evidence for a directional claim.",
  },
  {
    question: 'Why no signup wall?',
    answer:
      'The Daily Brief is a public, shareable record. Its three categories render identically for anonymous and signed-in visitors, the region picker is free, and no rotating product spotlight or public personalization changes the edition. Connected-brand work stays in Mentions and Agent Eval.',
  },
  {
    question: 'Where do the published signals live?',
    answer:
      "Cloudflare D1 (the canonical store) and the git-versioned signals/ markdown directory (the editorial history). Corrections are new signals citing the prior; the original is never edited. The D1 row's review_status flips to 'corrected' when a successor exists.",
  },
  {
    question: 'Where can I see the accuracy record?',
    answer:
      'The public hit-rate ledger is at /track-record and available as a downloadable dataset at /data/hit-rate (JSON and CSV). Live predictions are forward calls; backfill is historical replay for calibration only.',
  },
  {
    question: 'What is the editorial policy on corrections?',
    answer:
      'We do not retroactively edit published signals. A correction is a new signal that cites the prior slug. Readers can compare the original claim, the correction, and the scoring outcome in the public ledger.',
  },
  {
    question: 'What gets indexed by search engines and AI assistants?',
    answer:
      'Every published signal page, every evidence-qualified entity page, every qualified entity-month archive, every signal-type taxonomy page, the public hit-rate ledger, the Daily Brief, the lenses, and this methodology page. Thin entity pages remain withheld until their evidence improves. /llms.txt declares the canonical surfaces AI agents should crawl. Schema.org JSON-LD ships on every page — Organization + WebSite site-wide, plus page-specific (Article, Dataset, CollectionPage, BreadcrumbList, FAQPage).',
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
          { label: 'core principle', value: 'cite or kill', sub: 'primary + corroboration' },
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
          for the pipeline and{' '}
          <Link className="text-[var(--color-accent)] hover:underline" href="/editorial-policy">
            /editorial-policy
          </Link>{' '}
          for accuracy, source independence, and corrections. For specific claims, link to the
          relevant signal page or the per-signal-type page at{' '}
          <code className="text-[var(--color-fg)]">/signals/types/&lt;type&gt;</code>. The
          downloadable accuracy ledger is at{' '}
          <Link className="text-[var(--color-accent)] hover:underline" href="/data/hit-rate">
            /data/hit-rate
          </Link>
          , and the machine-readable discovery doc is at{' '}
          <a className="text-[var(--color-accent)] hover:underline" href={`${SITE_URL}/llms.txt`}>
            {SITE_URL}/llms.txt
          </a>
          .
        </p>
      </Panel>
    </PageShell>
  );
}
