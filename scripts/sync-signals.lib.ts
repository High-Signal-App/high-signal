/**
 * Pure parsing helpers for sync-signals.ts. Extracted so a tsx-runnable
 * assert test (`scripts/sync-signals.test.ts`) can exercise them without
 * pulling in fs/spawn side effects.
 */

export interface Front {
  slug: string;
  signal_type: string;
  primary_entity: string;
  direction: string;
  confidence: string;
  predicted_window_days: number;
  published_at: string;
  evidence_urls: string[];
  evidence_quotes?: string[];
  evidence_source_types?: string[];
  evidence_published_at?: string[];
  spillover_entity_ids?: string[];
  supersedes?: string | null;
  review_status: "draft" | "published" | "corrected" | "killed";
}

const REQUIRED_FRONT_KEYS = [
  "slug",
  "signal_type",
  "primary_entity",
  "direction",
  "confidence",
  "predicted_window_days",
  "published_at",
  "evidence_urls",
  "review_status",
] as const;

export function parseTinyYaml(yaml: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  let listKey: string | null = null;
  let listAcc: string[] = [];
  for (const lineRaw of yaml.split(/\r?\n/)) {
    const line = lineRaw.replace(/\s+$/, "");
    if (!line.length) continue;
    if (listKey && line.startsWith("  - ")) {
      listAcc.push(unquote(line.slice(4).trim()));
      continue;
    } else if (listKey) {
      out[listKey] = listAcc;
      listKey = null;
      listAcc = [];
    }
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const k = line.slice(0, idx).trim();
    const v = line.slice(idx + 1).trim();
    if (v === "") {
      listKey = k;
      listAcc = [];
    } else if (/^\d+$/.test(v)) {
      out[k] = parseInt(v, 10);
    } else if (v === "null") {
      out[k] = null;
    } else if (v.startsWith("[") && v.endsWith("]")) {
      out[k] = v
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    } else {
      out[k] = unquote(v);
    }
  }
  if (listKey) out[listKey] = listAcc;
  return out;
}

function unquote(value: string): string {
  return value.replace(/^['"]|['"]$/g, "");
}

export function parseFrontmatter(md: string): { front: Front; body: string } {
  const m = md.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) throw new Error("missing frontmatter");
  const raw = parseTinyYaml(m[1]);
  const front = validateFront(raw);
  return { front, body: m[2].trim() };
}

function validateFront(raw: Record<string, unknown>): Front {
  const missing: string[] = [];
  for (const key of REQUIRED_FRONT_KEYS) {
    const value = raw[key];
    if (value === undefined || value === null) missing.push(key);
  }
  if (missing.length > 0) {
    throw new Error(`missing required frontmatter keys: ${missing.join(", ")}`);
  }
  if (!Array.isArray(raw.evidence_urls) || raw.evidence_urls.length === 0) {
    throw new Error("evidence_urls must be a non-empty list");
  }
  if (typeof raw.predicted_window_days !== "number") {
    throw new Error("predicted_window_days must be an integer");
  }
  const allowedReview = new Set(["draft", "published", "corrected", "killed"]);
  if (!allowedReview.has(String(raw.review_status))) {
    throw new Error(`review_status must be one of ${[...allowedReview].join("|")}`);
  }
  if (Number.isNaN(new Date(String(raw.published_at)).getTime())) {
    throw new Error(`published_at is not a valid ISO datetime: ${raw.published_at}`);
  }
  return raw as unknown as Front;
}

export function escSql(s: string | null | undefined): string {
  if (s == null) return "NULL";
  return `'${s.replace(/'/g, "''")}'`;
}
