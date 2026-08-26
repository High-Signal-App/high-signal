'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { HISTORY_ACCESS_ACTION } from '@high-signal/shared';
import { TurnstileWidget } from '@/components/turnstile-widget';

const TURNSTILE_SITE_KEY =
  process.env['NEXT_PUBLIC_TURNSTILE_SITE_KEY'] ?? '0x4AAAAAAECKL9dzkPASkdm0';

export function HistoryGate({
  title = 'Verify to read earlier signals',
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
      if (!response.ok) throw new Error('verification_failed');
      router.refresh();
    } catch {
      setError('Verification did not complete. Please try again.');
      setResetSignal((value) => value + 1);
    } finally {
      setPending(false);
    }
  }

  return (
    <section
      className="mx-auto mt-10 max-w-2xl border-y border-[var(--color-line)] py-10"
      aria-labelledby="history-gate-title"
    >
      <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-accent)]">
        protected history
      </div>
      <h1 id="history-gate-title" className="mt-3 text-3xl font-medium tracking-tight">
        {title}
      </h1>
      <p className="mt-4 max-w-[65ch] text-sm leading-6 text-[var(--color-muted)]">{description}</p>
      <div className="mt-7 min-h-[70px]">
        <TurnstileWidget
          siteKey={TURNSTILE_SITE_KEY}
          action={HISTORY_ACCESS_ACTION}
          resetSignal={resetSignal}
          onTokenChange={(token) => void verify(token)}
        />
      </div>
      <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-muted)]">
        {pending ? 'verifying…' : 'one check · 12 hours of access'}
      </p>
      {error ? (
        <p className="mt-3 text-sm text-red-300" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
