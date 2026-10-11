import { Skeleton, SkeletonContainer, SkeletonText } from '@saas-maker/ui/components/skeleton';
import { PageShell } from './HighSignalUI';

export function StoryRows({ count = 5 }: { count?: number }) {
  return (
    <SkeletonContainer>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="border-b border-line py-7">
          <Skeleton className="mb-3 h-3 w-36" />
          <Skeleton className="mb-4 h-8 w-4/5" />
          <SkeletonText lines={2} announce={false} />
          <Skeleton className="mt-5 h-3 w-52 max-w-full" />
        </div>
      ))}
    </SkeletonContainer>
  );
}

export function BriefSkeleton() {
  return (
    <PageShell>
      <SkeletonContainer>
        <div className="mb-6 border-b border-line pb-4">
          <Skeleton className="h-11 w-48" />
        </div>
        <div className="border-b border-line pb-7">
          <Skeleton className="h-3 w-64 max-w-full" />
          <Skeleton className="mt-6 h-28 w-full sm:h-24 sm:w-4/5" />
          <SkeletonText className="mt-4 max-w-[68ch]" lines={3} announce={false} />
          <Skeleton className="mt-5 h-11 w-48" />
        </div>
      </SkeletonContainer>
      <StoryRows />
    </PageShell>
  );
}

export function CollectionSkeleton({
  variant = 'signals',
}: {
  variant?: 'signals' | 'ledger' | 'data' | 'entities' | 'markets';
}) {
  return (
    <PageShell>
      <SkeletonContainer>
        <div className="border-b border-line pb-7">
          <Skeleton className="h-3 w-36" />
          <Skeleton className="mt-4 h-10 w-64 max-w-full" />
          <SkeletonText className="mt-4 max-w-[68ch]" lines={2} announce={false} />
        </div>
        {variant === 'ledger' && (
          <div className="my-8 grid gap-px border border-line md:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="p-5">
                <Skeleton className="h-4 w-24" />
                <SkeletonText lines={3} className="mt-4" announce={false} />
              </div>
            ))}
          </div>
        )}
        {variant === 'signals' ? (
          <StoryRows />
        ) : (
          <div
            className={`mt-10 grid gap-6 ${variant === 'entities' ? 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4' : variant === 'markets' ? 'md:grid-cols-2' : ''}`}
          >
            {Array.from({ length: variant === 'entities' ? 16 : 8 }, (_, i) => (
              <div key={i} className="border-b border-line py-4">
                <Skeleton className="h-4 w-3/4" />
                {variant !== 'entities' && (
                  <SkeletonText
                    lines={variant === 'markets' ? 3 : 1}
                    className="mt-3"
                    announce={false}
                  />
                )}
              </div>
            ))}
          </div>
        )}
      </SkeletonContainer>
    </PageShell>
  );
}

export function DetailSkeleton() {
  return (
    <PageShell>
      <SkeletonContainer>
        <Skeleton className="h-4 w-40" />
        <div className="mt-8 border-b border-line pb-8">
          <Skeleton className="h-3 w-48" />
          <Skeleton className="mt-4 h-24 w-4/5" />
          <SkeletonText className="mt-5 max-w-[68ch]" lines={3} announce={false} />
        </div>
        {[0, 1, 2].map((i) => (
          <div key={i} className="mt-8 max-w-[68ch]">
            <Skeleton className="mb-5 h-6 w-48" />
            <SkeletonText lines={6} announce={false} />
          </div>
        ))}
      </SkeletonContainer>
    </PageShell>
  );
}
