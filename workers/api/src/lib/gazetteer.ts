/**
 * Worker-side mirror of `python/ingest/.../extract/entities.py:gazetteer_match`.
 *
 * Same regex-word-boundary semantics so that re-running matching here against
 * existing D1 events catches the same hits as the Python ingest would on a
 * fresh ingest. Used by the /admin/backfill-entities endpoint to repair rows
 * that the pre-fix Python matcher left as primary_entity_id NULL (notably
 * $TICKER tokens in prediction-market questions).
 */

const MIN_TERM_LEN = 3;

export interface GazetteerEntity {
  id: string;
  name: string | null;
  ticker: string | null;
  metadata: string | null; // JSON; reads `aliases: string[]` if present
}

interface CompiledPattern {
  re: RegExp;
  eid: string;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Extract distinct lowercase terms for one entity: name + ticker + aliases. */
export function termsFor(entity: GazetteerEntity): string[] {
  const out = new Set<string>();
  if (entity.name) out.add(entity.name.toLowerCase());
  if (entity.ticker) out.add(entity.ticker.toLowerCase());
  if (entity.metadata) {
    try {
      const m = JSON.parse(entity.metadata) as { aliases?: unknown };
      if (Array.isArray(m.aliases)) {
        for (const a of m.aliases) {
          if (typeof a === "string" && a.trim()) out.add(a.toLowerCase());
        }
      }
    } catch {
      /* ignore malformed metadata */
    }
  }
  return Array.from(out).filter((t) => t.length >= MIN_TERM_LEN);
}

/** Build the same `\bTERM\b` patterns the Python matcher uses, in one pass. */
export function buildPatterns(entities: GazetteerEntity[]): CompiledPattern[] {
  const out: CompiledPattern[] = [];
  for (const e of entities) {
    for (const term of termsFor(e)) {
      out.push({ re: new RegExp(`\\b${escapeRegex(term)}\\b`, "i"), eid: e.id });
    }
  }
  return out;
}

/** First-alphabetical entity ID matched in `text`, or null. Mirrors Python's `sorted(hits)[0]`. */
export function matchEntity(text: string, patterns: CompiledPattern[]): string | null {
  if (!text) return null;
  const haystack = text.toLowerCase();
  const hits = new Set<string>();
  for (const p of patterns) {
    if (p.re.test(haystack)) hits.add(p.eid);
  }
  if (hits.size === 0) return null;
  return Array.from(hits).sort()[0];
}
