import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyMigrations, createSqliteD1, type TestD1 } from '../../test/sqlite-d1';
import app from '../index';

const fetcher = app as unknown as {
  fetch(request: Request, env?: Record<string, unknown>): Promise<Response>;
};

function proofSignal() {
  return {
    slug: 'nvda-capacity-expansion',
    signalType: 'capacity_change',
    primaryEntityId: 'NVDA',
    direction: 'up',
    confidence: 'high',
    predictedWindowDays: 30,
    publishedAt: '2026-08-26T00:00:00.000Z',
    evidenceUrls: ['https://one.example/a', 'https://two.example/b'],
    evidence: [
      {
        url: 'https://one.example/a',
        sourceDocumentKey: 'news:one:https://one.example/a',
        originatingEvidenceId: 'announcement-1',
        semanticAlignment: 'verified',
        role: 'primary',
        supports: ['observed_event'],
      },
      {
        url: 'https://two.example/b',
        sourceDocumentKey: 'filing:https://two.example/b',
        originatingEvidenceId: 'filing-2',
        semanticAlignment: 'verified',
        role: 'corroboration',
        supports: ['observed_event', 'direct_entity_impact'],
      },
    ],
    spilloverEntityIds: [] as string[],
    reviewStatus: 'draft',
    bodyMd: '## What changed\nCapacity expanded.\n\n## Why it matters\nSupply increased.',
    observedEvent: 'NVIDIA expanded accelerator capacity.',
    directEntityImpact: 'More sellable capacity.',
    claim: {
      assertion: 'NVIDIA expanded accelerator capacity.',
      event: 'capacity expansion',
      amount: '20 percent',
      date: '2026-08-26',
      direction: 'up',
    },
  };
}

let database: TestD1;

beforeEach(() => {
  database = createSqliteD1();
  applyMigrations(database);
  database.exec('PRAGMA foreign_keys = ON');
});

afterEach(() => {
  vi.restoreAllMocks();
  database.close();
});

async function sync(signal = proofSignal(), binding = database.binding) {
  return fetcher.fetch(
    new Request('http://t/admin/sync', {
      method: 'POST',
      headers: { Authorization: 'Bearer secret', 'Content-Type': 'application/json' },
      body: JSON.stringify({ signals: [signal] }),
    }),
    { DB: binding, ADMIN_TOKEN: 'secret' }
  );
}

async function rows(table: string) {
  return (await database.binding.prepare(`SELECT * FROM ${table} ORDER BY id`).all()).results;
}

async function snapshot() {
  const tables = [
    'entities',
    'signals',
    'evidence',
    'claim_records',
    'claim_evidence_links',
    'claim_timeline_events',
  ];
  return Object.fromEntries(
    await Promise.all(tables.map(async (table) => [table, await rows(table)]))
  );
}

function retainDocuments() {
  for (const [index, item] of proofSignal().evidence.entries()) {
    database.exec(`INSERT INTO source_documents
      (id, source, canonical_url, document_key, fetched_at, raw_hash, raw_text, created_at)
      VALUES ('retained-${index}', 'news', '${item.url}', '${item.sourceDocumentKey}', 1, 'hash-${index}', 'Retained article', 1)`);
  }
}

function changedSignal() {
  const signal = proofSignal();
  signal.bodyMd = 'Changed prose from a later import';
  signal.claim.assertion = 'Changed assertion from a later import';
  signal.spilloverEntityIds = ['NEW_ENTITY'];
  signal.evidence[0]!.semanticAlignment = 'rejected';
  return signal;
}

describe('POST /admin/sync proof receipts', () => {
  it('persists the normalized claim and verified retained-document links', async () => {
    retainDocuments();
    const response = await sync();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ upserts: 1, proofUpserts: 1 });
    expect(await rows('claim_records')).toMatchObject([
      {
        assertion: proofSignal().claim.assertion,
        claim_entity_id: 'nvda',
        review_status: 'draft',
      },
    ]);
    const links = await rows('claim_evidence_links');
    expect(links).toHaveLength(2);
    expect(links.every((link) => link['semantic_alignment'] === 'verified')).toBe(true);
    expect(links.map((link) => link['source_document_id']).sort()).toEqual([
      'retained-0',
      'retained-1',
    ]);
    expect(links.map((link) => link['role']).sort()).toEqual(['corroboration', 'primary']);
  });

  it('does not grant verified alignment when the source document is absent', async () => {
    expect((await sync()).status).toBe(200);
    const links = await rows('claim_evidence_links');
    expect(links).toHaveLength(2);
    expect(links.every((link) => link['semantic_alignment'] === 'unverified')).toBe(true);
    expect(links.every((link) => link['source_document_id'] === null)).toBe(true);
  });

  it.each(['published', 'corrected', 'killed'])(
    'preserves the entire %s signal and its proof history on replay',
    async (status) => {
      expect((await sync()).status).toBe(200);
      await database.binding.prepare('UPDATE signals SET review_status = ?').bind(status).run();
      const before = await snapshot();
      const response = await sync(changedSignal());
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        upserts: 0,
        proofUpserts: 0,
        createdEntities: 0,
      });
      expect(await snapshot()).toEqual(before);
    }
  );

  it.each(['held', 'published', 'corrected', 'killed'])(
    'preserves a draft parent with an already %s claim, even when the new tuple differs',
    async (status) => {
      expect((await sync()).status).toBe(200);
      await database.binding
        .prepare('UPDATE claim_records SET review_status = ?')
        .bind(status)
        .run();
      const before = await snapshot();
      const changed = changedSignal();
      changed.claim.event = 'different event';
      expect((await sync(changed)).status).toBe(200);
      expect(await snapshot()).toEqual(before);
    }
  );

  it('still refreshes an unreviewed draft and its evidence and claim', async () => {
    expect((await sync()).status).toBe(200);
    const changed = changedSignal();
    changed.evidenceUrls = [changed.evidenceUrls[0]!];
    const response = await sync(changed);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ upserts: 1, proofUpserts: 1 });
    expect(await rows('signals')).toMatchObject([
      { body_md: changed.bodyMd, review_status: 'draft' },
    ]);
    expect(await rows('evidence')).toHaveLength(1);
    expect(await rows('claim_records')).toMatchObject([{ assertion: changed.claim.assertion }]);
  });

  it('does not accept publication via sync and allows an append-only correction', async () => {
    const original = proofSignal();
    original.reviewStatus = 'published';
    expect((await sync(original)).status).toBe(200);
    const [parent] = await rows('signals');
    expect(parent!['review_status']).toBe('draft');
    await database.binding.prepare('UPDATE signals SET review_status = ?').bind('published').run();
    const correction = {
      ...proofSignal(),
      slug: 'nvda-capacity-correction',
      reviewStatus: 'corrected',
      supersedesSignalId: parent!['id'],
    };
    expect((await sync(correction)).status).toBe(200);
    expect((await rows('signals')).find((row) => row['slug'] === correction.slug)).toMatchObject({
      review_status: 'corrected',
      supersedes_signal_id: parent!['id'],
    });
    const before = await snapshot();
    expect((await sync({ ...correction, bodyMd: 'Attempted correction rewrite' })).status).toBe(
      200
    );
    expect(await snapshot()).toEqual(before);
  });

  it('rolls back the whole draft update if a proof write fails', async () => {
    expect((await sync()).status).toBe(200);
    const before = await snapshot();
    database.exec(`CREATE TRIGGER fail_proof BEFORE INSERT ON claim_evidence_links
      BEGIN SELECT RAISE(ABORT, 'injected proof failure'); END`);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const response = await sync(changedSignal());
    expect(response.status).toBe(503);
    expect(await snapshot()).toEqual(before);
  });

  it('rechecks review status inside the write transaction if a reviewer wins the race', async () => {
    expect((await sync()).status).toBe(200);
    let before: Awaited<ReturnType<typeof snapshot>> | undefined;
    let batches = 0;
    const binding = {
      prepare: database.binding.prepare.bind(database.binding),
      batch: async (statements: D1PreparedStatement[]) => {
        batches++;
        await database.binding
          .prepare('UPDATE signals SET review_status = ?')
          .bind('published')
          .run();
        before = await snapshot();
        return database.binding.batch(statements);
      },
    } as D1Database;
    const response = await sync(changedSignal(), binding);
    expect(response.status).toBe(200);
    expect(batches).toBe(1);
    expect(await response.json()).toMatchObject({
      upserts: 0,
      proofUpserts: 0,
      createdEntities: 0,
    });
    expect(await snapshot()).toEqual(before);
  });
});
