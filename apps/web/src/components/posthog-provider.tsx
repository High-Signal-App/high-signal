'use client';

import { PostHogProvider } from '@saas-maker/posthog-client';
import { useEffect } from 'react';

import { installBrowserMonitoring } from '@/lib/foundry-monitoring';

export function AnalyticsProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    return installBrowserMonitoring();
  }, []);

  return <PostHogProvider>{children}</PostHogProvider>;
}
