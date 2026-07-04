// LLM-judge analysis of an AI answer. The deterministic analyzer (keyword
// sentiment, regex "recommended", numbered-list position) is coarse: it misses
// negation, prose ranking, and qualitative nuance — exactly what a GEO buyer
// cares about. This module builds a strict-JSON judge prompt and robustly
// parses the verdict. Pure + deterministic (prompt build + parse); the network
// call and the deterministic fallback live in the worker.

import type { MentionSentiment } from "./mention-intelligence";

export interface JudgeCompetitor {
  name: string;
  mentioned: boolean;
  position: number | null;
}

export interface MentionVerdict {
  brandMentioned: boolean;
  brandRecommended: boolean;
  brandSentiment: MentionSentiment | null;
  brandPosition: number | null;
  competitorsMentioned: JudgeCompetitor[];
  citations: string[];
  brandCited: boolean;
  /** One-sentence rationale, stored for operator trust / debugging. */
  reasoning: string;
}

export interface JudgeSubject {
  brandName: string;
  brandAliases: string[];
  brandUrl: string | null;
  competitors: Array<{ name: string }>;
}

export function buildMentionJudgePrompt(subject: JudgeSubject, responseText: string): string {
  const aliases = subject.brandAliases.filter(Boolean);
  const competitorNames = subject.competitors.map((c) => c.name).filter(Boolean);
  return [
    "You are grading how an AI assistant's answer portrays a specific brand, for a GEO (generative engine optimization) visibility report.",
    "",
    `BRAND: ${subject.brandName}${aliases.length ? ` (also: ${aliases.join(", ")})` : ""}`,
    subject.brandUrl ? `BRAND SITE: ${subject.brandUrl}` : "BRAND SITE: (none)",
    `COMPETITORS: ${competitorNames.length ? competitorNames.join(", ") : "(none provided)"}`,
    "",
    "AI ANSWER TO GRADE:",
    '"""',
    responseText.slice(0, 6000),
    '"""',
    "",
    "Return ONLY a JSON object (no prose, no markdown fence) with exactly these keys:",
    "{",
    '  "brandMentioned": boolean,          // is the brand referenced at all (name or alias)?',
    '  "brandRecommended": boolean,        // does the answer actively recommend/endorse the brand (not just list it)?',
    '  "brandSentiment": "positive"|"neutral"|"negative"|null,  // tone toward the brand; null if not mentioned. Account for negation and hedging.',
    '  "brandPosition": number|null,       // rank if the answer is an ordered list/ranking (1 = first), else null',
    '  "competitorsMentioned": [ { "name": string, "mentioned": boolean, "position": number|null } ],  // one entry per competitor listed above',
    '  "citations": string[],              // every source URL the answer cites, verbatim',
    '  "brandCited": boolean,              // is the brand\'s own site among the citations?',
    '  "reasoning": string                 // one sentence explaining the grade',
    "}",
    "Judge only what the text supports. Do not invent citations. If the brand is absent, brandMentioned=false and sentiment=null.",
  ].join("\n");
}

/** Extract the first balanced JSON object from a model response (handles code
 * fences and leading prose). */
export function extractJsonObject(raw: string): string | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : raw;
  const start = candidate.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < candidate.length; i++) {
    const ch = candidate[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return candidate.slice(start, i + 1);
    }
  }
  return null;
}

const SENTIMENTS: MentionSentiment[] = ["positive", "neutral", "negative"];

/** Parse + validate a judge response into a MentionVerdict. Returns null on any
 * shape/parse failure so the caller falls back to the deterministic analyzer.
 * `knownCompetitors` guarantees one entry per configured competitor even if the
 * judge omitted some. */
export function parseMentionVerdict(
  raw: string,
  knownCompetitors: Array<{ name: string }> = [],
): MentionVerdict | null {
  const jsonStr = extractJsonObject(raw);
  if (!jsonStr) return null;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(jsonStr) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;

  const brandMentioned = parsed["brandMentioned"] === true;
  const sentimentRaw = parsed["brandSentiment"];
  const brandSentiment =
    typeof sentimentRaw === "string" && SENTIMENTS.includes(sentimentRaw as MentionSentiment)
      ? (sentimentRaw as MentionSentiment)
      : null;

  const rawCitations = parsed["citations"];
  const citations = Array.isArray(rawCitations)
    ? Array.from(new Set(rawCitations.filter((u): u is string => typeof u === "string")))
    : [];

  const rawJudged = parsed["competitorsMentioned"];
  const judged = Array.isArray(rawJudged) ? rawJudged : [];
  const byName = new Map<string, JudgeCompetitor>();
  for (const item of judged) {
    if (item && typeof item === "object") {
      const rec = item as Record<string, unknown>;
      const name = rec["name"];
      if (typeof name === "string") {
        byName.set(name.toLowerCase(), {
          name,
          mentioned: rec["mentioned"] === true,
          position: numberOrNull(rec["position"]),
        });
      }
    }
  }
  // Ensure every configured competitor is represented.
  const competitorsMentioned: JudgeCompetitor[] = knownCompetitors.length
    ? knownCompetitors.map((c) => byName.get(c.name.toLowerCase()) ?? { name: c.name, mentioned: false, position: null })
    : Array.from(byName.values());

  const reasoning = parsed["reasoning"];
  return {
    brandMentioned,
    brandRecommended: parsed["brandRecommended"] === true,
    brandSentiment: brandMentioned ? brandSentiment : null,
    brandPosition: numberOrNull(parsed["brandPosition"]),
    competitorsMentioned,
    citations,
    brandCited: parsed["brandCited"] === true,
    reasoning: typeof reasoning === "string" ? reasoning.slice(0, 500) : "",
  };
}

function numberOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
