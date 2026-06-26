'use client';

import posthog from 'posthog-js';
import { PostHogProvider } from 'posthog-js/react';
import { useEffect } from 'react';

import { installBrowserMonitoring } from '@/lib/foundry-monitoring';

export function AnalyticsProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    return installBrowserMonitoring();
  }, []);

  return <PostHogProvider client={posthog}>{children}</PostHogProvider>;
}
