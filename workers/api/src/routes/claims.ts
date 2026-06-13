// Plan 0008 — public read surface for the claim ledger.
// Writes live in routes/admin.ts (under /admin/claims/*) so the existing
// Clerk-fronted /api/admin proxy applies.

import { Hono } from "hono";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import {
  rollupEvidence,
  type ClaimDetail,
  type ClaimRecord,
  type ClaimEvidenceLink,
  type ClaimTimelineEvent,
} from "@high-signal/shared";
import { db, schema } from "../db";

type Env = { DB: D1Database };

export const claimsRoute = new Hono<{ Bindings: Env }>();

function toClaim(row: typeof schema.claimRecords.$inferSelect): ClaimRecord {
  return {
    id: row.id,
    signalId: row.signalId ?? null,
    briefItemId: row.briefItemId ?? null,
    agentEvalResponseId: row.agentEvalResponseId ?? null,
    surface: row.surface,
    assertion: row.assertion,
    confidenceBand: row.confidenceBand,
    reviewStatus: row.reviewStatus,
    publishReason: row.publishReason ?? null,
    parentClaimId: row.parentClaimId ?? null,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
    correctedAt: row.correctedAt ? row.correctedAt.toISOString() : null,
  };
}

function toEvidence(
  row: typeof schema.claimEvidenceLinks.$inferSelect,
): ClaimEvidenceLink {
  return {
    id: row.id,
    claimId: row.claimId,
    evidenceUrl: row.evidenceUrl,
    sourceDocumentId: row.sourceDocumentId ?? null,
    role: row.role,
    weight: row.weight,
    notes: row.notes ?? null,
    addedAt: row.addedAt.toISOString(),
    addedBy: row.addedBy ?? null,
  };
}

function toTimeline(
  row: typeof schema.claimTimelineEvents.$inferSelect,
): ClaimTimelineEvent {
  return {
    id: row.id,
    claimId: row.claimId,
    kind: row.kind,
    payload: (row.payload as Record<string, unknown>) ?? {},
    actor: row.actor ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

async function loadClaimDetail(d1: D1Database, claimId: string): Promise<ClaimDetail | null> {
  const [claim] = await db(d1)
    .select()
    .from(schema.claimRecords)
    .where(eq(schema.claimRecords.id, claimId))
    .limit(1);
  if (!claim) return null;
  const evidence = await db(d1)
    .select()
    .from(schema.claimEvidenceLinks)
    .where(eq(schema.claimEvidenceLinks.claimId, claimId))
    .orderBy(asc(schema.claimEvidenceLinks.addedAt));
  const timeline = await db(d1)
    .select()
    .from(schema.claimTimelineEvents)
    .where(eq(schema.claimTimelineEvents.claimId, claimId))
    .orderBy(asc(schema.claimTimelineEvents.createdAt));
  return {
    ...toClaim(claim),
    evidence: evidence.map(toEvidence),
    timeline: timeline.map(toTimeline),
  };
}

claimsRoute.get("/:id", async (c) => {
  const detail = await loadClaimDetail(c.env.DB, c.req.param("id"));
  if (!detail) return c.json({ error: "not_found" }, 404);
  return c.json({ claim: detail, rollup: rollupEvidence(detail.evidence) });
});

// List claims attached to a signal slug. Used by /signals/[slug] provenance tab.
claimsRoute.get("/by-signal/:slug", async (c) => {
  const slug = c.req.param("slug");
  const [signal] = await db(c.env.DB)
    .select({ id: schema.signals.id })
    .from(schema.signals)
    .where(eq(schema.signals.slug, slug))
    .limit(1);
  if (!signal) return c.json({ claims: [] });
  const rows = await db(c.env.DB)
    .select()
    .from(schema.claimRecords)
    .where(
      and(
        eq(schema.claimRecords.signalId, signal.id),
        eq(schema.claimRecords.surface, "signal"),
      ),
    )
    .orderBy(desc(schema.claimRecords.createdAt));
  if (rows.length === 0) return c.json({ claims: [] });
  const ids = rows.map((r) => r.id);
  const links = await db(c.env.DB)
    .select()
    .from(schema.claimEvidenceLinks)
    .where(inArray(schema.claimEvidenceLinks.claimId, ids))
    .orderBy(asc(schema.claimEvidenceLinks.addedAt));
  const evidenceByClaim = new Map<string, ClaimEvidenceLink[]>();
  for (const row of links) {
    const list = evidenceByClaim.get(row.claimId) ?? [];
    list.push(toEvidence(row));
    evidenceByClaim.set(row.claimId, list);
  }
  return c.json({
    claims: rows.map((r) => {
      const list = evidenceByClaim.get(r.id) ?? [];
      return {
        ...toClaim(r),
        evidence: list,
        rollup: rollupEvidence(list),
      };
    }),
  });
});
