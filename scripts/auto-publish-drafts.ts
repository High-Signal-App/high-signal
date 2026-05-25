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
 *   API_BASE      default https://high-signal-api.sarthakagrawal927.workers.dev
 *   ADMIN_TOKEN   required when not --dry
 *
 * Per Sarthak (2026-05-26): "I don't want it blocked by me. I want it
 * to be auto-pushed based on your judgment or whatever AI judgment we
 * install." This is that path.
 */

import { deterministicVerdict, type VerdictResult } from "./auto-publish-rules";

interface SignalRow {
  id: string;
  slug: string;
  signalType: string;
  primaryEntityId: string;
  direction: "up" | "down" | "neutral";
  confidence: "low" | "medium" | "high";
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
}

const args = new Set(process.argv.slice(2));
const REMOTE = args.has("--remote");
const DRY = args.has("--dry");
const LOCAL = !REMOTE;
/**
 * --reapply: also re-judge currently-published signals and KILL any that
 * fail the rubric. One-time cleanup mode for after a rule change.
 */
const REAPPLY_PUBLISHED = args.has("--reapply");

const API_BASE =
  process.env["API_BASE"] ??
  (LOCAL
    ? "http://127.0.0.1:8787"
    : "https://high-signal-api.sarthakagrawal927.workers.dev");
const ADMIN_TOKEN = process.env["ADMIN_TOKEN"] ?? "";
const AI_BASE_URL = process.env["AI_BASE_URL"] ?? "https://api.deepseek.com/v1";
const AI_API_KEY = process.env["AI_API_KEY"] ?? "";
const AI_MODEL = process.env["AI_MODEL"] ?? "deepseek-chat";

const MAX_BODY_CHARS = 2400;
const RATE_LIMIT_MS = 250; // gentle pacing between AI calls

async function fetchSignalsByStatus(status: "draft" | "published"): Promise<SignalRow[]> {
  const url = `${API_BASE}/signals?status=${status}&limit=500`;
  const r = await fetch(url, { cache: "no-store" } as RequestInit);
  if (!r.ok) {
    throw new Error(`${status} fetch ${r.status} from ${url}`);
  }
  const data = (await r.json()) as { signals: SignalRow[] };
  return data.signals;
}

async function patchReviewStatus(
  slug: string,
  reviewStatus: "published" | "killed",
): Promise<boolean> {
  if (DRY) return true;
  if (!ADMIN_TOKEN) {
    console.warn(`[auto-publish] dry-run: would PATCH ${slug} → ${reviewStatus} (no ADMIN_TOKEN)`);
    return false;
  }
  const r = await fetch(`${API_BASE}/admin/signals/${encodeURIComponent(slug)}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${ADMIN_TOKEN}`,
      "Content-Type": "application/json",
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

Return strict JSON: {"verdict":"publish"|"kill"|"hold","reason":"<one short sentence>"}.`;

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
    const response = await fetch(`${AI_BASE_URL.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${AI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: AI_MODEL,
        temperature: 0.1,
        max_tokens: 200,
        stream: false,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: JUDGE_SYSTEM },
          { role: "user", content: JSON.stringify(payload) },
        ],
      }),
    });
    if (!response.ok) {
      console.warn(`[auto-publish] AI ${response.status}: ${(await response.text()).slice(0, 160)}`);
      return null;
    }
    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const raw = (data.choices?.[0]?.message?.content ?? "").trim();
    if (!raw) return null;
    const trimmed = raw.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
    const parsed = JSON.parse(trimmed) as { verdict?: string; reason?: string };
    if (parsed.verdict === "publish" || parsed.verdict === "kill" || parsed.verdict === "hold") {
      return { verdict: parsed.verdict, reason: parsed.reason ?? "(no reason)", source: "ai" };
    }
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
  if (det.verdict !== "hold") return det;
  const ai = await aiVerdict(signal);
  if (ai) return ai;
  // Without AI, prefer KILL over HOLD per Sarthak's "don't block me" policy.
  return { verdict: "kill", reason: `${det.reason}; no AI available, biasing to kill`, source: "rule" };
}

async function main(): Promise<void> {
  console.log(
    `[auto-publish] target=${API_BASE} dry=${DRY} ai=${AI_API_KEY ? "yes" : "no"} reapply=${REAPPLY_PUBLISHED}`,
  );
  const drafts = await fetchSignalsByStatus("draft");
  const published = REAPPLY_PUBLISHED ? await fetchSignalsByStatus("published") : [];
  const toJudge = [...drafts, ...published];
  console.log(
    `[auto-publish] judging ${drafts.length} drafts${REAPPLY_PUBLISHED ? ` + ${published.length} already-published (reapply)` : ""}`,
  );
  if (toJudge.length === 0) return;
  const isPublished = new Set(published.map((s) => s.slug));

  let publishedCount = 0;
  let killed = 0;
  let held = 0;
  let errors = 0;

  for (const signal of toJudge) {
    let verdict: VerdictResult;
    try {
      verdict = await judge(signal);
    } catch (error) {
      console.error(`[auto-publish] judge error for ${signal.slug}:`, error);
      errors++;
      continue;
    }
    const tag = verdict.source === "ai" ? "AI " : "rul";
    const wasPublished = isPublished.has(signal.slug);
    if (verdict.verdict === "publish") {
      // Skip the PATCH if already published — no-op.
      if (wasPublished) {
        publishedCount++;
        continue;
      }
      const ok = await patchReviewStatus(signal.slug, "published");
      if (ok) publishedCount++; else errors++;
      console.log(`  [${tag}]  PUBLISH  ${signal.slug}  — ${verdict.reason}`);
    } else if (verdict.verdict === "kill") {
      const ok = await patchReviewStatus(signal.slug, "killed");
      if (ok) killed++; else errors++;
      const label = wasPublished ? "UNPUB" : "KILL";
      console.log(`  [${tag}]    ${label}  ${signal.slug}  — ${verdict.reason}`);
    } else {
      held++;
      console.log(`  [${tag}]    HOLD   ${signal.slug}  — ${verdict.reason}`);
    }
    if (AI_API_KEY) {
      await new Promise((r) => setTimeout(r, RATE_LIMIT_MS));
    }
  }

  console.log(
    `[auto-publish] done: ${publishedCount} published-or-kept / ${killed} killed / ${held} held / ${errors} errors`,
  );
  if (errors > 0) process.exit(1);
}

main().catch((error) => {
  console.error("[auto-publish] fatal:", error);
  process.exit(1);
});
