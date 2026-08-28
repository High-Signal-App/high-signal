import { onLCP, onCLS, onINP, onTTFB, onFCP } from 'web-vitals';

interface VitalMetric {
  name: string;
  value: number;
  rating: string;
  id: string;
  navigationType: string;
}

function captureInPostHog(metric: VitalMetric): boolean {
  const posthog = (window as any).posthog;
  if (!posthog || typeof posthog.capture !== 'function') return false;
  posthog.capture('web_vital', {
    name: metric.name,
    value: Math.round(metric.value),
    rating: metric.rating,
    id: metric.id,
    navigation_type: metric.navigationType,
  });
  return true;
}

function sendToAnalytics(metric: VitalMetric) {
  if (captureInPostHog(metric)) return;
  window.setTimeout(() => captureInPostHog(metric), 3000);
}

export function initVitals() {
  onLCP(sendToAnalytics);
  onCLS(sendToAnalytics);
  onINP(sendToAnalytics);
  onTTFB(sendToAnalytics);
  onFCP(sendToAnalytics);
}
