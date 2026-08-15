'use client';

import posthog from 'posthog-js';
import { PostHogProvider } from 'posthog-js/react';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

import { installBrowserMonitoring } from '@/lib/foundry-monitoring';
import { trackPageView } from '@/lib/analytics';

export function AnalyticsProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  useEffect(() => {
    return installBrowserMonitoring();
  }, []);

  useEffect(() => {
    trackPageView();
  }, [pathname]);

  return <PostHogProvider client={posthog}>{children}</PostHogProvider>;
}
