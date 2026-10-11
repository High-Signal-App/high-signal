'use client';

import { useEffect, useRef, useState } from 'react';
import { ErrorState } from '@saas-maker/ui/components/error-state';
import { Skeleton, SkeletonContainer } from '@saas-maker/ui/components/skeleton';

const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

type TurnstileApi = {
  render(
    container: HTMLElement,
    options: {
      sitekey: string;
      action: string;
      callback: (token: string) => void;
      'expired-callback': () => void;
      'error-callback': () => void;
    }
  ): string;
  remove(widgetId: string): void;
  reset(widgetId: string): void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let scriptPromise: Promise<void> | null = null;

function loadScript() {
  if (window.turnstile) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_URL}"]`);
    const script = existing ?? document.createElement('script');
    script.addEventListener(
      'load',
      () => (window.turnstile ? resolve() : reject(new Error('Turnstile unavailable'))),
      { once: true }
    );
    script.addEventListener('error', () => reject(new Error('Turnstile failed to load')), {
      once: true,
    });
    if (!existing) {
      script.src = SCRIPT_URL;
      script.async = true;
      script.defer = true;
      document.head.append(script);
    }
  }).catch((error) => {
    scriptPromise = null;
    document.querySelector(`script[src="${SCRIPT_URL}"]`)?.remove();
    throw error;
  });
  return scriptPromise;
}

export function TurnstileWidget({
  siteKey,
  action,
  resetSignal,
  onTokenChange,
}: {
  siteKey: string;
  action: string;
  resetSignal: number;
  onTokenChange: (token: string | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const callbackRef = useRef(onTokenChange);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    callbackRef.current = onTokenChange;
  }, [onTokenChange]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    void loadScript()
      .then(() => {
        if (cancelled || !containerRef.current || !window.turnstile) return;
        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          action,
          callback: (token) => {
            setError('');
            callbackRef.current(token);
          },
          'expired-callback': () => callbackRef.current(null),
          'error-callback': () => {
            setLoading(false);
            setError('Verification failed to load. Refresh and try again.');
            callbackRef.current(null);
          },
        });
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setLoading(false);
          setError('Verification failed to load. Refresh and try again.');
          callbackRef.current(null);
        }
      });
    return () => {
      cancelled = true;
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }
    };
  }, [action, siteKey, retry]);

  useEffect(() => {
    if (resetSignal > 0 && widgetIdRef.current && window.turnstile) {
      window.turnstile.reset(widgetIdRef.current);
    }
  }, [resetSignal]);

  return (
    <div className="relative min-h-[70px]">
      {loading && (
        <SkeletonContainer className="absolute inset-0">
          <Skeleton className="h-[70px] w-[300px] max-w-full" />
        </SkeletonContainer>
      )}
      <div
        ref={containerRef}
        className="cf-turnstile"
        data-sitekey={siteKey}
        data-action={action}
      />
      {error && <ErrorState description={error} onRetry={() => setRetry((value) => value + 1)} />}
    </div>
  );
}
