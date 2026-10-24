import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyMigrations, createSqliteD1, type TestD1 } from '../../test/sqlite-d1';
import { syncSignal, type SignalUpsert } from '../lib/signal-sync';
import { sourceAwareEvidenceLinks, refreshBriefSnapshotEvidence } from '../lib/signal-quality';
import { db, schema } from '../db';
import { type BriefSnapshot } from '@high-signal/shared';

let database: TestD1;
beforeEach(() => {
  database = createSqliteD1();
  applyMigrations(database);
});
afterEach(() => database.close());

function signal(sourceType: string): SignalUpsert {
  return {
    slug: 'rss-proof',
    signalType: 'event',
    primaryEntityId: 'NVDA',
    direction: 'neutral',
    confidence: 'low',
    predictedWindowDays: 1,
    publishedAt: '2026-10-24T00:00:00Z',
    evidenceUrls: ['https://www.forbes.com/report'],
    bodyMd: 'Public discovery context.',
    evidence: [
      {
        url: 'https://www.forbes.com/report',
        sourceType,
        sourceDocumentKey: 'receipt',
        originatingEvidenceId: 'original-report',
        semanticAlignment: 'verified',
        role: 'primary',
        supports: ['observed_event'],
      },
    ],
    claim: {
      assertion: 'A result was reported.',
      event: 'reported result',
      date: '2026-10-24',
      direction: 'neutral',
    },
  };
}
async function retain(source: string) {
  await database.binding
    .prepare(`INSERT INTO source_documents
    (id,source,canonical_url,document_key,fetched_at,raw_hash,raw_text,created_at)
    VALUES ('retained',?,'https://www.forbes.com/report','receipt',1,'hash','Retained text',1)`)
    .bind(source)
    .run();
}

describe('Techmeme source-owned proof restrictions', () => {
  it.each([
    ['techmeme', 'news'],
    ['news', 'techmeme'],
    ['techmeme:legacy', 'web'],
  ])(
    'keeps owner %s and supplied category %s context-only despite model alignment',
    async (owner, category) => {
      await retain(owner);
      await syncSignal(database.binding, signal(category));
      const links = await db(database.binding).select().from(schema.claimEvidenceLinks);
      expect(links[0]).toMatchObject({
        role: 'context',
        semanticAlignment: 'unverified',
        sourceDocumentId: 'retained',
      });
    }
  );
  it('quarantines an existing mislabeled verified link on reads without rewriting history', async () => {
    await retain('news');
    await syncSignal(database.binding, signal('news'));
    await database.binding.prepare("UPDATE source_documents SET source='techmeme'").run();
    const stored = await db(database.binding).select().from(schema.claimEvidenceLinks);
    expect(stored[0]).toMatchObject({ role: 'primary', semanticAlignment: 'verified' });
    expect((await sourceAwareEvidenceLinks(db(database.binding), stored))[0]).toMatchObject({
      role: 'context',
      semanticAlignment: 'unverified',
    });
    expect(await db(database.binding).select().from(schema.claimEvidenceLinks)).toEqual(stored);
  });
  it('refreshes cached stock and culture provenance while preserving historical copy and stored evidence', async () => {
    await retain('news');
    await syncSignal(database.binding, signal('news'));
    const stored = await db(database.binding).select().from(schema.claimEvidenceLinks);
    await database.binding.prepare("UPDATE source_documents SET source='techmeme'").run();
    const provenance = {
      claimId: stored[0]!.claimId,
      assertion: 'Historical assertion',
      version: 1,
      evidenceCount: 2,
      primaryCount: 1,
      corroborationCount: 1,
      contradictionCount: 0,
      independentOriginCount: 2,
      evidenceUrls: ['https://www.forbes.com/report'],
    };
    const item = { provenance, title: 'Historical copy is preserved' };
    const snapshot = { stocks: [item], ideas: [item], trends: [item] } as unknown as BriefSnapshot;
    const refreshed = await refreshBriefSnapshotEvidence(db(database.binding), snapshot);
    for (const updated of [...refreshed.stocks, ...refreshed.ideas, ...refreshed.trends]) {
      expect(updated.provenance).toMatchObject({
        primaryCount: 0,
        corroborationCount: 0,
        independentOriginCount: 0,
      });
      expect(updated.provenance!.assertion).toBe('Historical assertion');
    }
    expect(snapshot.stocks[0]!.provenance!.primaryCount).toBe(1);
    expect(await db(database.binding).select().from(schema.claimEvidenceLinks)).toEqual(stored);
  });
  it('rejects an explicit RSS marker despite a mislabeled news document and category', async () => {
    await retain('news');
    await database.binding
      .prepare(
        "UPDATE source_documents SET raw_text='Techmeme permalink: https://www.techmeme.com/261024/p1'"
      )
      .run();
    await syncSignal(database.binding, signal('news'));
    const links = await db(database.binding).select().from(schema.claimEvidenceLinks);
    expect(links[0]).toMatchObject({ role: 'context', semanticAlignment: 'unverified' });
    expect((await db(database.binding).select().from(schema.evidence))[0]!.sourceType).toBe(
      'techmeme'
    );
    // Also protect an already verified, mislabeled historical link.
    await database.binding
      .prepare("UPDATE claim_evidence_links SET role='primary',semantic_alignment='verified'")
      .run();
    const old = await db(database.binding).select().from(schema.claimEvidenceLinks);
    expect((await sourceAwareEvidenceLinks(db(database.binding), old))[0]).toMatchObject({
      role: 'context',
      semanticAlignment: 'unverified',
    });
  });
  it('checks the exact linked document when two receipts share a publisher URL', async () => {
    await retain('techmeme');
    await database.binding
      .prepare("UPDATE source_documents SET canonical_url='https://forbes.com/report'")
      .run();
    await database.binding
      .prepare(`INSERT INTO source_documents
      (id,source,canonical_url,document_key,fetched_at,raw_hash,raw_text,created_at)
      VALUES ('original-second','news','https://forbes.com/report','other-receipt',1,'other','Original report',1)`)
      .run();
    const candidate = signal('news');
    delete candidate.evidence![0]!.sourceDocumentKey;
    await syncSignal(database.binding, candidate);
    const links = await db(database.binding).select().from(schema.claimEvidenceLinks);
    expect(links[0]).toMatchObject({
      sourceDocumentId: 'retained',
      role: 'context',
      semanticAlignment: 'unverified',
    });
  });
  it('preserves fetched news:hackernews-original publisher proof', async () => {
    await retain('news:hackernews-original:publisher.example');
    await syncSignal(database.binding, signal('news'));
    const links = await db(database.binding).select().from(schema.claimEvidenceLinks);
    expect((await sourceAwareEvidenceLinks(db(database.binding), links))[0]).toMatchObject({
      role: 'primary',
      semanticAlignment: 'verified',
    });
  });
});
