'use client';

import { useEffect, useState } from 'react';

type ReadingView = 'brief' | 'newspaper';

const STORAGE_KEY = 'high-signal-reading-view';

function applyView(view: ReadingView) {
  document.documentElement.dataset['readingView'] = view;
  try {
    window.localStorage.setItem(STORAGE_KEY, view);
  } catch {
    // The current page still switches when storage is blocked or unavailable.
  }
}

export function ReadingLayoutToggle() {
  const [view, setView] = useState<ReadingView>('brief');

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(STORAGE_KEY);
    } catch {
      // Brief is the safe default when local preference storage is unavailable.
    }
    const selected: ReadingView = stored === 'newspaper' ? 'newspaper' : 'brief';
    document.documentElement.dataset['readingView'] = selected;
    setView(selected);
  }, []);

  return (
    <fieldset className="flex border border-[var(--color-line)]">
      <legend className="sr-only">Reading view</legend>
      {(['brief', 'newspaper'] as const).map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={view === option}
          onClick={() => {
            applyView(option);
            setView(option);
          }}
          className={`reading-view-option min-h-11 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.12em] transition-colors ${
            view === option
              ? 'bg-[var(--color-fg)] text-[var(--color-bg)]'
              : 'text-[var(--color-muted)] hover:text-[var(--color-fg)]'
          }`}
        >
          {option}
        </button>
      ))}
    </fieldset>
  );
}
