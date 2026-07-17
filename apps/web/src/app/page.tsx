export { default } from './signals/page';

import type { Metadata } from 'next';
import { SITE_NAME, SITE_TAGLINE, SITE_URL } from '@/lib/site';

export const dynamic = 'force-dynamic';

/** Homepage self-canonical — do not inherit a global homepage canonical onto every route. */
export const metadata: Metadata = {
  title: {
    absolute: `${SITE_NAME} — ${SITE_TAGLINE}`,
  },
  alternates: {
    canonical: SITE_URL,
  },
};
