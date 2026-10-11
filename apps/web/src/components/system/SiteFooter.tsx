import { createElement } from 'react';
import { defaultStudio, renderStudioFooterHtml } from '@saas-maker/ui/footer-html';
import { APP_HEALTH_LIVE_URL } from '@/lib/app-health-public';

export function SiteFooter() {
  return createElement('studio-footer', {
    'data-theme': 'ink',
    'data-mode': 'dark',
    dangerouslySetInnerHTML: {
      __html: renderStudioFooterHtml({
        product: 'High Signal',
        url: 'https://highsignal.app',
        catalogId: 'high-signal',
        capture: 'newsletter',
        variant: 'studio',
        studio: [
          {
            id: 'on-record',
            label: 'high signal podcasts',
            href: 'https://podcasts.highsignal.app',
          },
          ...defaultStudio.filter(
            (link) =>
              link.id !== 'on-record' &&
              link.id !== 'high-signal' &&
              link.href.replace(/\/$/, '') !== 'https://podcasts.highsignal.app'
          ),
        ].slice(0, 4),
        summary:
          'One free, public Daily Brief across technology, startups, and finance. Read the change, inspect its proof, then check the outcome.',
        privacyUrl: 'https://highsignal.app/privacy',
        art: {
          src: '/footer-art/high-signal.webp',
          alt: 'A signal-watch desk centers one daily sheet whose physical source ribbons remain visible. Scattered public-source slips pass through a narrow sorting aperture; a restrained tuning instrument and loose paper occupy the wings.',
          width: 2171,
          height: 724,
          position: '50% 50%',
          credit: 'Original illustration for High Signal',
        },
        groups: [
          {
            title: 'read',
            links: [
              { label: 'brief', href: '/' },
              { label: 'signals', href: '/signals' },
              { label: 'track record', href: '/track-record' },
              { label: 'articles', href: '/articles' },
              { label: 'podcasts', href: 'https://podcasts.highsignal.app/' },
            ],
          },
          {
            title: 'verify',
            links: [
              { label: 'sources', href: '/data' },
              { label: 'methodology', href: '/methodology' },
              { label: 'editorial policy', href: '/editorial-policy' },
            ],
          },
          {
            title: 'project',
            links: [
              { label: 'about', href: '/about' },
              { label: 'api & feeds', href: '/api-docs' },
              { label: 'privacy', href: '/privacy' },
              { label: 'terms', href: '/terms' },
              { label: 'live analytics', href: APP_HEALTH_LIVE_URL },
              { label: 'github', href: 'https://github.com/High-Signal-App/high-signal' },
              { label: 'signals rss', href: 'https://highsignal.app/signals/rss' },
            ],
          },
        ],
      }),
    },
  });
}
