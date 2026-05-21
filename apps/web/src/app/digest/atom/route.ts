import { headers } from "next/headers";

import { api } from "@/lib/api";
import { signalExcerpt, signalHeadline } from "@/lib/rss";
import { isBackfillSignal } from "@/lib/signal-format";

export const dynamic = "force-dynamic";

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Atom 1.0 feed for the weekly digest — mirrors /digest/rss. */
export async function GET() {
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "https";
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";
  const base = `${proto}://${host}`;

  let signals: Awaited<ReturnType<typeof api.digestWeekly>>["signals"] = [];
  try {
    const r = await api.digestWeekly();
    signals = r.signals.filter((signal) => !isBackfillSignal(signal));
  } catch {
    /* API offline */
  }

  const updated =
    signals.length > 0
      ? new Date(signals[0].publishedAt).toISOString()
      : new Date().toISOString();

  const entries = signals
    .map(
      (s) => `  <entry>
    <title>${escapeXml(signalHeadline(s.bodyMd, s.slug))}</title>
    <id>${escapeXml(`${base}/signals/${s.slug}`)}</id>
    <link href="${escapeXml(`${base}/signals/${s.slug}`)}" />
    <updated>${new Date(s.publishedAt).toISOString()}</updated>
    <summary>${escapeXml(signalExcerpt(s.bodyMd, 600))}</summary>
  </entry>`,
    )
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>High Signal — Weekly digest</title>
  <id>${escapeXml(`${base}/digest/atom`)}</id>
  <link rel="self" type="application/atom+xml" href="${escapeXml(`${base}/digest/atom`)}" />
  <link rel="alternate" type="text/html" href="${escapeXml(`${base}/digest`)}" />
  <updated>${updated}</updated>
${entries}
</feed>
`;

  return new Response(xml, {
    status: 200,
    headers: {
      "Content-Type": "application/atom+xml; charset=utf-8",
      "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
    },
  });
}
