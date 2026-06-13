// Shared sha16 id helper. Truncates a SHA-256 hex digest to 16 chars — used
// across every route file as a deterministic-id generator for upserts.

export async function sha16(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
}
