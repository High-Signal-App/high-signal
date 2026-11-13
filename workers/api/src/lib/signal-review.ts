import {
  canonicalSourceUrl,
  isContextOnlyEvidenceSource,
  type ClaimWithEvidence,
} from '@high-signal/shared';
import { eq, inArray } from 'drizzle-orm';
import { db, schema } from '../db';
import { d1QueryChunks } from './signal-quality';

/** Recover legacy excerpt gaps only from the citation's linked, retained original. */
export async function loadSignalReviewEvidence(
  d1: D1Database,
  signalId: string,
  claims: ClaimWithEvidence[]
) {
  const database = db(d1);
  const links = claims.flatMap((claim) => claim.evidence);
  const ids = [
    ...new Set(links.flatMap((link) => (link.sourceDocumentId ? [link.sourceDocumentId] : []))),
  ];
  const byId = new Map<
    string,
    {
      id: string;
      canonicalUrl: string;
      rawText: string | null;
      source: string;
      parsedFields: unknown;
    }
  >();
  for (const chunk of d1QueryChunks(ids)) {
    const documents = await database
      .select({
        id: schema.sourceDocuments.id,
        canonicalUrl: schema.sourceDocuments.canonicalUrl,
        rawText: schema.sourceDocuments.rawText,
        source: schema.sourceDocuments.source,
        parsedFields: schema.sourceDocuments.parsedFields,
      })
      .from(schema.sourceDocuments)
      .where(inArray(schema.sourceDocuments.id, chunk));
    for (const document of documents) byId.set(document.id, document);
  }
  const retained = await database
    .select({
      url: schema.evidence.url,
      excerpt: schema.evidence.excerpt,
      sourceType: schema.evidence.sourceType,
    })
    .from(schema.evidence)
    .where(eq(schema.evidence.signalId, signalId));
  const reviewed = retained.map((item) => {
    const matching = links.filter(
      (link) => canonicalSourceUrl(link.evidenceUrl) === canonicalSourceUrl(item.url)
    );
    const documents = matching.flatMap((link) => {
      const document = byId.get(link.sourceDocumentId ?? '');
      return document ? [document] : [];
    });
    const matchingDocuments = documents.filter(
      (candidate) => canonicalSourceUrl(candidate.canonicalUrl) === canonicalSourceUrl(item.url)
    );
    const document = matchingDocuments.find((candidate) => candidate.rawText?.trim());
    const contextOnly = matchingDocuments.some((candidate) =>
      isContextOnlyEvidenceSource(candidate.source, candidate.rawText, candidate.parsedFields)
    );
    return {
      evidence: {
        ...item,
        ...(contextOnly ? { contextOnly: true } : {}),
        excerpt: item.excerpt?.trim()
          ? item.excerpt
          : document?.rawText?.trim().slice(0, 1_500) || null,
        sourceType: matching.some((link) => link.notes?.includes('source:techmeme'))
          ? 'techmeme'
          : item.sourceType,
      },
      coverage: {
        url: item.url,
        legacyText: Boolean(item.excerpt?.trim()),
        linked: matching.some((link) => link.sourceDocumentId),
        documentPresent: documents.length > 0,
        canonicalMatch: matchingDocuments.length > 0,
        retainedText: Boolean(document),
      },
    };
  });
  return {
    evidence: reviewed.map((item) => item.evidence),
    evidenceCoverage: reviewed.map((item) => item.coverage),
  };
}
