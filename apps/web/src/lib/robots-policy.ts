import type { MetadataRoute } from 'next';

import { SITE_URL } from '@/lib/site';

const PUBLIC_ALLOW = [
  '/',
  '/brief',
  '/signals',
  '/data',
  '/case-studies',
  '/markets',
  '/markets/history',
  '/entities',
  '/sectors',
  '/track-record',
  '/about',
  '/privacy',
  '/terms',
  '/api-docs',
  '/embed',
  '/llms.txt',
  '/llms-full.txt',
  '/index.md',
  '/api/ai',
  '/api/md',
  '/ai.txt',
  '/openapi.json',
  '/.well-known/',
];

const PRIVATE_DISALLOW = [
  '/review',
  '/admin',
  '/communities',
  '/personal',
  '/api/',
  '/backtest-workbench',
  '/_private',
  '/brief/archive',
  '/*.json',
];

const AI_CRAWLERS = [
  'OAI-SearchBot',
  'ChatGPT-User',
  'Claude-SearchBot',
  'Claude-User',
  'PerplexityBot',
  'Perplexity-User',
  'GPTBot',
  'ClaudeBot',
  'Google-Extended',
  'Applebot-Extended',
  'CCBot',
  'Bytespider',
  'anthropic-ai',
  'Amazonbot',
];

/**
 * Crawler policy.
 *
 * High Signal is fully public: allow every reader-facing surface, including
 * the hit-rate ledger at /track-record (the moat — being indexed is the entire
 * point). Disallow only operator machinery: the admin login and API proxy, the
 * review queue, the backtest workbench, and the operator command brief.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: PUBLIC_ALLOW,
        disallow: PRIVATE_DISALLOW,
      },
      {
        userAgent: AI_CRAWLERS,
        allow: PUBLIC_ALLOW,
        disallow: PRIVATE_DISALLOW,
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
