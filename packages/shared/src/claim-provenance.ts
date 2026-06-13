// Plan 0008 — Signal Provenance Editor And Claim Ledger.
// Shared types and small pure helpers consumed by the worker, the /review
// editor, the /signals provenance tab, and the auto-publish judge.

export type ClaimSurface = "signal" | "brief" | "agent_eval";

export type ClaimReviewStatus =
  | "draft"
  | "held"
  | "published"
  | "killed"
  | "corrected";

export type ClaimEvidenceRole =
  | "primary"
  | "corroboration"
  | "contradiction"
  | "context";

export type ClaimTimelineKind =
  | "created"
  | "evidence_added"
  | "evidence_removed"
  | "status_change"
  | "correction_filed";

export interface ClaimEvidenceLink {
  id: string;
  claimId: string;
  evidenceUrl: string;
  sourceDocumentId: string | null;
  role: ClaimEvidenceRole;
  weight: number;
  notes: string | null;
  addedAt: string;
  addedBy: string | null;
}

export interface ClaimTimelineEvent {
  id: string;
  claimId: string;
  kind: ClaimTimelineKind;
  payload: Record<string, unknown>;
  actor: string | null;
  createdAt: string;
}

export interface ClaimRecord {
  id: string;
  signalId: string | null;
  briefItemId: string | null;
  agentEvalResponseId: string | null;
  surface: ClaimSurface;
  assertion: string;
  confidenceBand: "low" | "medium" | "high";
  reviewStatus: ClaimReviewStatus;
  publishReason: string | null;
  parentClaimId: string | null;
  version: number;
  createdAt: string;
  publishedAt: string | null;
  correctedAt: string | null;
}

export interface ClaimWithEvidence extends ClaimRecord {
  evidence: ClaimEvidenceLink[];
}

export interface ClaimDetail extends ClaimWithEvidence {
  timeline: ClaimTimelineEvent[];
}

// ─── Rollup helpers ────────────────────────────────────────────────────────
// Every helper is pure and operates on already-fetched evidence-link rows so
// the worker, the auto-publish judge, and React server components can share
// the same definitions of "publishable" and "contradicted".

export interface EvidenceRollup {
  total: number;
  primary: number;
  corroboration: number;
  contradiction: number;
  context: number;
  distinctUrls: number;
  hosts: string[];
}

export function rollupEvidence(links: ClaimEvidenceLink[]): EvidenceRollup {
  const hosts = new Set<string>();
  const urls = new Set<string>();
  let primary = 0;
  let corroboration = 0;
  let contradiction = 0;
  let context = 0;
  for (const l of links) {
    urls.add(l.evidenceUrl);
    try {
      hosts.add(new URL(l.evidenceUrl).host);
    } catch {
      // Non-URL evidence (rare but allowed) — skip host bookkeeping.
    }
    if (l.role === "primary") primary++;
    else if (l.role === "corroboration") corroboration++;
    else if (l.role === "contradiction") contradiction++;
    else context++;
  }
  return {
    total: links.length,
    primary,
    corroboration,
    contradiction,
    context,
    distinctUrls: urls.size,
    hosts: Array.from(hosts),
  };
}

export interface PublishabilityVerdict {
  publishable: boolean;
  reason: string;
}

// Cite-or-kill, but operating on link roles instead of free-form arrays. A
// primary link by itself is not enough; we need at least two weight-bearing
// links (primary + corroboration). Contradiction blocks publish until the
// reviewer resolves it.
export function judgePublishability(
  rollup: EvidenceRollup,
): PublishabilityVerdict {
  const supporting = rollup.primary + rollup.corroboration;
  if (rollup.contradiction > 0) {
    return {
      publishable: false,
      reason: "contradiction_present",
    };
  }
  if (rollup.primary < 1) {
    return { publishable: false, reason: "no_primary_evidence" };
  }
  if (supporting < 2) {
    return { publishable: false, reason: "thin_corroboration" };
  }
  // At least one independent host helps avoid single-source bias.
  return { publishable: true, reason: "primary_plus_corroboration" };
}

// Valid claim-status transitions for the /review editor. Kept lax enough that
// reviewers can correct missteps but tight enough to refuse e.g. published →
// draft (use corrections instead).
export type ClaimStatusTransition = {
  from: ClaimReviewStatus;
  to: ClaimReviewStatus;
  ok: boolean;
  reason?: string;
};

export function canTransition(
  from: ClaimReviewStatus,
  to: ClaimReviewStatus,
): ClaimStatusTransition {
  if (from === to) return { from, to, ok: false, reason: "same_status" };
  if (from === "published") {
    if (to === "corrected") return { from, to, ok: true };
    return { from, to, ok: false, reason: "publish_is_immutable" };
  }
  if (from === "killed") {
    if (to === "draft" || to === "held") return { from, to, ok: true };
    return { from, to, ok: false, reason: "killed_can_only_reopen" };
  }
  if (from === "corrected") {
    return { from, to, ok: false, reason: "corrected_is_terminal" };
  }
  // draft|held → anywhere except corrected (corrected is reached via the
  // correction-filing flow, not a status flip).
  if (to === "corrected") {
    return { from, to, ok: false, reason: "use_file_correction" };
  }
  return { from, to, ok: true };
}
