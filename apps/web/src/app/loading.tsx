import { PageShell } from '@/components/system/HighSignalUI';

export default function Loading() {
  return (
    <PageShell>
      <div role="status" className="min-h-80">
        <p className="border-b border-[var(--color-line)] pb-7 font-mono text-xs uppercase tracking-[0.14em] text-[var(--color-muted)]">
          Loading page…
        </p>
        <div aria-hidden="true" className="mt-8 space-y-4 motion-safe:animate-pulse">
          <div className="h-6 w-2/3 bg-[var(--color-line)]" />
          <div className="h-3 w-full bg-[var(--color-line)]" />
          <div className="h-3 w-5/6 bg-[var(--color-line)]" />
        </div>
      </div>
    </PageShell>
  );
}
