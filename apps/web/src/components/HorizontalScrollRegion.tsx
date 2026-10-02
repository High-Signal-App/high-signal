'use client';

import type React from 'react';

interface HorizontalScrollRegionProps {
  children: React.ReactNode;
  className?: string;
  'aria-label': string;
}

export function HorizontalScrollRegion({
  children,
  className = '',
  'aria-label': ariaLabel,
}: HorizontalScrollRegionProps) {
  return (
    <section
      className={`max-w-full overflow-x-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400 ${className}`}
      aria-label={ariaLabel}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: The horizontal scroll region needs keyboard focus.
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        event.currentTarget.scrollBy({ left: event.key === 'ArrowRight' ? 120 : -120 });
      }}
    >
      {children}
    </section>
  );
}
