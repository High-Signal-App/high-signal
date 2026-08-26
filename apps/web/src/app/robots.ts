import type { MetadataRoute } from 'next';

import { SITE_URL } from '@/lib/site';

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
        allow: [
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
        ],
        disallow: [
          '/review',
          '/admin',
          '/communities',
          '/personal',
          '/api/',
          '/backtest-workbench',
          '/data/',
          '/*.json',
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
