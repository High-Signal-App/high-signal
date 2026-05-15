import { headers } from "next/headers";

import { api } from "@/lib/api";
import { buildRssXml, signalExcerpt, signalHeadline } from "@/lib/rss";

export const dynamic = "force-dynamic";

export async function GET() {
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "https";
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";
  const base = `${proto}://${host}`;

  let signals: Awaited<ReturnType<typeof api.signals>>["signals"] = [];
  try {
    const r = await api.signals();
    signals = r.signals;
  } catch {
    /* API offline — return an empty feed rather than 500. */
  }

  const xml = buildRssXml({
    title: "High Signal — Signals",
    link: `${base}/signals`,
    description:
      "Every published High Signal signal — evidence-backed, with direction and confidence, scored against forward returns.",
    lastBuildDate:
      signals.length > 0 ? new Date(signals[0].publishedAt) : new Date(),
    items: signals.map((s) => ({
      title: signalHeadline(s.bodyMd, s.slug),
      link: `${base}/signals/${s.slug}`,
      guid: `${base}/signals/${s.slug}`,
      pubDate: new Date(s.publishedAt),
      description: signalExcerpt(s.bodyMd, 600),
      categories: [s.signalType, s.direction, s.confidence],
    })),
  });

  return new Response(xml, {
    status: 200,
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
    },
  });
}
