import { SiteHeader } from '@saas-maker/ui/blocks/site-header';

export function ReaderHeader() {
  return (
    <SiteHeader
      variant="bar"
      className="bg-background border-border backdrop-blur-none"
      brand={{ name: 'high signal', mark: <span className="size-1.5 rounded-full bg-brand" /> }}
      links={[
        { label: 'brief', href: '/' },
        { label: 'signals', href: '/signals' },
        { label: 'track record', href: '/track-record' },
        { label: 'podcasts', href: 'https://podcasts.highsignal.app/' },
      ]}
    />
  );
}
