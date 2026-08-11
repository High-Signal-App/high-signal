// Plan 0008 — Signal Provenance Editor And Claim Ledger.
// Shared types and small pure helpers consumed by the worker, the /review
// editor, the /signals provenance tab, and the auto-publish judge.

export type ClaimSurface = 'signal' | 'brief' | 'agent_eval';

export type ClaimReviewStatus = 'draft' | 'held' | 'published' | 'killed' | 'corrected';

export type ClaimEvidenceRole = 'primary' | 'corroboration' | 'contradiction' | 'context';

export type ClaimTimelineKind =
  | 'created'
  | 'evidence_added'
  | 'evidence_removed'
  | 'status_change'
  | 'correction_filed';

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
  confidenceBand: 'low' | 'medium' | 'high';
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

export interface HistoricalClaimBackfill {
  assertion: string;
  evidence: Array<{
    url: string;
    role: 'primary' | 'context';
  }>;
}

/**
 * Build the deterministic payload used when an operator opens provenance for
 * a historical signal. Persistence and idempotency stay in the admin route;
 * keeping the derivation pure makes the import policy easy to verify.
 */
export function buildHistoricalClaimBackfill(input: {
  bodyMd: string;
  fallbackAssertion: string;
  evidenceUrls: string[];
}): HistoricalClaimBackfill {
  const firstLine = input.bodyMd
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean);
  const assertion = (firstLine?.replace(/^#+\s*/, '').trim() || input.fallbackAssertion).slice(
    0,
    500
  );
  const urls = Array.from(new Set(input.evidenceUrls.map((url) => url.trim()).filter(Boolean)));
  return {
    assertion,
    evidence: urls.map((url, index) => ({
      url,
      // URL order proves neither independence nor semantic corroboration.
      // Historical imports stay contextual until an operator/judge promotes
      // an aligned source explicitly.
      role: index === 0 ? 'primary' : 'context',
    })),
  };
}

export interface BriefClaimProvenance {
  claimId: string;
  assertion: string;
  version: number;
  evidenceCount: number;
  primaryCount: number;
  corroborationCount: number;
  contradictionCount: number;
  evidenceUrls: string[];
}

/** Pick the newest evidence-backed claim from an already newest-first list. */
export function selectBriefClaimProvenance(
  claims: ClaimWithEvidence[]
): BriefClaimProvenance | null {
  for (const claim of claims) {
    if (claim.reviewStatus !== 'published') continue;
    const rollup = rollupEvidence(claim.evidence);
    if (!judgePublishability(rollup).publishable) continue;
    const evidenceUrls = Array.from(
      new Set(
        claim.evidence
          .filter(
            (link) =>
              (link.role === 'primary' || link.role === 'corroboration') &&
              isUsableClaimEvidenceLink(link)
          )
          .map((link) => link.evidenceUrl)
      )
    );
    if (evidenceUrls.length === 0) continue;
    return {
      claimId: claim.id,
      assertion: claim.assertion,
      version: claim.version,
      evidenceCount: evidenceUrls.length,
      primaryCount: rollup.primary,
      corroborationCount: rollup.corroboration,
      contradictionCount: rollup.contradiction,
      evidenceUrls,
    };
  }
  return null;
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
  supportingHosts: string[];
  unusableSupporting: number;
}

export function isUsableClaimEvidenceLink(link: ClaimEvidenceLink): boolean {
  if (!Number.isFinite(link.weight) || link.weight <= 0) return false;
  try {
    const url = new URL(link.evidenceUrl);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
  } catch {
    return false;
  }
  const notes = link.notes ?? '';
  if (/\b(alignment:(?:unverified|rejected)|status:(?:dead|unreachable))\b/i.test(notes)) {
    return false;
  }

  // A URL alone is not a retained receipt. New supporting links must point to
  // an ingested source document; an explicit receipt marker keeps older,
  // operator-verified links compatible without pretending URL order proves
  // semantic alignment.
  const retainedReceipt = Boolean(link.sourceDocumentId) || /\breceipt:verified\b/i.test(notes);
  const aligned = /\balignment:verified\b/i.test(notes);
  return retainedReceipt && aligned;
}

export function rollupEvidence(links: ClaimEvidenceLink[]): EvidenceRollup {
  const hosts = new Set<string>();
  const supportingHosts = new Set<string>();
  const urls = new Set<string>();
  let primary = 0;
  let corroboration = 0;
  let contradiction = 0;
  let context = 0;
  let unusableSupporting = 0;
  for (const l of links) {
    urls.add(l.evidenceUrl);
    let host: string | null = null;
    try {
      host = new URL(l.evidenceUrl).host.toLowerCase();
      hosts.add(host);
    } catch {
      // Non-URL evidence (rare but allowed) — skip host bookkeeping.
    }
    const usable = isUsableClaimEvidenceLink(l);
    if (l.role === 'primary') {
      if (usable) primary++;
      else unusableSupporting++;
    } else if (l.role === 'corroboration') {
      if (usable) corroboration++;
      else unusableSupporting++;
    } else if (l.role === 'contradiction') contradiction++;
    else context++;
    if (usable && host && (l.role === 'primary' || l.role === 'corroboration')) {
      supportingHosts.add(host);
    }
  }
  return {
    total: links.length,
    primary,
    corroboration,
    contradiction,
    context,
    distinctUrls: urls.size,
    hosts: Array.from(hosts),
    supportingHosts: Array.from(supportingHosts),
    unusableSupporting,
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
export function judgePublishability(rollup: EvidenceRollup): PublishabilityVerdict {
  if (rollup.contradiction > 0) {
    return {
      publishable: false,
      reason: 'contradiction_present',
    };
  }
  if (rollup.primary < 1) {
    return { publishable: false, reason: 'no_primary_evidence' };
  }
  if (rollup.corroboration < 1) {
    return { publishable: false, reason: 'thin_corroboration' };
  }
  if (rollup.supportingHosts.length < 2) {
    return { publishable: false, reason: 'support_not_independent' };
  }
  if (rollup.unusableSupporting > 0) {
    return { publishable: false, reason: 'unusable_supporting_evidence' };
  }
  return { publishable: true, reason: 'primary_plus_corroboration' };
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
  to: ClaimReviewStatus
): ClaimStatusTransition {
  if (from === to) return { from, to, ok: false, reason: 'same_status' };
  if (from === 'published') {
    if (to === 'corrected') return { from, to, ok: true };
    return { from, to, ok: false, reason: 'publish_is_immutable' };
  }
  if (from === 'killed') {
    if (to === 'draft' || to === 'held') return { from, to, ok: true };
    return { from, to, ok: false, reason: 'killed_can_only_reopen' };
  }
  if (from === 'corrected') {
    return { from, to, ok: false, reason: 'corrected_is_terminal' };
  }
  // draft|held → anywhere except corrected (corrected is reached via the
  // correction-filing flow, not a status flip).
  if (to === 'corrected') {
    return { from, to, ok: false, reason: 'use_file_correction' };
  }
  return { from, to, ok: true };
}
