'use client';

import { usePathname } from 'next/navigation';
import { classifyUserAgent } from '@high-signal/shared';
import { useEffect } from 'react';
import { APP_HEALTH_PUBLIC_KEY } from '@/lib/app-health-public';
import {
  browserTracker,
  flushPendingAppHealthEvents,
  readingAction,
  isPublicAnalyticsPath,
  trackAppHealthEvent,
} from '@/lib/app-health-browser';

let activeScript: HTMLScriptElement | undefined;

export function AppHealthAnalytics() {
  const pathname = usePathname();
  const publicPage = isPublicAnalyticsPath(pathname);
  useEffect(() => {
    // UA matches are claims, not verification. Server-side summaries account
    // for these separately; JS-capable unknown automation can still be present.
    if (!publicPage || classifyUserAgent(navigator.userAgent) !== 'unknown') return;
    let disposed = false;
    // This guard is installed underneath the tracker's history wrapper so a
    // transition to private tools stops capture before the tracker sees it.
    const originalPush = history.pushState;
    const originalReplace = history.replaceState;
    const guard = (url: string | URL | null | undefined) => {
      if (url != null && !isPublicAnalyticsPath(new URL(url, location.href).pathname)) {
        browserTracker()?.stop();
      }
    };
    const push: History['pushState'] = function (this: History, data, unused, url) {
      guard(url);
      originalPush.call(this, data, unused, url);
    };
    const replace: History['replaceState'] = function (this: History, data, unused, url) {
      guard(url);
      originalReplace.call(this, data, unused, url);
    };
    history.pushState = push;
    history.replaceState = replace;
    const pop = () => guard(location.href);
    window.addEventListener('popstate', pop, true);
    const script = document.createElement('script');
    script.src = 'https://ingest.sassmaker.com/tracker.js';
    script.async = true;
    script.dataset['key'] = APP_HEALTH_PUBLIC_KEY;
    script.dataset['endpoint'] = 'https://ingest.sassmaker.com/v1/browser';
    script.onload = () => {
      if (disposed && activeScript === script) browserTracker()?.stop();
      else flushPendingAppHealthEvents();
    };
    // React Strict Mode discards its first effect before this microtask runs.
    queueMicrotask(() => {
      if (disposed) return;
      activeScript = script;
      document.head.append(script);
    });
    const click = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return;
      const link = event.target.closest<HTMLAnchorElement>('main a[href]');
      if (!link) return;
      const name = readingAction(link.href, location.origin);
      if (name) trackAppHealthEvent(name);
    };
    document.addEventListener('click', click);
    return () => {
      disposed = true;
      document.removeEventListener('click', click);
      script.remove();
      browserTracker()?.stop();
      window.removeEventListener('popstate', pop, true);
      if (history.pushState === push) history.pushState = originalPush;
      if (history.replaceState === replace) history.replaceState = originalReplace;
    };
  }, [publicPage]);
  return null;
}
