/**
 * Pure helpers for the auto-publish judge, extracted from
 * `scripts/auto-publish-drafts.ts` so they can be unit-tested without
 * importing the script's side-effects (fetch, env reads, process.exit).
 */

import {
  PREDICTION_MARKET_DOMAINS,
  isPredictionMarketOnly as isPredictionMarketOnlyUrls,
  type ClaimWithEvidence,
} from "@high-signal/shared";

export type Verdict = "publish" | "kill" | "hold";

export interface VerdictResult {
  verdict: Verdict;
  reason: string;
  source: "ai" | "rule";
}

export interface JudgeableSignal {
  evidenceUrls: string[];
  publishable?: boolean;
  independentSourceCount?: number;
  qualityReasons?: string[];
  sourceClasses?: string[];
  /**
   * The signal's prose. Used to detect evidence-stuffing — drafts where
   * the URL list contains items the body never references (the pipeline
   * sometimes attaches adjacent news by proximity rather than relevance).
   */
  bodyMd?: string;
}

export type ProvenanceSource = "structured_claims" | "legacy_signal";

/**
 * Replace legacy signal evidence metadata with the canonical claim links when
 * claim coverage exists. The legacy payload remains intact only during the
 * lazy-backfill rollout for signals that do not have a claim yet.
 */
export function applyStructuredClaimEvidence<T extends JudgeableSignal>(
  signal: T,
  claims: ClaimWithEvidence[],
): T & { provenanceSource: ProvenanceSource } {
  if (claims.length === 0) {
    return { ...signal, provenanceSource: "legacy_signal" };
  }
  const links = claims.flatMap((claim) => claim.evidence);
  const evidenceUrls = Array.from(
    new Set(links.map((link) => link.evidenceUrl).filter(Boolean)),
  );
  const hosts = new Set(evidenceUrls.map(urlHost).filter(Boolean));
  const marketOnly = isPredictionMarketOnlyUrls(evidenceUrls);
  const contradiction = links.some((link) => link.role === "contradiction");
  return {
    ...signal,
    evidenceUrls,
    independentSourceCount: hosts.size,
    sourceClasses: marketOnly ? ["market"] : [],
    publishable: contradiction ? false : signal.publishable,
    qualityReasons: contradiction
      ? [...(signal.qualityReasons ?? []), "structured_contradiction"]
      : signal.qualityReasons,
    provenanceSource: "structured_claims",
  };
}

/**
 * Below this body length we can't reliably judge whether the body
 * references each URL — skip the relevance check.
 */
export const EVIDENCE_RELEVANCE_MIN_BODY_CHARS = 400;
/**
 * Minimum fraction of evidence URLs the body must actually reference
 * (by full URL OR by a unique slug token) to be considered coherent.
 */
export const EVIDENCE_RELEVANCE_THRESHOLD = 0.5;

function uniqueSlugTokens(url: string): string[] {
  try {
    const parsed = new URL(url);
    const slug = parsed.pathname.split("/").filter(Boolean).pop() ?? "";
    return slug
      .split(/[-_]/)
      .map((token) => token.toLowerCase())
      .filter((token) => token.length >= 4)
      .slice(0, 8);
  } catch {
    return [];
  }
}

/**
 * Returns the fraction of evidence URLs the body actually references.
 * A URL counts as referenced if the full URL appears verbatim OR at
 * least one of its meaningful slug tokens (length ≥ 4) appears in the
 * body (case-insensitive). Empty evidence → 1 (vacuously true, the
 * cite-or-kill rule handles that case earlier).
 */
export function evidenceCoverage(signal: JudgeableSignal): number {
  const urls = signal.evidenceUrls ?? [];
  if (urls.length === 0) return 1;
  const body = (signal.bodyMd ?? "").toLowerCase();
  if (!body) return 1;
  let referenced = 0;
  for (const url of urls) {
    if (body.includes(url.toLowerCase())) {
      referenced++;
      continue;
    }
    const tokens = uniqueSlugTokens(url);
    if (tokens.length === 0) {
      // No meaningful slug to check — give it the benefit of the doubt.
      referenced++;
      continue;
    }
    if (tokens.some((tok) => body.includes(tok))) {
      referenced++;
    }
  }
  return referenced / urls.length;
}

// Prediction-market domains + the market-only check are the canonical
// definition in @high-signal/shared (also used by the brief composer, so a
// market-only signal that slips past this gate still can't reach the brief).
export { PREDICTION_MARKET_DOMAINS };

export function urlHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

export function isPredictionMarketOnly(signal: JudgeableSignal): boolean {
  return isPredictionMarketOnlyUrls(signal.evidenceUrls ?? []);
}

/**
 * Deterministic rubric. See script header for policy rationale.
 */
export function deterministicVerdict(signal: JudgeableSignal): VerdictResult {
  const evidence = signal.evidenceUrls?.length ?? 0;
  const independent = signal.independentSourceCount ?? 0;
  const reasons = signal.qualityReasons ?? [];
  const classes = signal.sourceClasses ?? [];

  if (evidence < 2) {
    return {
      verdict: "kill",
      reason: `only ${evidence} evidence url(s) — fails cite-or-kill`,
      source: "rule",
    };
  }

  if (reasons.includes("structured_contradiction")) {
    return {
      verdict: "kill",
      reason: "structured claim contains unresolved contradictory evidence",
      source: "rule",
    };
  }

  if (
    isPredictionMarketOnly(signal) ||
    (classes.length === 1 && classes[0] === "market")
  ) {
    return {
      verdict: "kill",
      reason: "prediction-market-only — crowd opinion, not new information",
      source: "rule",
    };
  }

  // Evidence-relevance — catches the pattern where the pipeline attaches
  // adjacent news URLs that the body never actually references, inflating
  // the independent-source-class count for free. Discovered 2026-05-26 by
  // an external reviewer who spotted a Gemini Omni signal citing
  // unrelated Samsung / Micron / Huawei SSD links as evidence.
  if (
    (signal.bodyMd ?? "").length >= EVIDENCE_RELEVANCE_MIN_BODY_CHARS &&
    evidenceCoverage(signal) < EVIDENCE_RELEVANCE_THRESHOLD
  ) {
    const pct = Math.round(evidenceCoverage(signal) * 100);
    return {
      verdict: "kill",
      reason: `evidence-stuffing — body references only ${pct}% of declared evidence URLs`,
      source: "rule",
    };
  }

  if (signal.publishable === true && independent >= 2) {
    return {
      verdict: "publish",
      reason: `pipeline blessed AND ${independent} independent source classes`,
      source: "rule",
    };
  }

  if (reasons.includes("fallback_or_backfill")) {
    return {
      verdict: "kill",
      reason: "fallback / backfill draft — pipeline flagged low confidence",
      source: "rule",
    };
  }

  if (signal.publishable === true && independent < 2) {
    return {
      verdict: "hold",
      reason: "pipeline blessed but thin corroboration — escalate to AI",
      source: "rule",
    };
  }

  if (independent >= 2 && signal.publishable === false) {
    return {
      verdict: "hold",
      reason: `${independent} independent classes but pipeline held back — escalate to AI`,
      source: "rule",
    };
  }

  return {
    verdict: "kill",
    reason: "neither pipeline blessing nor independent corroboration",
    source: "rule",
  };
}
