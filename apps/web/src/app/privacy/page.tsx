import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy — High Signal",
  description: "What High Signal stores about visitors and signed-in users.",
};

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16 text-zinc-300">
      <Link
        href="/"
        className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500 hover:text-zinc-300"
      >
        ← high signal
      </Link>
      <h1 className="mt-3 text-3xl font-medium tracking-tight text-white">
        Privacy
      </h1>
      <p className="mt-4 text-xs text-zinc-500">Last updated: 2026-05-15.</p>

      <h2 className="mt-8 text-base font-semibold text-white">
        Public surfaces
      </h2>
      <p className="mt-2 text-sm leading-7">
        <Link className="underline" href="/signals">/signals</Link>,{" "}
        <Link className="underline" href="/digest">/digest</Link>,{" "}
        <Link className="underline" href="/track-record">/track-record</Link>,
        and their RSS feeds are public and require no sign-in. We don&apos;t
        track which signals you read.
      </p>

      <h2 className="mt-8 text-base font-semibold text-white">
        Signed-in users
      </h2>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm marker:text-zinc-600">
        <li>Auth is handled by Cloudflare Access via a Google identity provider.</li>
        <li>We store the email, name, and watchlist entries you create.</li>
        <li>No third-party analytics ride along.</li>
      </ul>

      <h2 className="mt-8 text-base font-semibold text-white">
        What we don&apos;t do
      </h2>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm marker:text-zinc-600">
        <li>No remarketing pixels.</li>
        <li>No selling of subscriber data.</li>
        <li>No retroactive editing of signals or evidence — corrections are new signals citing prior ones.</li>
      </ul>
    </main>
  );
}
