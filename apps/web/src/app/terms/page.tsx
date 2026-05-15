import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms — High Signal",
  description: "Signals are research, not financial advice. Use as-is.",
};

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16 text-zinc-300">
      <Link
        href="/"
        className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500 hover:text-zinc-300"
      >
        ← high signal
      </Link>
      <h1 className="mt-3 text-3xl font-medium tracking-tight text-white">Terms</h1>
      <p className="mt-4 text-xs text-zinc-500">Last updated: 2026-05-15.</p>

      <h2 className="mt-8 text-base font-semibold text-white">Not financial advice</h2>
      <p className="mt-2 text-sm leading-7">
        Signals are best-effort research published with cited evidence
        and explicit confidence bands. They are not a recommendation
        to buy, sell, or hold any security. Read the{" "}
        <Link href="/track-record" className="underline">track record</Link>{" "}
        before trusting any individual signal.
      </p>

      <h2 className="mt-8 text-base font-semibold text-white">Public surfaces</h2>
      <p className="mt-2 text-sm leading-7">
        <Link href="/signals" className="underline">/signals</Link>,{" "}
        <Link href="/digest" className="underline">/digest</Link>,{" "}
        <Link href="/track-record" className="underline">/track-record</Link>,
        and their RSS / JSON feeds are free to consume and embed. Be
        polite about rate.
      </p>

      <h2 className="mt-8 text-base font-semibold text-white">No retroactive edits</h2>
      <p className="mt-2 text-sm leading-7">
        We do not modify or remove published signals after the fact.
        Corrections are new signals that cite the prior — preserving
        the audit trail for the hit-rate ledger.
      </p>

      <h2 className="mt-8 text-base font-semibold text-white">No warranty</h2>
      <p className="mt-2 text-sm leading-7">
        Provided as-is. We don&apos;t guarantee timeliness, accuracy,
        or completeness of any signal.
      </p>
    </main>
  );
}
