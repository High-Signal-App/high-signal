'use client';

import type { Route } from 'next';
import { usePathname, useRouter } from 'next/navigation';
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

type AppRouter = ReturnType<typeof useRouter>;

function captureClickAction(event: MouseEvent) {
  if (!(event.target instanceof Element)) return null;
  const taggedName =
    event.target.closest<HTMLElement>('[data-app-health-event]')?.dataset['appHealthEvent'];
  if (taggedName) trackAppHealthEvent(taggedName);

  const link = event.target.closest<HTMLAnchorElement>('a[href]');
  const readingName = link?.closest('main') ? readingAction(link.href, location.origin) : null;
  if (readingName) trackAppHealthEvent(readingName);
  return { link, hasAction: Boolean(taggedName || readingName) };
}

function shouldDelayNavigation(
  event: MouseEvent,
  link: HTMLAnchorElement | null,
  hasAction: boolean,
  hasTracker: boolean
): boolean {
  if (!link || !hasAction || !hasTracker) return false;
  return (
    !event.defaultPrevented &&
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey &&
    link.target !== '_blank' &&
    !link.hasAttribute('download') &&
    new URL(link.href, location.href).origin === location.origin
  );
}

function navigateAfterFlush(
  tracker: NonNullable<ReturnType<typeof browserTracker>>,
  link: HTMLAnchorElement,
  router: AppRouter
) {
  const destination = new URL(link.href, location.href);
  const nextPath = `${destination.pathname}${destination.search}${destination.hash}`;
  let timer: number | undefined;
  void Promise.race([
    tracker.flush(),
    new Promise<void>((resolve) => {
      timer = window.setTimeout(resolve, 1200);
    }),
  ])
    .catch(() => undefined)
    .finally(() => {
      if (timer !== undefined) window.clearTimeout(timer);
      router.push(nextPath as Route);
    });
}

function handleAnalyticsClick(event: MouseEvent, router: AppRouter) {
  const action = captureClickAction(event);
  if (!action) return;
  const tracker = browserTracker();
  if (
    !shouldDelayNavigation(event, action.link, action.hasAction, Boolean(tracker)) ||
    !tracker ||
    !action.link
  )
    return;
  // Wait for the named action batch before moving to another reader route.
  event.preventDefault();
  navigateAfterFlush(tracker, action.link, router);
}

function installAnalytics(router: AppRouter) {
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
  const click = (event: MouseEvent) => handleAnalyticsClick(event, router);
  document.addEventListener('click', click, true);
  return () => {
    disposed = true;
    document.removeEventListener('click', click, true);
    script.remove();
    browserTracker()?.stop();
    window.removeEventListener('popstate', pop, true);
    if (history.pushState === push) history.pushState = originalPush;
    if (history.replaceState === replace) history.replaceState = originalReplace;
  };
}

export function AppHealthAnalytics() {
  const pathname = usePathname();
  const router = useRouter();
  const publicPage = isPublicAnalyticsPath(pathname);
  useEffect(() => {
    // UA matches are claims, not verification. Server-side summaries account
    // for these separately; JS-capable unknown automation can still be present.
    if (!publicPage || classifyUserAgent(navigator.userAgent) !== 'unknown') return;
    return installAnalytics(router);
  }, [publicPage]);
  return null;
}
