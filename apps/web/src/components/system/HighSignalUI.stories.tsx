import type { Meta, StoryObj } from '@storybook/nextjs';
import {
  BackLink,
  CommandButton,
  FeedList,
  Field,
  HeroHeader,
  MetricGrid,
  PageShell,
  Panel,
  ProductAreaGrid,
  RouteList,
  SectionHeader,
  StatGrid,
} from './HighSignalUI';

const meta = {
  title: 'Design System/High Signal UI',
  parameters: {
    docs: {
      description: {
        component:
          'Core layout primitives for the High Signal product family. These components define the shared visual language for Mentions, Communities, and Markets.',
      },
    },
  },
  tags: ['autodocs'],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const ProductShell: Story = {
  render: () => (
    <PageShell>
      <HeroHeader eyebrow="v0 / signal intelligence" title="High Signal">
        Extract actionable signals from noisy public and semi-public information streams.
      </HeroHeader>
      <ProductAreaGrid
        items={[
          {
            href: '/mentions',
            title: 'Mention Intelligence',
            kicker: 'company',
            body: 'Brand, competitor, AI visibility, citation, and share-of-voice signals.',
          },
          {
            href: '/communities',
            title: 'Community Intelligence',
            kicker: 'subreddit',
            body: 'Community pain, demand, narrative, and product-opportunity signals.',
          },
          {
            href: '/markets',
            title: 'Market Intelligence',
            kicker: 'entity graph',
            body: 'Evidence-backed company and sector signals with confidence and hit-rate tracking.',
          },
        ]}
      />
      <RouteList
        items={[
          { href: '/signals', title: 'signal feed', sub: 'unified stream' },
          { href: '/review', title: 'review queue', sub: 'human approval' },
          { href: '/track-record', title: 'track record', sub: 'market signals' },
        ]}
      />
    </PageShell>
  ),
};

export const SubProductPage: Story = {
  render: () => (
    <PageShell>
      <BackLink />
      <SectionHeader eyebrow="community signal layer" title="Community Intelligence">
        Subreddit and forum signals for pain, demand, narrative shifts, product opportunities, and
        competitor mentions.
      </SectionHeader>
      <StatGrid
        items={[
          { label: 'Source repo', value: 'agentMode', sub: 'Reddit fetcher + snapshots' },
          { label: 'Primary object', value: 'community', sub: 'subreddits, prompts, digests' },
          { label: 'First migration', value: 'tracked subreddits', sub: 'source-linked summaries' },
        ]}
      />
    </PageShell>
  ),
};

export const WorkSurface: Story = {
  render: () => (
    <PageShell>
      <BackLink />
      <SectionHeader eyebrow="company signal layer" title="Mention Intelligence">
        Compact operational surface for premium product workflows.
      </SectionHeader>
      <section className="mt-10 grid gap-8 md:grid-cols-[0.9fr_1.1fr]">
        <Panel eyebrow="visibility analyzer">
          <form>
            <Field label="Brand" name="brand" defaultValue="High Signal" />
            <Field label="Brand URL" name="url" defaultValue="https://highsignalsuite.com" />
            <Field
              label="Model response"
              name="text"
              defaultValue="1. High Signal is a reliable system for extracting market and community signals."
              multiline
            />
            <CommandButton>analyze</CommandButton>
          </form>
        </Panel>
        <Panel eyebrow="analysis result">
          <MetricGrid
            items={[
              { label: 'mentioned', value: 'yes' },
              { label: 'sentiment', value: 'positive' },
              { label: 'position', value: '1' },
              { label: 'cited', value: 'yes' },
            ]}
          />
        </Panel>
      </section>
      <FeedList
        eyebrow="source-linked feed"
        empty="No sources found."
        items={[
          {
            href: 'https://reddit.com',
            kicker: 'r/LocalLLaMA / post / score 128',
            title: 'Teams are looking for better AI visibility monitoring',
            body: 'Discussion indicates demand for source-linked recommendations rather than dashboards.',
          },
        ]}
      />
    </PageShell>
  ),
};

export const DashboardSurface: Story = {
  render: () => (
    <PageShell>
      <BackLink />
      <SectionHeader eyebrow="premium command surface" title="Signal Dashboard">
        Unified workspace for company, community, and market signal workflows.
      </SectionHeader>
      <MetricGrid
        items={[
          { label: 'brand', value: 'High Signal' },
          { label: 'platforms', value: '3' },
          { label: 'communities', value: '2' },
          { label: 'markets', value: 'live' },
        ]}
      />
      <section className="mt-10 grid gap-8 md:grid-cols-2">
        <Panel eyebrow="mention intelligence" title="High Signal">
          <p className="mt-3 text-sm leading-6 text-[var(--color-muted)]">
            Track AI visibility, citations, competitor mentions, and prompt-level response quality.
          </p>
        </Panel>
        <Panel eyebrow="community intelligence" title="Tracked subreddits">
          <a
            className="mt-5 block border-y border-[var(--color-line)] py-4 hover:text-[var(--color-accent)]"
            href="/communities?subreddit=LocalLLaMA"
          >
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
              r/LocalLLaMA / week
            </div>
            <p className="mt-2 text-sm leading-6 text-[var(--color-muted)]">
              Source-linked digest workflow from Agent Mode.
            </p>
          </a>
        </Panel>
      </section>
    </PageShell>
  ),
};
