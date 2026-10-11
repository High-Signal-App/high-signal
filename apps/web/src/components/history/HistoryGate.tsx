'use client';

import { useState } from 'react';
import { ErrorState } from '@saas-maker/ui/components/error-state';
import { Skeleton } from '@saas-maker/ui/components/skeleton';
import { useRouter } from 'next/navigation';
import { HISTORY_ACCESS_ACTION } from '@high-signal/shared';
import { trackAppHealthEvent } from '@/lib/app-health-browser';
import { TurnstileWidget } from '@/components/turnstile-widget';

const TURNSTILE_SITE_KEY =
  process.env['NEXT_PUBLIC_TURNSTILE_SITE_KEY'] ?? '0x4AAAAAAECKL9dzkPASkdm0';

export function HistoryGate({
  title = 'verify to read earlier signals',
  description = 'Today and yesterday stay open and fast. A quick human check unlocks older briefs and their signal proof pages for 12 hours.',
}: {
  title?: string;
  description?: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [resetSignal, setResetSignal] = useState(0);

  async function verify(token: string | null) {
    if (!token || pending) return;
    setPending(true);
    setError('');
    try {
      const response = await fetch('/api/history/access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ turnstileToken: token }),
      });
      if (!response.ok) {
        throw new Error(
          response.status >= 500
            ? 'History access is temporarily unavailable. Please try again.'
            : 'The human check was not accepted. Please try again.'
        );
      }
      trackAppHealthEvent('history.unlocked');
      router.refresh();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'Verification did not complete. Please try again.'
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <section
      className="mx-auto mt-10 max-w-2xl border-y border-[var(--color-line)] py-10"
      aria-busy={pending}
      aria-labelledby="history-gate-title"
    >
      <div className="font-mono text-[10px] tracking-[0.2em] text-[var(--color-accent)]">
        protected history
      </div>
      <h2 id="history-gate-title" className="mt-3 text-3xl font-medium tracking-tight">
        {title}
      </h2>
      <p className="mt-4 max-w-[65ch] text-sm leading-6 text-[var(--color-muted)]">{description}</p>
      <div className="relative mt-7 min-h-[70px]">
        {pending && <Skeleton className="absolute inset-0 z-10 h-[70px] w-[300px] max-w-full" />}
        <TurnstileWidget
          siteKey={TURNSTILE_SITE_KEY}
          action={HISTORY_ACCESS_ACTION}
          resetSignal={resetSignal}
          onTokenChange={(token) => void verify(token)}
        />
      </div>
      <p className="mt-4 font-mono text-[10px] tracking-[0.14em] text-[var(--color-muted)]">
        {pending ? 'verifying…' : 'one check · 12 hours of access'}
      </p>
      {error ? (
        <ErrorState
          title="verification did not complete"
          description={error}
          onRetry={() => {
            setError('');
            setResetSignal((value) => value + 1);
          }}
        />
      ) : null}
    </section>
  );
}
