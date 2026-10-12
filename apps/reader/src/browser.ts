import { initVitals } from '@/lib/vitals';
import { initApiTiming } from '@/lib/api-timing';
import { APP_HEALTH_PUBLIC_KEY } from '@/lib/app-health-public';
import { classifyUserAgent } from '@high-signal/shared';
import {
  readingAction,
  trackAppHealthEvent,
  flushPendingAppHealthEvents,
} from '@/lib/app-health-browser';

document.querySelectorAll<HTMLFormElement>('form[data-reader-region]').forEach((form) => {
  form.querySelector('select')?.addEventListener('change', () => form.requestSubmit());
});
initVitals();
initApiTiming();
const monitor = async () => {
  const [{ installBrowserMonitoring }, { trackPageView }] = await Promise.all([
    import('@/lib/foundry-monitoring'),
    import('@/lib/analytics'),
  ]);
  installBrowserMonitoring();
  trackPageView();
};
const startMonitoring = () => void monitor().catch(() => {});
if (window.requestIdleCallback) window.requestIdleCallback(startMonitoring);
else window.setTimeout(startMonitoring, 1500);
if (classifyUserAgent(navigator.userAgent) === 'unknown') {
  const script = document.createElement('script');
  script.src = 'https://ingest.sassmaker.com/tracker.js';
  script.async = true;
  script.dataset['key'] = APP_HEALTH_PUBLIC_KEY;
  script.dataset['endpoint'] = 'https://ingest.sassmaker.com/v1/browser';
  script.onload = () => flushPendingAppHealthEvents();
  document.head.append(script);
  document.addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) return;
    const link = event.target.closest<HTMLAnchorElement>('main a[href]');
    const action = link && readingAction(link.href, location.origin);
    if (action) trackAppHealthEvent(action);
  });
}
let clarityStarted = false;
const clarityWindow = window as typeof window & {
  clarity?: ((...args: unknown[]) => void) & { q?: unknown[][] };
};
clarityWindow.clarity ??= Object.assign(
  (...args: unknown[]) => clarityWindow.clarity?.q?.push(args),
  { q: [] as unknown[][] }
);
clarityWindow.clarity('set', 'project_id', 'high-signal');
const startClarity = () => {
  if (clarityStarted) return;
  clarityStarted = true;
  const clarity = document.createElement('script');
  clarity.src = 'https://www.clarity.ms/tag/ybcgyx9ugh';
  clarity.async = true;
  document.head.append(clarity);
};
for (const event of ['pointerdown', 'keydown', 'scroll', 'touchstart'])
  window.addEventListener(event, startClarity, { once: true, passive: true });
