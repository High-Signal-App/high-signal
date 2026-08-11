import Link from 'next/link';
import type { Route } from 'next';
import type { BriefFeedCoverageReceipt } from '@high-signal/shared';

export function EditionCoverageReceipt({ coverage }: { coverage: BriefFeedCoverageReceipt }) {
  const contributing = new Set(coverage.contributingClasses);
  const domainLabel = coverage.uniqueEvidenceDomains === 1 ? 'evidence domain' : 'evidence domains';

  return (
    <aside
      className="coverage-receipt border-b border-[var(--color-line)] py-5"
      aria-label="Edition data coverage"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-accent)]">
          Coverage receipt · {coverage.uniqueEvidenceDomains} {domainLabel} ·{' '}
          {coverage.contributingClasses.length} contributing classes
        </div>
        <Link
          href={'/methodology/data-parity' as Route}
          className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-muted)] hover:text-[var(--color-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-accent)]"
        >
          parity ledger →
        </Link>
      </div>
      <details className="group mt-3 border-t border-dashed border-[var(--color-line)] pt-3">
        <summary className="flex min-h-11 cursor-pointer items-center font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-muted)] hover:text-[var(--color-fg)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-accent)]">
          inspect configured coverage and known gaps
        </summary>
        <div className="mt-4">
          <p className="max-w-[72ch] text-xs leading-5 text-[var(--color-muted)]">
            “Used” classes contributed evidence to this edition. “Configured” classes did not
            contribute and are not presented as coverage volume.
          </p>
          <ul
            className="mt-4 flex list-none flex-wrap gap-2"
            aria-label="Source class contribution status"
          >
            {coverage.configuredClasses.map((sourceClass) => (
              <li
                key={sourceClass}
                className={`border px-2 py-1 font-mono text-[9px] uppercase tracking-[0.12em] ${
                  contributing.has(sourceClass)
                    ? 'border-[var(--color-accent)] bg-[color-mix(in_oklab,var(--color-accent)_12%,transparent)] text-[var(--color-fg)]'
                    : 'border-[var(--color-line)] text-[var(--color-muted)]'
                }`}
              >
                {sourceClass} · {contributing.has(sourceClass) ? 'used' : 'configured'}
              </li>
            ))}
          </ul>
          {coverage.materialGaps.length > 0 ? (
            <p className="mt-4 border-t border-dashed border-[var(--color-line)] pt-3 text-xs leading-5 text-[var(--color-muted)]">
              <span className="font-medium text-[var(--color-fg)]">Material gaps:</span>{' '}
              {coverage.materialGaps.join(' · ')}
            </p>
          ) : null}
        </div>
      </details>
    </aside>
  );
}
