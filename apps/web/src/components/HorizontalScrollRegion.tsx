'use client';

import { useRef } from 'react';
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
  const scrollRegion = useRef<HTMLElement>(null);

  return (
    <div className="relative max-w-full">
      <button
        type="button"
        className="sr-only focus:not-sr-only focus:absolute focus:left-0 focus:top-0 focus:z-10 focus:bg-zinc-900 focus:px-3 focus:py-2 focus:text-sm focus:outline focus:outline-2 focus:outline-emerald-400"
        aria-label={`Scroll ${ariaLabel} left`}
        onClick={() => scrollRegion.current?.scrollBy({ left: -120 })}
      >
        Scroll left
      </button>
      <button
        type="button"
        className="sr-only focus:not-sr-only focus:absolute focus:left-24 focus:top-0 focus:z-10 focus:bg-zinc-900 focus:px-3 focus:py-2 focus:text-sm focus:outline focus:outline-2 focus:outline-emerald-400"
        aria-label={`Scroll ${ariaLabel} right`}
        onClick={() => scrollRegion.current?.scrollBy({ left: 120 })}
      >
        Scroll right
      </button>
      <section
        ref={scrollRegion}
        className={`max-w-full overflow-x-auto ${className}`}
        aria-label={ariaLabel}
      >
        {children}
      </section>
    </div>
  );
}
