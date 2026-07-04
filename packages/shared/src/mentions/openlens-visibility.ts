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
  persona?: string | null;
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

// ─── AI Visibility Score ────────────────────────────────────────────────────
// The headline 0-100 number a GEO buyer wants: are we mentioned, recommended,
// cited, and consistently so across engines? Cross-platform consistency is the
// fraction of platforms that mention the brand at least once — showing up on 4
// of 4 engines beats showing up strongly on 1.
export interface VisibilityScore {
  score: number;
  grade: "A" | "B" | "C" | "D" | "F";
  components: {
    mention: number;
    recommendation: number;
    citation: number;
    consistency: number;
  };
  platformsCovered: number;
  platformsTotal: number;
}

export function perPlatformMentionRate(rows: MentionRow[]): Record<string, number> {
  const byPlatform = new Map<string, { total: number; mentioned: number }>();
  for (const r of rows) {
    const p = r.platform ?? "custom";
    const cur = byPlatform.get(p) ?? { total: 0, mentioned: 0 };
    cur.total++;
    if (r.brandMentioned) cur.mentioned++;
    byPlatform.set(p, cur);
  }
  const out: Record<string, number> = {};
  for (const [p, v] of byPlatform) out[p] = v.total ? v.mentioned / v.total : 0;
  return out;
}

export function computeVisibilityScore(sov: ShareOfVoice, rows: MentionRow[]): VisibilityScore {
  const perPlatform = perPlatformMentionRate(rows);
  const platforms = Object.keys(perPlatform);
  const covered = platforms.filter((p) => perPlatform[p]! > 0).length;
  const consistency = platforms.length ? covered / platforms.length : 0;
  const components = {
    mention: sov.brandMentionRate,
    recommendation: sov.brandRecommendationRate,
    citation: sov.brandCitationRate,
    consistency,
  };
  // Weighted: presence and endorsement dominate; citation and cross-engine
  // consistency round it out.
  const score = Math.round(
    100 *
      (components.mention * 0.35 +
        components.recommendation * 0.3 +
        components.citation * 0.15 +
        components.consistency * 0.2),
  );
  const grade = score >= 80 ? "A" : score >= 60 ? "B" : score >= 40 ? "C" : score >= 20 ? "D" : "F";
  return {
    score,
    grade,
    components,
    platformsCovered: covered,
    platformsTotal: platforms.length,
  };
}

// ─── Per-persona visibility ───────────────────────────────────────────────────
// Value AI Labs' headline moat: different buyer-committee members get different
// AI answers. Slice the same runs by persona so a brand sees where it's strong
// (e.g. "developer") and invisible (e.g. "procurement").
export interface PersonaVisibility {
  persona: string;
  runs: number;
  mentionRate: number;
  recommendationRate: number;
  citationRate: number;
}

export function computePersonaVisibility(rows: MentionRow[]): PersonaVisibility[] {
  const byPersona = new Map<string, MentionRow[]>();
  for (const r of rows) {
    const key = (r.persona ?? "").trim() || "general";
    const list = byPersona.get(key) ?? [];
    list.push(r);
    byPersona.set(key, list);
  }
  const out: PersonaVisibility[] = [];
  for (const [persona, list] of byPersona) {
    const total = list.length || 1;
    out.push({
      persona,
      runs: list.length,
      mentionRate: list.filter((r) => r.brandMentioned).length / total,
      recommendationRate: list.filter((r) => r.brandRecommended).length / total,
      citationRate: list.filter((r) => r.brandCited).length / total,
    });
  }
  // Weakest personas first — that's where the work is.
  return out.sort((a, b) => a.mentionRate - b.mentionRate);
}

// ─── Citation gaps ────────────────────────────────────────────────────────────
// The actionable GEO target: sources the AI cites that AREN'T you. Owned
// citations are wins, not gaps, so they're excluded. Ranked by how often the AI
// leans on each host — the higher, the more valuable to get represented there.
export interface CitationGap {
  host: string;
  ownership: Ownership;
  citations: number;
  competitorId?: string;
}

export function computeCitationGaps(
  rows: MentionRow[],
  brand: BrandIdentity,
  limit = 15,
): CitationGap[] {
  const counts = new Map<string, { count: number; ownership: Ownership; competitorId?: string }>();
  for (const r of rows) {
    for (const url of r.citations) {
      const host = hostOf(url);
      if (!host) continue;
      const { ownership, competitorId } = classifyOwnership(url, brand);
      if (ownership === "owned") continue; // your own citations aren't a gap
      const cur = counts.get(host) ?? { count: 0, ownership, competitorId };
      cur.count++;
      counts.set(host, cur);
    }
  }
  return Array.from(counts.entries())
    .map(([host, v]) => ({ host, ownership: v.ownership, citations: v.count, competitorId: v.competitorId }))
    .sort((a, b) => b.citations - a.citations)
    .slice(0, limit);
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
