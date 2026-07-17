'use client';

import { useEffect, useState } from 'react';
import { FeedbackWidget } from '@saas-maker/feedback';
import '@saas-maker/feedback/dist/index.css';

const API_KEY = process.env.NEXT_PUBLIC_SAASMAKER_API_KEY ?? '';
const API_BASE = 'https://api.sassmaker.com';

export function SaaSMakerFeedback() {
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(min-width: 640px)');
    const sync = () => setIsDesktop(mediaQuery.matches);

    sync();
    mediaQuery.addEventListener('change', sync);

    return () => mediaQuery.removeEventListener('change', sync);
  }, []);

  if (!API_KEY || !isDesktop) return null;
  return (
    <FeedbackWidget
      projectId={API_KEY}
      apiBaseUrl={API_BASE}
      position="bottom-right"
      theme="dark"
    />
  );
}
