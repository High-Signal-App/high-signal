#!/usr/bin/env tsx
/**
 * AI auto-publish runner — clears the draft queue without human review.
 *
 * For every signal currently in `review_status='draft'`, asks an
 * OpenAI-compatible LLM to make one of three calls:
 *
 *   PUBLISH — corroborated by independent sources, makes a clear directional
 *             claim about a specific entity, and would not embarrass the
 *             project to ship as-is.
 *   KILL    — uncorroborated, vague, contradictory, or pure prediction-market
 *             noise. The draft gets review_status='corrected' (the closest
 *             non-published end state; the brief never reads from it).
 *   HOLD    — only for genuine uncertainty. The script biases against this.
 *
 * Auth: bearer ADMIN_TOKEN against API_BASE. Reads drafts via the public
 *       /signals?status=draft endpoint, writes via /admin/signals/<slug>.
 *
 *   pnpm tsx scripts/auto-publish-drafts.ts --remote        # production
 *   pnpm tsx scripts/auto-publish-drafts.ts --remote --dry  # plan-only
 *   pnpm tsx scripts/auto-publish-drafts.ts --local         # local worker
 *
 * Env (required for the AI call; the rest come from secrets):
 *   AI_BASE_URL   default https://api.deepseek.com/v1
 *   AI_API_KEY    required when not --dry; else the script skips the LLM
 *                 and falls back to a deterministic rubric (≥ 2 independent
 *                 source classes → publish, else kill).
 *   AI_MODEL      default deepseek-chat
 *   AI_PROJECT_ID project tag required by the free-ai gateway; defaults to
 *                 high-signal and is harmless for other OpenAI-compatible APIs
 *   API_BASE      default https://api.highsignal.app
 *   ADMIN_TOKEN   required when not --dry
 *
 * Per Sarthak (2026-05-26): "I don't want it blocked by me. I want it
 * to be auto-pushed based on your judgment or whatever AI judgment we
 * install." This is that path.
 */

import {
  applyStructuredClaimEvidence,
  dateKeyInTimeZone,
  deterministicVerdict,
  parseAiVerdictResponse,
  type VerdictResult,
} from './auto-publish-rules';
import {
  judgePublishability,
  oppositeDirectionConflictIds,
  rollupEvidence,
  type ClaimWithEvidence,
} from '@high-signal/shared';

interface SignalRow {
  id: string;
  slug: string;
  signalType: string;
  primaryEntityId: string;
  direction: 'up' | 'down' | 'neutral';
  confidence: 'low' | 'medium' | 'high';
  predictedWindowDays: number;
  publishedAt: string;
  evidenceUrls: string[];
  bodyMd: string;
  qualityScore?: number;
  qualityBand?: string;
  publishable?: boolean;
  sourceClasses?: string[];
  independentSourceCount?: number;
  qualityReasons?: string[];
  oppositeDirectionConflict?: boolean;
}

const args = new Set(process.argv.slice(2));
const REMOTE = args.has('--remote');
const DRY = args.has('--dry');
const LOCAL = !REMOTE;
/**
 * --reapply: also re-judge currently-published signals and KILL any that
 * fail the rubric. One-time cleanup mode for after a rule change.
 */
const REAPPLY_PUBLISHED = args.has('--reapply');
/** Re-judge only killed rows whose signal date is today in IST. */
const RETRY_KILLED_TODAY = args.has('--retry-killed-today');

const API_BASE =
  process.env['API_BASE'] ?? (LOCAL ? 'http://127.0.0.1:8787' : 'https://api.highsignal.app');
const ADMIN_TOKEN = process.env['ADMIN_TOKEN'] ?? '';
const AI_BASE_URL = process.env['AI_BASE_URL'] ?? 'https://api.deepseek.com/v1';
const AI_API_KEY = process.env['AI_API_KEY'] ?? '';
const AI_MODEL = process.env['AI_MODEL'] ?? 'deepseek-chat';
const AI_PROJECT_ID = process.env['AI_PROJECT_ID'] ?? 'high-signal';

const MAX_BODY_CHARS = 2400;
const MAX_AI_RESPONSE_TOKENS = 800;
const RATE_LIMIT_MS = 250; // gentle pacing between AI calls

async function fetchSignalsByStatus(
  status: 'draft' | 'published' | 'killed'
): Promise<SignalRow[]> {
  const url = ADMIN_TOKEN
    ? `${API_BASE}/admin/signals-review?status=${status}`
    : `${API_BASE}/signals?status=${status}&limit=200`;
  const r = await fetch(url, {
    cache: 'no-store',
    headers: ADMIN_TOKEN ? { Authorization: `Bearer ${ADMIN_TOKEN}` } : undefined,
  } as RequestInit);
  if (!r.ok) {
    throw new Error(`${status} fetch ${r.status} from ${url}`);
  }
  const data = (await r.json()) as { signals: SignalRow[] };
  return data.signals;
}

async function fetchClaimsBySignal(slug: string): Promise<ClaimWithEvidence[]> {
  const url = `${API_BASE}/claims/by-signal/${encodeURIComponent(slug)}`;
  try {
    const response = await fetch(url, { cache: 'no-store' } as RequestInit);
    if (!response.ok) {
      console.warn(
        `[auto-publish] claim lookup ${response.status} for ${slug}; using legacy evidence`
      );
      return [];
    }
    const payload = (await response.json()) as { claims?: ClaimWithEvidence[] };
    return payload.claims ?? [];
  } catch (error) {
    console.warn(`[auto-publish] claim lookup failed for ${slug}; using legacy evidence`, error);
    return [];
  }
}

async function patchReviewStatus(
  slug: string,
  reviewStatus: 'published' | 'killed'
): Promise<boolean> {
  if (DRY) return true;
  if (!ADMIN_TOKEN) {
    console.warn(`[auto-publish] dry-run: would PATCH ${slug} → ${reviewStatus} (no ADMIN_TOKEN)`);
    return false;
  }
  const r = await fetch(`${API_BASE}/admin/signals/${encodeURIComponent(slug)}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${ADMIN_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ reviewStatus }),
  });
  if (!r.ok) {
    const text = await r.text();
    console.error(`[auto-publish] PATCH ${slug} → ${reviewStatus} FAILED (${r.status}): ${text}`);
    return false;
  }
  return true;
}

type EvidenceAssessment = NonNullable<VerdictResult['evidenceAssessments']>[number];
type StructuredEvidence = {
  url: string;
  role: 'primary' | 'corroboration' | 'context';
  assessment?: EvidenceAssessment;
};

function buildStructuredEvidence(signal: SignalRow, verdict: VerdictResult): StructuredEvidence[] {
  const assessments = new Map(verdict.evidenceAssessments?.map((item) => [item.url, item]) ?? []);
  let primaryOrigin: string | null = null;
  return signal.evidenceUrls.map((url) => {
    const assessment = assessments.get(url);
    if (!assessment?.aligned || !assessment.originatingEvidenceId) {
      return { url, role: 'context', assessment };
    }
    if (!primaryOrigin) {
      primaryOrigin = assessment.originatingEvidenceId;
      return { url, role: 'primary', assessment };
    }
    const role = assessment.originatingEvidenceId === primaryOrigin ? 'context' : 'corroboration';
    return { url, role, assessment };
  });
}

function distinctAlignedOrigins(evidence: StructuredEvidence[]): number {
  return new Set(
    evidence
      .filter((link) => link.assessment?.aligned)
      .map((link) => link.assessment?.originatingEvidenceId)
      .filter(Boolean)
  ).size;
}

function structuredEvidenceNotes(role: StructuredEvidence['role']): string {
  return role === 'primary' || role === 'corroboration'
    ? 'receipt:verified alignment:verified verifier:auto-publish-semantic-judge'
    : 'alignment:rejected verifier:auto-publish-semantic-judge';
}

function signalAssertion(signal: SignalRow): string {
  for (const line of signal.bodyMd.split('\n')) {
    const assertion = line.replace(/^#+\s*/, '').trim();
    if (assertion) return assertion;
  }
  return signal.slug.replaceAll('-', ' ');
}

function createdClaimReceipt(input: {
  id: string;
  signal: SignalRow;
  verdict: VerdictResult;
  assertion: string;
  evidence: StructuredEvidence[];
}): ClaimWithEvidence {
  const { id, signal, verdict, assertion, evidence } = input;
  const tuple = verdict.claimTuple!;
  const createdAt = new Date().toISOString();
  return {
    id,
    signalId: signal.id,
    briefItemId: null,
    agentEvalResponseId: null,
    surface: 'signal',
    assertion,
    confidenceBand: signal.confidence,
    reviewStatus: 'draft',
    publishReason: null,
    parentClaimId: null,
    version: 1,
    createdAt,
    publishedAt: null,
    correctedAt: null,
    claimEntityId: tuple.entity,
    claimEvent: tuple.event,
    claimAmount: tuple.amount,
    claimDate: tuple.date,
    claimDirection: tuple.direction,
    claimTupleKey: [
      tuple.entity,
      tuple.event,
      tuple.amount ?? '',
      tuple.date,
      tuple.direction,
    ].join('|'),
    evidence: evidence.map((link, index) => ({
      id: `${id}:created:${index}`,
      claimId: id,
      evidenceUrl: link.url,
      sourceDocumentId: null,
      originatingEvidenceId: link.assessment?.originatingEvidenceId ?? null,
      semanticAlignment: link.assessment?.aligned ? 'verified' : 'rejected',
      role: link.role,
      weight: 1,
      notes: structuredEvidenceNotes(link.role),
      addedAt: createdAt,
      addedBy: null,
    })),
  };
}

async function createStructuredClaim(
  signal: SignalRow,
  verdict: VerdictResult
): Promise<ClaimWithEvidence | null> {
  if (DRY || !ADMIN_TOKEN) return null;
  if (verdict.source !== 'ai' || !verdict.evidenceAssessments || !verdict.claimTuple) return null;
  const evidence = buildStructuredEvidence(signal, verdict);
  if (distinctAlignedOrigins(evidence) < 2) return null;
  const assertion = signalAssertion(signal);
  const response = await fetch(`${API_BASE}/admin/claims`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ADMIN_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      surface: 'signal',
      signalId: signal.id,
      assertion,
      confidenceBand: signal.confidence,
      claimTuple: verdict.claimTuple,
      evidence: evidence.map((link) => ({
        url: link.url,
        role: link.role,
        originatingEvidenceId: link.assessment?.originatingEvidenceId,
        semanticAlignment: link.assessment?.aligned ? 'verified' : 'rejected',
        notes: structuredEvidenceNotes(link.role),
      })),
    }),
  });
  if (!response.ok) {
    console.error(
      `[auto-publish] claim create ${signal.slug} FAILED (${response.status}): ${(await response.text()).slice(0, 240)}`
    );
    return null;
  }
  const payload = (await response.json()) as { id?: string };
  if (!payload.id) return null;

  // The POST succeeded, so use that receipt immediately. A follow-up public
  // read can be briefly stale at the edge and previously made this run report
  // an error even though the claim and its evidence had been persisted.
  return createdClaimReceipt({ id: payload.id, signal, verdict, assertion, evidence });
}

async function publishEligibleClaim(claims: ClaimWithEvidence[]): Promise<boolean> {
  const eligible = claims.find(
    (claim) => judgePublishability(rollupEvidence(claim.evidence)).publishable
  );
  if (!eligible) return false;
  if (eligible.reviewStatus === 'published' || DRY) return true;
  const response = await fetch(
    `${API_BASE}/admin/claims/${encodeURIComponent(eligible.id)}/status`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ADMIN_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        status: 'published',
        reason: 'auto_publish_rubric_passed',
      }),
    }
  );
  if (!response.ok) {
    console.error(
      `[auto-publish] claim publish ${eligible.id} FAILED (${response.status}): ${(await response.text()).slice(0, 240)}`
    );
    return false;
  }
  return true;
}

function hasPublishableClaim(claims: ClaimWithEvidence[]): boolean {
  return claims.some((claim) => judgePublishability(rollupEvidence(claim.evidence)).publishable);
}

// Pure helpers live in ./auto-publish-rules.ts so they're testable without
// the script's side-effects. SignalRow's surface is a superset of
// JudgeableSignal so we can pass it straight through to deterministicVerdict.

const JUDGE_SYSTEM = `You are the final gate on the High Signal Daily Brief. \
You decide whether a draft signal SHIPS, gets KILLED, or HOLDS.

Hard rules:
1. Cite or kill — at least two independent sources (different domains AND \
different source classes) required to ship.
2. The signal must make a clear directional claim about a specific entity over \
a specific window. Vague "things may happen" content is KILL.
3. Prediction-market-only drafts (Manifold, Polymarket, Kalshi alone) without \
news/IR/SEC/blog corroboration are KILL — markets reflect crowd opinion, not \
new information.
4. Evidence-relevance — every URL in the evidence list must be substantively \
about the signal's claim. Drafts whose body cites only some URLs while the \
rest are adjacent-news-stuffing (e.g. a Google/Gemini signal with Samsung SSD \
links) are KILL. Don't count noise as corroboration.
5. Hedge with low confidence is fine. Empty content is not.
6. Bias toward decision. Only HOLD when the evidence genuinely splits — never \
as a comfortable middle ground.

When and only when verdict is publish, also return:
- claimTuple: {entity,event,amount,date,direction}
- evidenceAssessments: one row per evidence URL with {url,aligned,originatingEvidenceId}
Use the SAME originatingEvidenceId when several publishers repeat one original report.
Different hosts are not independent unless their originating evidence differs.

Return strict JSON.`;

async function aiVerdict(signal: SignalRow): Promise<VerdictResult | null> {
  if (!AI_API_KEY || DRY) return null;
  const payload = {
    signalType: signal.signalType,
    primaryEntity: signal.primaryEntityId,
    direction: signal.direction,
    confidence: signal.confidence,
    windowDays: signal.predictedWindowDays,
    evidenceUrls: signal.evidenceUrls.slice(0, 8),
    sourceClasses: signal.sourceClasses ?? [],
    independentSourceCount: signal.independentSourceCount ?? 0,
    qualityReasons: signal.qualityReasons ?? [],
    qualityScore: signal.qualityScore ?? null,
    body: signal.bodyMd.slice(0, MAX_BODY_CHARS),
  };
  try {
    const response = await fetch(`${AI_BASE_URL.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${AI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: AI_MODEL,
        project_id: AI_PROJECT_ID,
        temperature: 0.1,
        // A publish verdict includes a claim tuple plus one assessment per URL;
        // 200 tokens truncated otherwise-valid JSON in production.
        max_tokens: MAX_AI_RESPONSE_TOKENS,
        stream: false,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: JUDGE_SYSTEM },
          { role: 'user', content: JSON.stringify(payload) },
        ],
      }),
    });
    if (!response.ok) {
      console.warn(
        `[auto-publish] AI ${response.status}: ${(await response.text()).slice(0, 160)}`
      );
      return null;
    }
    const data = (await response.json()) as unknown;
    const parsed = parseAiVerdictResponse(data);
    if (parsed) return parsed;
    const keys =
      data && typeof data === 'object' ? Object.keys(data).slice(0, 8).join(',') : 'none';
    console.warn(`[auto-publish] AI response could not be parsed for ${signal.slug}; keys=${keys}`);
    return null;
  } catch (error) {
    console.warn(`[auto-publish] AI exception on ${signal.slug}:`, error);
    return null;
  }
}

async function judge(signal: SignalRow): Promise<VerdictResult> {
  const det = deterministicVerdict(signal);
  // If the deterministic rubric is decisive (publish or kill), take it.
  // Reserve the AI call for the genuinely-borderline 'hold' band.
  if (det.verdict !== 'hold') return det;
  const ai = await aiVerdict(signal);
  if (ai) return ai;
  // Without AI, prefer KILL over HOLD per Sarthak's "don't block me" policy.
  return {
    verdict: 'kill',
    reason: `${det.reason}; no AI available, biasing to kill`,
    source: 'rule',
  };
}

async function main(): Promise<void> {
  console.log(
    `[auto-publish] target=${API_BASE} dry=${DRY} ai=${AI_API_KEY ? 'yes' : 'no'} reapply=${REAPPLY_PUBLISHED} retryKilledToday=${RETRY_KILLED_TODAY}`
  );
  const drafts = await fetchSignalsByStatus('draft');
  const published = await fetchSignalsByStatus('published');
  const killedRows = RETRY_KILLED_TODAY ? await fetchSignalsByStatus('killed') : [];
  const todayIst = dateKeyInTimeZone(new Date());
  const killedToday = killedRows.filter(
    (signal) => todayIst && dateKeyInTimeZone(signal.publishedAt) === todayIst
  );
  const toJudge = REAPPLY_PUBLISHED
    ? [...drafts, ...published]
    : RETRY_KILLED_TODAY
      ? [...drafts, ...killedToday]
      : drafts;
  const conflicts = oppositeDirectionConflictIds([...drafts, ...published, ...killedToday]);
  for (const signal of toJudge) signal.oppositeDirectionConflict = conflicts.has(signal.id);
  console.log(
    `[auto-publish] judging ${drafts.length} drafts${REAPPLY_PUBLISHED ? ` + ${published.length} already-published (reapply)` : ''}${RETRY_KILLED_TODAY ? ` + ${killedToday.length} killed today in IST (retry)` : ''}`
  );
  if (toJudge.length === 0) return;
  const isPublished = new Set(published.map((s) => s.slug));

  let publishedCount = 0;
  let killed = 0;
  let held = 0;
  let errors = 0;

  for (const signal of toJudge) {
    let verdict: VerdictResult;
    let claims = await fetchClaimsBySignal(signal.slug);
    let judgeable = hasPublishableClaim(claims)
      ? applyStructuredClaimEvidence(signal, claims)
      : { ...signal, provenanceSource: 'legacy_signal' as const };
    try {
      verdict = await judge(judgeable);
    } catch (error) {
      console.error(`[auto-publish] judge error for ${signal.slug}:`, error);
      errors++;
      continue;
    }
    let tag = verdict.source === 'ai' ? 'AI ' : 'rul';
    let provenanceTag = judgeable.provenanceSource === 'structured_claims' ? 'claims' : 'legacy';
    const wasPublished = isPublished.has(signal.slug);
    if (verdict.verdict === 'publish') {
      if (!hasPublishableClaim(claims) && !DRY) {
        const createdClaim = await createStructuredClaim(signal, verdict);
        if (!createdClaim) {
          console.error(
            `  [${tag}/legacy]    ERROR  ${signal.slug} — could not create claim receipt`
          );
          errors++;
          continue;
        }
        claims = [createdClaim, ...claims];
        judgeable = applyStructuredClaimEvidence(signal, claims);
        verdict = await judge(judgeable);
        tag = verdict.source === 'ai' ? 'AI ' : 'rul';
        provenanceTag = judgeable.provenanceSource === 'structured_claims' ? 'claims' : 'legacy';
        if (verdict.verdict !== 'publish') {
          const ok = await patchReviewStatus(signal.slug, 'killed');
          if (ok) killed++;
          else errors++;
          const label = wasPublished ? 'UNPUB' : 'KILL';
          console.log(
            `  [${tag}/${provenanceTag}]    ${label}  ${signal.slug} — structured claim re-check: ${verdict.reason}`
          );
          continue;
        }
      }
      if (!DRY && !(await publishEligibleClaim(claims))) {
        console.error(
          `  [${tag}/claims]    ERROR  ${signal.slug} — no publishable structured claim receipt`
        );
        errors++;
        continue;
      }
      // Skip the PATCH if already published — no-op.
      if (wasPublished) {
        publishedCount++;
        continue;
      }
      const ok = await patchReviewStatus(signal.slug, 'published');
      if (ok) publishedCount++;
      else errors++;
      console.log(`  [${tag}/${provenanceTag}]  PUBLISH  ${signal.slug}  — ${verdict.reason}`);
    } else if (verdict.verdict === 'kill') {
      const ok = await patchReviewStatus(signal.slug, 'killed');
      if (ok) killed++;
      else errors++;
      const label = wasPublished ? 'UNPUB' : 'KILL';
      console.log(`  [${tag}/${provenanceTag}]    ${label}  ${signal.slug}  — ${verdict.reason}`);
    } else {
      held++;
      console.log(`  [${tag}/${provenanceTag}]    HOLD   ${signal.slug}  — ${verdict.reason}`);
    }
    if (AI_API_KEY) {
      await new Promise((r) => setTimeout(r, RATE_LIMIT_MS));
    }
  }

  console.log(
    `[auto-publish] done: ${publishedCount} published-or-kept / ${killed} killed / ${held} held / ${errors} errors`
  );
  if (errors > 0) process.exit(1);
}

main().catch((error) => {
  console.error('[auto-publish] fatal:', error);
  process.exit(1);
});
