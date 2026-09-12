type BrowserTracker = { track(name: string): void; stop(): void; flush(): Promise<void> };
const pending: string[] = [];

export function isPublicAnalyticsPath(path: string): boolean {
  return !/^\/(review|admin|api)(\/|$)/.test(path);
}

export function browserTracker(): BrowserTracker | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as Window & { appHealth?: BrowserTracker }).appHealth;
}

export function trackAppHealthEvent(name: string): void {
  if (
    typeof window === 'undefined' ||
    !isPublicAnalyticsPath(window.location.pathname) ||
    !/^[a-z][a-z0-9_.:-]{0,63}$/.test(name)
  )
    return;
  const tracker = browserTracker();
  if (tracker) tracker.track(name);
  else if (pending.length < 20) pending.push(name);
}

export function flushPendingAppHealthEvents(): void {
  const tracker = browserTracker();
  if (!tracker) return;
  for (const name of pending.splice(0)) tracker.track(name);
}

/** Names only: destinations, queries, link text and reader inputs never leave here. */
export function readingAction(href: string, origin: string): string | null {
  try {
    const url = new URL(href, origin);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    if (url.origin !== origin) return 'source.opened';
    if (/^\/signals\/[^/]+$/.test(url.pathname)) return 'signal.opened';
    if (/^\/data\/[^/]+$/.test(url.pathname)) return 'source.explored';
    if (/^\/case-studies\/[^/]+$/.test(url.pathname)) return 'company.opened';
    if (/^\/brief\/[^/]+$/.test(url.pathname)) return 'archive.opened';
    return null;
  } catch {
    return null;
  }
}
