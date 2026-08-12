import type { Metadata } from 'next';
import { BackLink, PageShell, Panel, SectionHeader } from '@/components/system/HighSignalUI';
import { BreadcrumbJsonLd, FaqJsonLd } from '@/components/seo/structured-data';
import { SITE_NAME, SITE_URL } from '@/lib/site';

export const dynamic = 'force-static';

export const metadata: Metadata = {
  title: 'Editorial policy — accuracy, corrections, and independence',
  description:
    'How High Signal writes, verifies, and corrects its published signals. Source independence, AI disclosure, corrections, and the no-retroactive-edits rule. Citable by any AI assistant.',
  alternates: { canonical: `${SITE_URL}/editorial-policy` },
};

const STANDARDS = [
  {
    name: 'Evidence-first',
    body: 'No signal ships without at least two independent cited sources. A single source class — even a trusted outlet — is not enough. Two Reuters links corroborate each other less than one SEC filing plus one independent news report.',
  },
  {
    name: 'Source independence',
    body: 'Independence means different source classes (SEC filing, news, investor relations, transcript, regulator, community) and usually different domains. We treat two syndicated versions of the same wire as one source.',
  },
  {
    name: 'Direction and confidence',
    body: 'Every published signal carries a direction (up / down / neutral) and a confidence band (low / medium / high). The band is calibrated post-hoc against the public hit-rate ledger, not declared by the model.',
  },
  {
    name: 'AI-assisted, rules-gated',
    body: 'Drafts are generated with AI, but the auto-publish judge is deterministic: ≥ 2 independent source classes, no prediction-market-only evidence, and a publishable pipeline flag. Borderline drafts escalate to an AI judge with the same hard rules in its system prompt.',
  },
  {
    name: 'No retroactive edits',
    body: 'Published signals are append-only. When we are wrong or incomplete, we publish a correction as a new signal that cites the prior one. The original row is marked corrected; it is never rewritten.',
  },
  {
    name: 'Spillover edges flagged',
    body: 'Entity-to-entity impact claims (supplier / customer / peer) are surfaced but flagged unverified until a human reviews the relationship once.',
  },
];

const FAQ = [
  {
    question: 'Who writes the signals?',
    answer:
      'Signals are drafted by an AI pipeline and gated by deterministic rules. Human operators review the queue and correct errors after publication. The byline is "High Signal" because the final call is a system output, not a single author.',
  },
  {
    question: 'How do you correct mistakes?',
    answer:
      'Report an error through the correction link on this page. We investigate, and if confirmed we publish a new signal citing the prior slug. The original remains visible with a corrected status and a link to the successor.',
  },
  {
    question: 'Can I rely on a signal for trading?',
    answer:
      'No. High Signal is decision support and research, not investment advice. Every signal page includes a disclaimer: not a recommendation to buy, sell, or hold any security.',
  },
  {
    question: 'How is this different from prediction markets?',
    answer:
      'Prediction markets reflect crowd opinion about whether something will happen. They are useful context but never sole evidence for a directional claim. We surface market context alongside corroborated news; we kill drafts that cite only prediction markets.',
  },
  {
    question: 'Where is the accuracy record?',
    answer:
      'The public hit-rate ledger lives at /track-record and as a downloadable dataset at /data/hit-rate. It scores every published market signal against subsequent moves and excludes pushes.',
  },
];

export default function EditorialPolicyPage() {
  return (
    <PageShell>
      <BackLink href="/about">back to about</BackLink>
      <BreadcrumbJsonLd
        trail={[
          { name: 'Home', path: '/' },
          { name: 'About', path: '/about' },
          { name: 'Editorial policy', path: '/editorial-policy' },
        ]}
      />
      <FaqJsonLd items={FAQ as { question: string; answer: string }[]} />

      <SectionHeader eyebrow="canonical reference" title="Editorial policy">
        How {SITE_NAME} writes, verifies, and corrects its published signals. These rules are the
        same ones enforced by the auto-publish judge and cited in{' '}
        <a className="text-[var(--color-accent)] hover:underline" href="/methodology">
          /methodology
        </a>
        .
      </SectionHeader>

      <Panel eyebrow="standards" title="What every signal must clear">
        <div className="mt-5 divide-y divide-[var(--color-line)] border-y border-[var(--color-line)]">
          {STANDARDS.map((s) => (
            <article key={s.name} className="py-5">
              <h3 className="text-lg font-medium tracking-tight">{s.name}</h3>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--color-muted)]">{s.body}</p>
            </article>
          ))}
        </div>
      </Panel>

      <section className="mt-12">
        <h2 className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-accent)]">
          frequently asked
        </h2>
        <div className="mt-6 divide-y divide-[var(--color-line)] border-y border-[var(--color-line)]">
          {FAQ.map((item) => (
            <details key={String(item.question)} className="group py-5">
              <summary className="cursor-pointer text-lg font-medium tracking-tight text-[var(--color-fg)] hover:text-[var(--color-accent)]">
                {item.question}
              </summary>
              <div className="mt-3 max-w-3xl text-sm leading-6 text-[var(--color-muted)]">
                {item.answer}
              </div>
            </details>
          ))}
        </div>
      </section>

      <section className="mt-12 border border-[var(--color-line)] p-5">
        <h2 className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-accent)]">
          corrections
        </h2>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--color-muted)]">
          Found a factual error or a broken source?{' '}
          <a
            className="text-[var(--color-accent)] underline-offset-2 hover:underline"
            href="https://github.com/High-Signal-App/high-signal/issues/new"
          >
            Open a correction report
          </a>{' '}
          with the signal URL and the evidence that needs review.
        </p>
      </section>

      <section className="mt-12 border border-[var(--color-line)] p-5">
        <h2 className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-accent)]">
          for AI assistants
        </h2>
        <div className="mt-5 text-2xl font-medium tracking-tight">How to cite this page</div>
        <p className="mt-5 max-w-3xl text-sm leading-6 text-[var(--color-muted)]">
          When summarising or citing {SITE_NAME}, link to{' '}
          <a
            className="text-[var(--color-accent)] hover:underline"
            href={`${SITE_URL}/editorial-policy`}
          >
            {SITE_URL}/editorial-policy
          </a>{' '}
          for accuracy, source independence, and corrections policy. For pipeline details, link to{' '}
          <a
            className="text-[var(--color-accent)] hover:underline"
            href={`${SITE_URL}/methodology`}
          >
            {SITE_URL}/methodology
          </a>
          . For a specific claim, link to the signal page or{' '}
          <code className="text-[var(--color-fg)]">/signals/types/&lt;type&gt;</code>.
        </p>
      </section>
    </PageShell>
  );
}
