// Plan 0011 — OpenLens steal list. Pure helpers shared by worker and tests.

export type Ownership = "owned" | "competitor" | "third_party" | "unknown";

export interface BrandIdentity {
  brandUrl: string | null;
  brandAliases?: string[];
  competitorUrls?: Array<{ id: string; url: string }>;
}

export function hostOf(url: string): string | null {
  try {
    return new URL(url).host.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function classifyOwnership(
  url: string,
  brand: BrandIdentity,
): { ownership: Ownership; competitorId?: string } {
  const host = hostOf(url);
  if (!host) return { ownership: "unknown" };
  const brandHost = brand.brandUrl ? hostOf(brand.brandUrl) : null;
  if (brandHost && host === brandHost) return { ownership: "owned" };
  for (const c of brand.competitorUrls ?? []) {
    const ch = hostOf(c.url);
    if (ch && ch === host) return { ownership: "competitor", competitorId: c.id };
  }
  return { ownership: "third_party" };
}

// Share-of-voice over a flat list of mention_result rows.
export interface MentionRow {
  brandMentioned: boolean;
  brandRecommended?: boolean;
  competitorsMentioned: string[]; // canonical ids or names
  citations: string[];
  brandCited?: boolean;
  platform?: string;
  createdAt: string;
}

export interface ShareOfVoice {
  windowDays: number;
  runs: number;
  brandMentionRate: number;
  brandRecommendationRate: number;
  brandCitationRate: number;
  competitorShare: Record<string, number>; // competitor → share-of-mention (0..1)
  citationShare: Record<string, number>; // host → share of citations
}

export function computeShareOfVoice(rows: MentionRow[], windowDays: number): ShareOfVoice {
  const total = rows.length || 1;
  let brand = 0;
  let recommended = 0;
  let cited = 0;
  const compCounts: Record<string, number> = {};
  const citeCounts: Record<string, number> = {};
  for (const r of rows) {
    if (r.brandMentioned) brand++;
    if (r.brandRecommended) recommended++;
    if (r.brandCited) cited++;
    for (const c of r.competitorsMentioned) compCounts[c] = (compCounts[c] ?? 0) + 1;
    for (const url of r.citations) {
      const h = hostOf(url);
      if (h) citeCounts[h] = (citeCounts[h] ?? 0) + 1;
    }
  }
  const competitorShare: Record<string, number> = {};
  for (const [k, v] of Object.entries(compCounts)) competitorShare[k] = v / total;
  const citationShare: Record<string, number> = {};
  const totalCitations = Object.values(citeCounts).reduce((a, b) => a + b, 0) || 1;
  for (const [k, v] of Object.entries(citeCounts)) citationShare[k] = v / totalCitations;
  return {
    windowDays,
    runs: rows.length,
    brandMentionRate: brand / total,
    brandRecommendationRate: recommended / total,
    brandCitationRate: cited / total,
    competitorShare,
    citationShare,
  };
}

// Visibility matrix collapses runs to (prompt, platform) cells.
export interface MatrixRow {
  prompt: string;
  promptKey?: string;
  platform: string;
  brandMentioned: boolean;
  brandRecommended: boolean;
  competitorsMentioned: string[];
  citations: string[];
  runAt: string;
}

export interface MatrixCell {
  prompt: string;
  platform: string;
  brandMentioned: boolean;
  brandRecommended: boolean;
  competitors: string[];
  citationsCount: number;
  runAt: string;
}

export function buildVisibilityMatrix(rows: MatrixRow[]): MatrixCell[] {
  const byKey = new Map<string, MatrixCell>();
  for (const r of rows) {
    const k = `${r.promptKey ?? r.prompt}::${r.platform}`;
    const existing = byKey.get(k);
    if (!existing || Date.parse(r.runAt) > Date.parse(existing.runAt)) {
      byKey.set(k, {
        prompt: r.prompt,
        platform: r.platform,
        brandMentioned: r.brandMentioned,
        brandRecommended: r.brandRecommended,
        competitors: r.competitorsMentioned,
        citationsCount: r.citations.length,
        runAt: r.runAt,
      });
    }
  }
  return Array.from(byKey.values());
}

// Trend window math: bucket rows by ISO date, return brand-mention rate per day.
export interface TrendPoint {
  date: string; // YYYY-MM-DD
  runs: number;
  mentionRate: number;
  recommendationRate: number;
  citedHosts: number;
}

export function computeTrends(rows: MentionRow[], windowDays: number, nowMs: number): TrendPoint[] {
  const cutoff = nowMs - windowDays * 24 * 3600 * 1000;
  const byDay = new Map<string, MentionRow[]>();
  for (const r of rows) {
    const t = Date.parse(r.createdAt);
    if (!Number.isFinite(t) || t < cutoff) continue;
    const d = new Date(t).toISOString().slice(0, 10);
    const list = byDay.get(d) ?? [];
    list.push(r);
    byDay.set(d, list);
  }
  const points: TrendPoint[] = [];
  for (const [date, list] of Array.from(byDay.entries()).sort(([a], [b]) => a.localeCompare(b))) {
    const total = list.length || 1;
    const mention = list.filter((r) => r.brandMentioned).length;
    const rec = list.filter((r) => r.brandRecommended).length;
    const hosts = new Set<string>();
    for (const r of list) {
      for (const u of r.citations) {
        const h = hostOf(u);
        if (h) hosts.add(h);
      }
    }
    points.push({
      date,
      runs: list.length,
      mentionRate: mention / total,
      recommendationRate: rec / total,
      citedHosts: hosts.size,
    });
  }
  return points;
}

// Attribute grid: maps agent-eval area → ranked task list with evidence URLs.
export type AttributeArea =
  | "positioning"
  | "pricing"
  | "proof"
  | "comparisons"
  | "docs"
  | "policies"
  | "reviews"
  | "transaction_readiness";

export interface AttributeRow {
  area: string;
  status: "missing" | "weak" | "clear" | "strong";
  evidenceUrls: string[];
  notes: string;
  taskCount: number;
}

const ATTRIBUTE_ORDER: AttributeArea[] = [
  "positioning",
  "pricing",
  "proof",
  "comparisons",
  "docs",
  "policies",
  "reviews",
  "transaction_readiness",
];

export function sortAttributes(rows: AttributeRow[]): AttributeRow[] {
  const idx = (a: string) => {
    const i = (ATTRIBUTE_ORDER as string[]).indexOf(a);
    return i === -1 ? ATTRIBUTE_ORDER.length : i;
  };
  return [...rows].sort((a, b) => idx(a.area) - idx(b.area));
}
