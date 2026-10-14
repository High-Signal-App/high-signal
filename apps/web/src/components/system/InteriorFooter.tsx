'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

/** Home owns its resolved-state footer; other routes retain compact navigation. */
export function InteriorFooter({ children }: { children: ReactNode }) {
  return usePathname() === '/' ? null : children;
}
