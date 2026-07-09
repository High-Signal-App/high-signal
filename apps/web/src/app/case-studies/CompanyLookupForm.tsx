'use client';

import type { Route } from 'next';
import { Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

interface LookupResponse {
  created: boolean;
  company?: { slug: string; name: string; status?: string };
  error?: string;
}

export function CompanyLookupForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const response = await fetch('/api/company-universe/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, domain }),
      });
      const payload = (await response.json()) as LookupResponse;
      if (!response.ok || !payload.company?.slug) {
        throw new Error(payload.error ?? 'Could not create company');
      }
      router.push(`/case-studies/${payload.company.slug}` as Route);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create company');
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="mt-8 border border-[var(--color-line)] p-4"
      aria-label="Create or find a company profile"
    >
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)_auto]">
        <label className="block">
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-500">
            company
          </span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Slack"
            className="mt-2 h-10 w-full border border-[var(--color-line)] bg-transparent px-3 text-sm text-zinc-100 outline-none transition focus:border-[var(--color-accent)]"
          />
        </label>
        <label className="block">
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-500">
            domain
          </span>
          <input
            value={domain}
            onChange={(event) => setDomain(event.target.value)}
            placeholder="slack.com"
            className="mt-2 h-10 w-full border border-[var(--color-line)] bg-transparent px-3 text-sm text-zinc-100 outline-none transition focus:border-[var(--color-accent)]"
          />
        </label>
        <button
          type="submit"
          disabled={pending || (!name.trim() && !domain.trim())}
          className="mt-5 inline-flex h-10 items-center justify-center gap-2 border border-[var(--color-accent)] px-4 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-accent)] transition hover:bg-[var(--color-accent)] hover:text-black disabled:cursor-not-allowed disabled:border-zinc-700 disabled:text-zinc-600 disabled:hover:bg-transparent"
        >
          <Search className="size-3.5" aria-hidden="true" />
          {pending ? 'creating' : 'lookup'}
        </button>
      </div>
      {error && <p className="mt-3 text-sm text-red-300">{error}</p>}
    </form>
  );
}
