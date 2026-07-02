'use client';

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body className="min-h-dvh bg-[var(--color-bg)] font-sans text-[var(--color-fg)] antialiased">
        <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6">
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-accent)]">
            high signal
          </div>
          <h1 className="mt-3 text-2xl font-medium tracking-tight">The shell recovered.</h1>
          <p className="mt-3 text-sm leading-6 text-[var(--color-muted)]">
            A page failed while rendering. You can retry this view or return to the dashboard.
          </p>
          <div className="mt-6 flex flex-wrap gap-3 font-mono text-[10px] uppercase tracking-[0.18em]">
            <button
              type="button"
              onClick={reset}
              className="border border-[var(--color-line)] px-3 py-2 text-[var(--color-fg)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
            >
              retry
            </button>
            <a
              href="/"
              className="border border-[var(--color-line)] px-3 py-2 text-[var(--color-muted)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
            >
              home
            </a>
          </div>
        </main>
      </body>
    </html>
  );
}
