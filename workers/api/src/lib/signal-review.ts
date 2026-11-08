import { canonicalSourceUrl, type ClaimWithEvidence } from '@high-signal/shared';
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
    }
  >();
  for (const chunk of d1QueryChunks(ids)) {
    const documents = await database
      .select({
        id: schema.sourceDocuments.id,
        canonicalUrl: schema.sourceDocuments.canonicalUrl,
        rawText: schema.sourceDocuments.rawText,
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
  return retained.map((item) => {
    const matching = links.filter(
      (link) => canonicalSourceUrl(link.evidenceUrl) === canonicalSourceUrl(item.url)
    );
    const document = matching
      .map((link) => byId.get(link.sourceDocumentId ?? ''))
      .find(
        (candidate) =>
          candidate?.rawText?.trim() &&
          canonicalSourceUrl(candidate.canonicalUrl) === canonicalSourceUrl(item.url)
      );
    return {
      ...item,
      excerpt: item.excerpt?.trim()
        ? item.excerpt
        : document?.rawText?.trim().slice(0, 1_500) || null,
      sourceType: matching.some((link) => link.notes?.includes('source:techmeme'))
        ? 'techmeme'
        : item.sourceType,
    };
  });
}
