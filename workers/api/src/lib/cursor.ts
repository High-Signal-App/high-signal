/**
 * Opaque keyset cursors for the public `/data` listings.
 *
 * A `LIMIT` over a non-unique `ORDER BY` is not a well-defined window. Rows
 * that tie on the sort key have no defined order between them, so page 2 can
 * repeat or skip rows page 1 already returned, and an insert between two page
 * fetches shifts every subsequent `OFFSET`.
 *
 * On `events` the ties are not hypothetical. Ingest writes in batches and the
 * whole batch carries one `published_at`: the newest 200 `markets` rows in
 * production share a single value, and tie blocks of 200-400 rows are normal.
 * A 50-row page therefore sits *entirely inside* one tie block, which is the
 * worst case for offset pagination — every page boundary falls where the order
 * is undefined.
 *
 * So a cursor carries the sort key **and** a unique tiebreaker (the row's
 * primary key), and every paginated query orders by both. That makes the
 * window a total order, which is what a `LIMIT` needs in order to mean
 * anything.
 *
 * The encoding is deliberately opaque: callers must treat a cursor as a token
 * to hand back, never as a value to construct. The leading version tag lets
 * the payload change later without a decoder silently misreading an old token.
 */

export interface KeysetCursor {
  /** Unix seconds — the primary sort key. */
  publishedAt: number;
  /** The row's primary key — the unique tiebreaker. */
  id: string;
}

const CURSOR_VERSION = '1';

function toBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): string | null {
  try {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

/** Encodes the last row of a page into the token that fetches the next one. */
export function encodeKeysetCursor(cursor: KeysetCursor): string {
  return toBase64Url(`${CURSOR_VERSION}.${cursor.publishedAt}.${cursor.id}`);
}

/**
 * Decodes a caller-supplied token. Returns `null` for anything malformed —
 * wrong version, non-numeric sort key, empty id — so the route can answer 400
 * rather than quietly serving page 1 again under a broken cursor.
 */
export function decodeKeysetCursor(raw: string): KeysetCursor | null {
  const decoded = fromBase64Url(raw);
  if (decoded === null) return null;
  const firstDot = decoded.indexOf('.');
  const secondDot = decoded.indexOf('.', firstDot + 1);
  if (firstDot === -1 || secondDot === -1) return null;
  if (decoded.slice(0, firstDot) !== CURSOR_VERSION) return null;
  const publishedAt = Number(decoded.slice(firstDot + 1, secondDot));
  // The id is the remainder, so an id containing '.' round-trips intact.
  const id = decoded.slice(secondDot + 1);
  if (!Number.isSafeInteger(publishedAt) || id === '') return null;
  return { publishedAt, id };
}
