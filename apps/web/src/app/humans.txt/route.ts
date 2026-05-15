export const dynamic = "force-static";

const BODY = `/* TEAM */
Maintainer: Sarthak Agrawal
GitHub: sarthakagrawal927
Site: https://high-signal-web.sarthakagrawal927.workers.dev

/* THANKS */
edgartools, Trafilatura, GLiNER, GLiREL, NetworkX, FinBERT, VectorBT —
the OSS stack on top of which the ingest pipeline runs.

/* SITE */
Last updated: 2026-05-15
Standards: HTML5, Tailwind CSS, TypeScript, RFC 9116, RSS 2.0
Software: Next.js, Hono, Cloudflare Workers, D1, Modal
`;

export function GET() {
  return new Response(BODY, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=86400",
    },
  });
}
