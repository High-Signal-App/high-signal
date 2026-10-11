import { EmptyState } from '@saas-maker/ui/components/empty-state';
import { PageShell } from '@/components/system/HighSignalUI';

export default function NotFound() {
  return (
    <PageShell>
      <EmptyState
        title="404 / signal lost"
        description="Not found"
        primaryAction={
          <a href="/" className="underline underline-offset-4">
            ← home
          </a>
        }
      />
    </PageShell>
  );
}
