'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

function scheduleAfterFirstPaint(task: () => void) {
  if (typeof window.requestIdleCallback === 'function') {
    const handle = window.requestIdleCallback(task, { timeout: 3_000 });
    return () => window.cancelIdleCallback(handle);
  }

  const handle = window.setTimeout(task, 1_500);
  return () => window.clearTimeout(handle);
}

export function AnalyticsProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  useEffect(() => {
    let disposed = false;
    let removeMonitoring: (() => void) | undefined;
    const cancel = scheduleAfterFirstPaint(() => {
      void import('@/lib/foundry-monitoring').then(({ installBrowserMonitoring }) => {
        if (disposed) return;
        removeMonitoring = installBrowserMonitoring();
      });
    });

    return () => {
      disposed = true;
      cancel();
      removeMonitoring?.();
    };
  }, []);

  useEffect(() => {
    const cancel = scheduleAfterFirstPaint(() => {
      void import('@/lib/analytics').then(({ trackPageView }) => trackPageView());
    });
    return cancel;
  }, [pathname]);

  return children;
}
