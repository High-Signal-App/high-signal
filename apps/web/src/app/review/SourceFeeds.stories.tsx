import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { useState } from 'react';
import {
  addFeedSourceInputSchema,
  updateFeedSourceInputSchema,
  type FeedSource,
} from '@high-signal/shared';
import SourceFeeds from './SourceFeeds';

const NOW = Math.floor(Date.now() / 1000);
const COLLECTED: FeedSource = {
  id: 'feed-platformer',
  title: 'Platformer',
  url: 'https://www.platformer.news/',
  feedUrl: 'https://www.platformer.news/rss/',
  format: 'rss',
  enabled: true,
  sourceKey: 'news:ml-platformer',
  createdAt: NOW - 3600,
  lastValidatedAt: NOW - 3600,
  lastFetchedAt: NOW - 600,
  lastFetchCount: 2,
  lastFetchError: null,
  lastPublishedAt: NOW - 7200,
};

function exampleRequest(initial: FeedSource[]) {
  let sources = [...initial];
  return async (path: string, init?: RequestInit): Promise<Response> => {
    if (!init?.method || init.method === 'GET') return Response.json({ sources });
    const raw: unknown = typeof init.body === 'string' ? JSON.parse(init.body) : null;
    if (init.method === 'POST') {
      const { url: input } = addFeedSourceInputSchema.parse(raw);
      let url: URL;
      try {
        url = new URL(input.includes('://') ? input : `https://${input}`);
      } catch {
        return Response.json(
          { error: 'invalid_source', message: 'Enter a public website or feed URL.' },
          { status: 400 }
        );
      }
      if (!url.hostname.includes('.') || /^[\d.]+$/.test(url.hostname)) {
        return Response.json(
          {
            error: 'feed_unavailable',
            message: 'Use a public HTTP or HTTPS hostname without credentials.',
          },
          { status: 400 }
        );
      }
      const found = sources.find((source) => new URL(source.url).hostname === url.hostname);
      if (found) return Response.json({ source: found, created: false, articleCount: 20 });
      const source: FeedSource = {
        ...COLLECTED,
        id: `feed-${url.hostname}`,
        title: url.hostname.includes('latent.space') ? 'Latent Space' : url.hostname,
        url: url.href,
        feedUrl: new URL('/feed', url).href,
        lastFetchedAt: null,
        lastFetchCount: null,
        sourceKey: `news:feed-${url.hostname}`,
        lastFetchError: null,
      };
      sources = [source, ...sources];
      return Response.json({ source, created: true, articleCount: 20 }, { status: 201 });
    }
    const { enabled } = updateFeedSourceInputSchema.parse(raw);
    const id = path.split('/').at(-1);
    sources = sources.map((source) => (source.id === id ? { ...source, enabled } : source));
    return Response.json({ source: sources.find((source) => source.id === id) });
  };
}

function Example({ empty = false }: { empty?: boolean }) {
  const [request] = useState(() =>
    exampleRequest(
      empty
        ? []
        : [
            COLLECTED,
            {
              ...COLLECTED,
              id: 'feed-import-ai',
              title: 'Import AI',
              url: 'https://importai.substack.com/',
              feedUrl: 'https://importai.substack.com/feed',
              lastFetchCount: 0,
              lastFetchError: 'Publisher returned HTTP 403',
              sourceKey: 'news:ml-import-ai',
            },
          ]
    )
  );
  return <SourceFeeds request={request} />;
}

const meta = {
  title: 'Operator/Publication sources',
  component: SourceFeeds,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <main className="mx-auto max-w-5xl px-6 py-8">
        <Story />
      </main>
    ),
  ],
} satisfies Meta<typeof SourceFeeds>;
export default meta;
type Story = StoryObj<typeof meta>;
export const CollectionStatus: Story = { render: () => <Example /> };
export const Empty: Story = { render: () => <Example empty /> };
// Uses the same-origin operator API for local end-to-end verification.
export const Connected: Story = { render: () => <SourceFeeds /> };
