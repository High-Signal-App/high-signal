// security.txt per RFC 9116.

export const dynamic = "force-static";

const BODY = `Contact: https://github.com/sarthakagrawal927/high-signal/security/advisories/new
Contact: mailto:sarthakagrawal927@gmail.com
Preferred-Languages: en
Expires: 2027-06-10T00:00:00Z
Canonical: https://highsignal.app/.well-known/security.txt
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
