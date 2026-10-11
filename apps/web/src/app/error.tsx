'use client';

import { useEffect } from 'react';
import { ErrorState } from '@saas-maker/ui/components/error-state';
import { PageShell } from '@/components/system/HighSignalUI';

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
    void import('@/lib/foundry-monitoring').then(({ capturePageCrash }) => {
      capturePageCrash(error, 'window_error');
    });
  }, [error]);

  return (
    <PageShell>
      <ErrorState title="something went wrong" onRetry={reset} />
    </PageShell>
  );
}
