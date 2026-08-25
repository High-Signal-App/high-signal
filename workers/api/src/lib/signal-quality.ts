import {
  assessSignalQuality,
  judgePublishability,
  oppositeDirectionConflictIds,
  rollupEvidence,
  type ClaimEvidenceLink,
} from '@high-signal/shared';
import { and, eq, inArray } from 'drizzle-orm';
import { db, schema } from '../db';

interface PublicationContext {
  oppositeDirectionConflict?: boolean;
  unresolvedContradictions?: number;
  semanticOrigins?: string[];
  requireSemanticOrigins?: boolean;
}

export function serializeClaimEvidenceLink(
  link: typeof schema.claimEvidenceLinks.$inferSelect
): ClaimEvidenceLink {
  return {
    id: link.id,
    claimId: link.claimId,
    evidenceUrl: link.evidenceUrl,
    sourceDocumentId: link.sourceDocumentId ?? null,
    originatingEvidenceId: link.originatingEvidenceId ?? null,
    semanticAlignment: link.semanticAlignment,
    role: link.role,
    weight: link.weight,
    notes: link.notes ?? null,
    addedAt: link.addedAt.toISOString(),
    addedBy: link.addedBy ?? null,
  };
}

export function enrichSignal<T extends typeof schema.signals.$inferSelect>(
  signal: T,
  context: PublicationContext = {}
) {
  const quality = assessSignalQuality({
    signalType: signal.signalType,
    primaryEntityId: signal.primaryEntityId,
    confidence: signal.confidence,
    evidenceUrls: (signal.evidenceUrls ?? []) as string[],
    bodyMd: signal.bodyMd,
    direction: signal.direction,
    publishedAt: signal.publishedAt,
    oppositeDirectionConflict: context.oppositeDirectionConflict,
    unresolvedContradictions: context.unresolvedContradictions,
    semanticOrigins: context.semanticOrigins,
    requireSemanticOrigins: context.requireSemanticOrigins,
  });
  return {
    ...signal,
    contentCategory: quality.contentCategory,
    qualityScore: quality.score,
    qualityBand: quality.band,
    publishable: quality.publishable,
    sourceClasses: quality.sourceClasses,
    independentSourceCount: quality.independentSourceCount,
    qualityReasons: quality.reasons,
  };
}

export function enrichSignals<T extends typeof schema.signals.$inferSelect>(signals: T[]) {
  const conflicts = oppositeDirectionConflictIds(signals);
  return signals.map((signal) =>
    enrichSignal(signal, { oppositeDirectionConflict: conflicts.has(signal.id) })
  );
}

/** Enrich public rows with the same published claim receipts used by the brief. */
export async function enrichPublishedSignals<T extends typeof schema.signals.$inferSelect>(
  d1: D1Database,
  signals: T[]
) {
  const conflicts = oppositeDirectionConflictIds(signals);
  const signalIds = signals.map((signal) => signal.id);
  if (signalIds.length === 0) return [];
  const database = db(d1);
  const claims = await database
    .select()
    .from(schema.claimRecords)
    .where(
      and(
        inArray(schema.claimRecords.signalId, signalIds),
        eq(schema.claimRecords.reviewStatus, 'published')
      )
    );
  const claimIds = claims.map((claim) => claim.id);
  const links = claimIds.length
    ? await database
        .select()
        .from(schema.claimEvidenceLinks)
        .where(inArray(schema.claimEvidenceLinks.claimId, claimIds))
    : [];
  const linksByClaim = new Map<string, ClaimEvidenceLink[]>();
  for (const link of links) {
    const list = linksByClaim.get(link.claimId) ?? [];
    list.push(serializeClaimEvidenceLink(link));
    linksByClaim.set(link.claimId, list);
  }
  const contexts = new Map<
    string,
    Pick<PublicationContext, 'semanticOrigins' | 'unresolvedContradictions'>
  >();
  for (const claim of claims) {
    if (!claim.signalId) continue;
    const rollup = rollupEvidence(linksByClaim.get(claim.id) ?? []);
    const current = contexts.get(claim.signalId) ?? {
      semanticOrigins: undefined,
      unresolvedContradictions: 0,
    };
    current.unresolvedContradictions = Math.max(
      current.unresolvedContradictions ?? 0,
      rollup.contradiction
    );
    if (judgePublishability(rollup).publishable) current.semanticOrigins = rollup.supportingOrigins;
    contexts.set(claim.signalId, current);
  }
  return signals.map((signal) => {
    const claimContext = contexts.get(signal.id);
    return enrichSignal(signal, {
      oppositeDirectionConflict: conflicts.has(signal.id),
      unresolvedContradictions: claimContext?.unresolvedContradictions ?? 0,
      semanticOrigins: claimContext?.semanticOrigins,
      requireSemanticOrigins: true,
    });
  });
}
