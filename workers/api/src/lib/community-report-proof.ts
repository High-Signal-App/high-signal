import { z } from 'zod';
import { judgePublishability, rollupEvidence, type ClaimEvidenceLink } from '@high-signal/shared';

export interface CommunityResearchDocument {
  id: string;
  recordId: string;
  source: string;
  url: string;
  title: string;
  publishedAt: string;
  hash: string;
  text: string;
  passages: Record<string, string>;
  metadata: Record<string, unknown>;
}

const reportFields = {
  section: z.enum(['ideas', 'trends']),
  title: z.string().min(12).max(160),
  description: z.string().min(40).max(900),
  whyNow: z.string().min(24).max(600),
  uncertainty: z.string().min(24).max(600),
  citations: z
    .array(z.object({ documentId: z.string(), passageId: z.string() }).strict())
    .min(2)
    .max(4),
};
export const communityReportSchema = z.discriminatedUnion('publish', [
  z.object({ publish: z.literal(false), reason: z.string().min(10).max(500) }).strict(),
  z.object({ publish: z.literal(true), ...reportFields }).strict(),
]);
export type CommunityReport = Extract<z.infer<typeof communityReportSchema>, { publish: true }>;

/** Bind every published factual field to the immutable claim receipt. */
export function communityAssertion(
  report: Pick<CommunityReport, 'title' | 'description' | 'whyNow' | 'uncertainty'>
): string {
  return `${report.title}\n\n${report.description}\n\nWhy now: ${report.whyNow}\n\nUncertainty: ${report.uncertainty}`;
}

export const communityVerificationSchema = z
  .object({
    verified: z.boolean(),
    copyAligned: z.boolean(),
    evidence: z
      .array(
        z
          .object({
            documentId: z.string(),
            passageId: z.string(),
            aligned: z.boolean(),
            role: z.enum(['primary', 'corroboration', 'context', 'contradiction']),
            origin: z.string().min(3).max(200),
            supports: z.array(z.enum(['description', 'whyNow'])),
          })
          .strict()
      )
      .max(4),
  })
  .strict();
type Verification = z.infer<typeof communityVerificationSchema>;

export function communityPassages(text: string): Record<string, string> {
  const passages: Record<string, string> = {};
  const bounded = text.slice(0, 8_000);
  let cursor = 0;
  while (cursor < bounded.length) {
    let end = Math.min(cursor + 600, bounded.length);
    if (end < bounded.length) {
      const boundary = Math.max(bounded.lastIndexOf('\n', end), bounded.lastIndexOf(' ', end));
      if (boundary > cursor + 40) end = boundary;
    }
    const passage = bounded.slice(cursor, end).trim();
    if (passage.length >= 40) passages[`P${Object.keys(passages).length}`] = passage;
    cursor = end;
  }
  return passages;
}

/** Archive/aggregator observations nominate research, never supporting evidence. */
export function isCommunitySupportingDocument(document: CommunityResearchDocument): boolean {
  if (document.text.length < 500) return false;
  if (
    !/^(?:news(?::|$)|ir(?::|$)|edgar[_:]|sec-xbrl|hkex|courtlistener|legistar|openstates|regulations|us-gov|india-gov|gov-contracts|semantic-scholar)/.test(
      document.source
    )
  )
    return false;
  const metadata = JSON.stringify(document.metadata).toLowerCase();
  if (
    /attention_aggregator|"(?:evidence_tier|evidenceTier)":"derived"|"(?:confidence_contribution|confidenceContribution)":"none"/i.test(
      metadata
    )
  )
    return false;
  try {
    const url = new URL(document.url);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return false;
    if (
      !url.hostname.includes('.') ||
      /^[\d.:]+$/.test(url.hostname) ||
      /\.(?:local|internal|localhost|lan|home|onion)$/.test(url.hostname)
    )
      return false;
    if (
      [...url.searchParams.keys()].some((key) =>
        /^(?:token|access_token|api_key|auth|signature|password|secret|jwt|subscriber_id)$/i.test(
          key
        )
      )
    )
      return false;
    return !/(?:^|\.)(?:reddit\.com|redd\.it|news\.ycombinator\.com|x\.com|twitter\.com|polymarket\.com|manifold\.markets|kalshi\.com)$/.test(
      url.hostname
    );
  } catch {
    return false;
  }
}

function shingles(text: string): Set<string> {
  const words = (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).slice(0, 5_000);
  return new Set(words.slice(0, -4).map((_, i) => words.slice(i, i + 5).join(' ')));
}

function copiedOrigins(documents: CommunityResearchDocument[], origins: string[]): string[] {
  const parents = documents.map((_, i) => i);
  const root = (start: number): number => {
    let i = start;
    while (parents[i] !== i) i = parents[i];
    return i;
  };
  const texts = documents.map((document) => shingles(document.text));
  const normalized = documents.map((document) =>
    document.text.toLowerCase().replace(/\s+/g, ' ').trim()
  );
  const wire = (document: CommunityResearchDocument) =>
    document.text.match(/^\s*\((Bloomberg|Reuters)\)\s*(?:--|—|–)/i)?.[1].toLowerCase();
  const publisher = (document: CommunityResearchDocument) =>
    new URL(document.url).hostname.match(/(?:^|\.)(bloomberg|reuters)\.com$/i)?.[1].toLowerCase();
  for (let i = 0; i < documents.length; i++)
    for (let j = 0; j < i; j++) {
      const overlap = [...texts[i]].filter((word) => texts[j].has(word)).length;
      const copied = overlap >= 80 && overlap >= 0.8 * Math.min(texts[i].size, texts[j].size);
      const exact =
        normalized[i] === normalized[j] ||
        (documents[i].hash && documents[i].hash === documents[j].hash);
      const credited =
        (wire(documents[i]) &&
          [wire(documents[j]), publisher(documents[j])].includes(wire(documents[i]))) ||
        (wire(documents[j]) && publisher(documents[i]) === wire(documents[j]));
      if (origins[i] === origins[j] || exact || copied || credited) parents[root(i)] = root(j);
    }
  return origins.map((_, i) => origins[root(i)]);
}

/** Resolve supplied passage IDs against retained receipts before granting any role. */
export function communityReportProof(
  report: CommunityReport,
  verification: Verification,
  documents: CommunityResearchDocument[],
  now = new Date()
): { evidence: ClaimEvidenceLink[] } | { error: string } {
  if (!verification.verified || !verification.copyAligned)
    return { error: 'verification_declined' };
  const selected = report.citations.map((citation) =>
    documents.find((doc) => doc.id === citation.documentId)
  );
  if (selected.some((document) => !document || !isCommunitySupportingDocument(document)))
    return { error: 'unsupported_document' };
  const resolved = selected as CommunityResearchDocument[];
  if (new Set(resolved.map((doc) => doc.id)).size !== resolved.length)
    return { error: 'duplicate_document' };
  const assessments = resolved.map((doc) =>
    verification.evidence.filter((item) => item.documentId === doc.id)
  );
  if (assessments.some((items) => items.length !== 1))
    return { error: 'missing_or_duplicate_assessment' };
  if (assessments.some(([item], index) => item.passageId !== report.citations[index].passageId))
    return { error: 'unverified_passage' };
  if (assessments.some(([item]) => !item.aligned || !item.supports.includes('description')))
    return { error: 'unverified_assertion' };
  if (!assessments.some(([item]) => item.supports.includes('whyNow')))
    return { error: 'unsupported_implication' };
  const origins = copiedOrigins(
    resolved,
    assessments.map(([item]) => item.origin.trim().toLowerCase().replace(/\s+/g, ' '))
  );
  const evidence: ClaimEvidenceLink[] = [];
  for (let i = 0; i < resolved.length; i++) {
    const document = resolved[i];
    const passage = document.passages[report.citations[i].passageId];
    const date = Date.parse(document.publishedAt);
    if (
      !Number.isFinite(date) ||
      date < now.getTime() - 28 * 86_400_000 ||
      date > now.getTime() + 300_000
    )
      return { error: 'outside_research_window' };
    if (!passage || passage.length < 40 || !document.text.includes(passage))
      return { error: 'invalid_passage' };
    evidence.push({
      id: document.id,
      claimId: 'pending',
      evidenceUrl: document.url,
      sourceDocumentId: document.id,
      originatingEvidenceId: origins[i],
      semanticAlignment: 'verified',
      role: assessments[i][0].role,
      weight: 1,
      addedAt: now.toISOString(),
      addedBy: 'community-research',
      notes: JSON.stringify({
        verifier: 'community-report-v1',
        documentHash: document.hash,
        passageId: report.citations[i].passageId,
        quote: passage,
        supports: assessments[i][0].supports,
        verifiedCopy: {
          title: report.title,
          description: report.description,
          whyNow: report.whyNow,
          uncertainty: report.uncertainty,
        },
      }),
    });
  }
  const verdict = judgePublishability(rollupEvidence(evidence));
  return verdict.publishable ? { evidence } : { error: verdict.reason };
}
