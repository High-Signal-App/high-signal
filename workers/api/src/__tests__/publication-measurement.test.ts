import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyMigrations, createSqliteD1, type TestD1 } from '../../test/sqlite-d1';
import app from '../index';
import { summarizeMeasurementCohort } from '../lib/outcome-measurement';

const fetcher = app as unknown as {
  fetch(request: Request, env?: Record<string, unknown>): Promise<Response>;
};
const assertion = 'NVIDIA expanded accelerator capacity.';

function fixtureSignal() {
  return {
    slug: 'nvda-capacity-expansion',
    signalType: 'capacity_change',
    primaryEntityId: 'NVDA',
    direction: 'up',
    confidence: 'high',
    predictedWindowDays: 30,
    publishedAt: new Date().toISOString(),
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
    spilloverEntityIds: [],
    reviewStatus: 'draft',
    bodyMd: '## What changed\nCapacity expanded.\n\n## Why it matters\nSupply increased.',
    observedEvent: 'NVIDIA expanded accelerator capacity.',
    directEntityImpact: 'More sellable capacity.',
    claim: {
      assertion,
      event: 'capacity expansion',
      amount: '20 percent',
      date: new Date().toISOString().slice(0, 10),
      direction: 'up',
    },
  };
}

let database: TestD1;
const env = (binding: D1Database = database.binding) => ({ DB: binding, ADMIN_TOKEN: 'secret' });

beforeEach(() => {
  database = createSqliteD1();
  applyMigrations(database);
  database.exec('PRAGMA foreign_keys = ON');
  for (const [index, item] of fixtureSignal().evidence.entries()) {
    database.exec(`INSERT INTO source_documents
      (id, source, canonical_url, document_key, fetched_at, raw_hash, raw_text, created_at)
      VALUES ('retained-${index}', 'news', '${item.url}', '${item.sourceDocumentKey}', 1, 'hash-${index}', 'Retained article', 1)`);
  }
});

afterEach(() => database.close());

async function request(
  path: string,
  method = 'GET',
  body?: unknown,
  binding: D1Database = database.binding
) {
  return fetcher.fetch(
    new Request(`http://t${path}`, {
      method,
      headers: {
        Authorization: 'Bearer secret',
        ...(method !== 'GET' ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env(binding)
  );
}

async function createDraftAndPublishClaim() {
  const signal = fixtureSignal();
  const synced = await request('/admin/sync', 'POST', { signals: [signal] });
  expect(synced.status).toBe(200);
  const claim = (await database.binding
    .prepare('SELECT id FROM claim_records LIMIT 1')
    .first()) as {
    id: string;
  };
  const claimPublish = await request(`/admin/claims/${claim.id}/status`, 'POST', {
    status: 'published',
    reason: 'auto_publish_rubric_passed',
  });
  expect(claimPublish.status).toBe(200);
  return { signal, claimId: claim.id };
}

async function events(kind: string) {
  return database.binding
    .prepare('SELECT id, claim_id, payload, created_at FROM claim_timeline_events WHERE kind = ?')
    .bind(kind)
    .all();
}

describe('first-publication measurement receipts', () => {
  it('does not append a publication intent when another writer wins the claim status race', async () => {
    const { claimId } = await createDraftAndPublishClaim();
    const racingBinding = {
      prepare: database.binding.prepare.bind(database.binding),
      batch: async (statements: D1PreparedStatement[]) => {
        await database.binding
          .prepare(
            "UPDATE claim_records SET review_status = 'published', published_at = 123 WHERE id = ?"
          )
          .bind(claimId)
          .run();
        return database.binding.batch(statements);
      },
    } as D1Database;
    const result = await request(
      `/admin/claims/${claimId}/status`,
      'POST',
      { status: 'published' },
      racingBinding
    );
    expect(result.status).toBe(409);
    expect((await events('signal_measurement_intent')).results).toHaveLength(1);
    expect((await events('status_change')).results).toHaveLength(1);
  });

  it('freezes the claim and rule only with successful signal publication, then feeds the due cohort', async () => {
    const { signal, claimId } = await createDraftAndPublishClaim();
    expect((await events('signal_measurement_intent')).results).toHaveLength(1);
    expect((await events('signal_measurement_published')).results).toHaveLength(0);
    const beforePublication = (await (await request('/track-record/cohorts')).json()) as {
      measurement: { denominator: number };
    };
    expect(beforePublication.measurement.denominator).toBe(0);

    const published = await request(`/admin/signals/${signal.slug}`, 'PATCH', {
      reviewStatus: 'published',
    });
    expect(published.status).toBe(200);
    const receiptRows = (await events('signal_measurement_published')).results as Array<{
      id: string;
      claim_id: string;
      payload: string;
      created_at: number;
    }>;
    expect(receiptRows).toHaveLength(1);
    const receipt = JSON.parse(receiptRows[0]!.payload) as {
      schemaVersion: number;
      signalId: string;
      claimId: string;
      claimSha256: string;
      firstPublishedAt: string;
      dueAt: string;
      resolutionRule: { id: string; version: number; direction: string; windowDays: number };
    };
    expect(receipt).toMatchObject({
      schemaVersion: 1,
      signalId: expect.any(String),
      claimId,
      claimSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      resolutionRule: {
        id: 'market-direction-forward-return',
        version: 1,
        direction: 'up',
        windowDays: 30,
      },
    });
    expect(Date.parse(receipt.dueAt)).toBe(Date.parse(receipt.firstPublishedAt) + 30 * 86_400_000);
    expect(receiptRows[0]!.created_at).toBe(
      Math.floor(Date.parse(receipt.firstPublishedAt) / 1000)
    );
    expect(receiptRows[0]!.payload).not.toContain(assertion);

    const publicClaim = (await (await request(`/claims/${claimId}`)).json()) as {
      claim: { timeline: Array<{ kind: string; payload: unknown }> };
    };
    expect(
      publicClaim.claim.timeline.some((event) => event.kind === 'signal_measurement_published')
    ).toBe(true);
    const initialCohort = (await (await request('/track-record/cohorts')).json()) as {
      measurement: { denominator: number; pending: number; records: Array<{ state: string }> };
    };
    expect(initialCohort.measurement).toMatchObject({
      denominator: 1,
      pending: 1,
      records: [{ state: 'pending' }],
    });

    await database.binding
      .prepare('UPDATE signals SET published_at = 1 WHERE slug = ?')
      .bind(signal.slug)
      .run();
    await database.binding
      .prepare(
        `UPDATE claim_timeline_events
         SET payload = json_set(payload, '$.dueAt', '2000-01-01T00:00:00.000Z')
         WHERE id = ?`
      )
      .bind(receiptRows[0]!.id)
      .run();
    const pendingScores = (await (await request('/admin/pending-scores')).json()) as {
      pending: Array<{ slug: string; published_at: number }>;
    };
    const pending = pendingScores.pending.find((row) => row.slug === signal.slug);
    expect(pending).toMatchObject({
      slug: signal.slug,
      published_at: Math.floor(Date.parse(receipt.firstPublishedAt) / 1000),
    });

    const score = await request('/admin/scores', 'POST', {
      runs: [
        {
          signalId: receipt.signalId,
          windowDays: 30,
          forwardReturn: null,
          outcome: 'pending',
          notes: 'no ticker for entity NVDA',
        },
      ],
    });
    expect(score.status).toBe(200);
    const cohort = (await (await request('/track-record/cohorts')).json()) as {
      measurement: {
        denominator: number;
        pending: number;
        unscorable: number;
        unscorableReasons: Record<string, number>;
        records: Array<{ state: string; reason: string | null }>;
      };
    };
    expect(cohort.measurement).toMatchObject({
      denominator: 1,
      pending: 0,
      unscorable: 1,
      unscorableReasons: { missing_ticker: 1 },
      records: [{ state: 'unscorable', reason: 'missing_ticker' }],
    });

    const repeated = await request(`/admin/signals/${signal.slug}`, 'PATCH', {
      reviewStatus: 'published',
    });
    expect(repeated.status).toBe(200);
    expect((await events('signal_measurement_published')).results).toHaveLength(1);
  });

  it('does not backfill already-published claims or count a failed signal publish', async () => {
    const { signal, claimId } = await createDraftAndPublishClaim();
    await database.binding
      .prepare('DELETE FROM claim_timeline_events WHERE kind = ?')
      .bind('signal_measurement_intent')
      .run();
    await database.binding
      .prepare(
        "UPDATE claim_records SET review_status = 'published', published_at = 1 WHERE id = ?"
      )
      .bind(claimId)
      .run();
    const historicalPublish = await request(`/admin/signals/${signal.slug}`, 'PATCH', {
      reviewStatus: 'published',
    });
    expect(historicalPublish.status).toBe(200);
    expect((await events('signal_measurement_published')).results).toHaveLength(0);

    const second = fixtureSignal();
    second.slug = 'nvda-capacity-expansion-failed';
    second.publishedAt = new Date().toISOString();
    await request('/admin/sync', 'POST', { signals: [second] });
    const secondClaim = (await database.binding
      .prepare(
        'SELECT id FROM claim_records WHERE signal_id = (SELECT id FROM signals WHERE slug = ?)'
      )
      .bind(second.slug)
      .first()) as { id: string };
    await request(`/admin/claims/${secondClaim.id}/status`, 'POST', { status: 'published' });
    await database.binding
      .prepare("UPDATE signals SET evidence_urls = '[]' WHERE slug = ?")
      .bind(second.slug)
      .run();
    const failedPublish = await request(`/admin/signals/${second.slug}`, 'PATCH', {
      reviewStatus: 'published',
    });
    expect(failedPublish.status).toBe(409);
    expect((await events('signal_measurement_published')).results).toHaveLength(0);
    const cohort = (await (await request('/track-record/cohorts')).json()) as {
      measurement: { denominator: number };
    };
    expect(cohort.measurement.denominator).toBe(0);
  });

  it('keeps due-without-score and unavailable-return cases unresolved rather than inventing outcomes', () => {
    const payload = JSON.stringify({
      schemaVersion: 1,
      signalId: 'signal-1',
      claimId: 'claim-1',
      claimSha256: 'a'.repeat(64),
      firstPublishedAt: '2026-09-01T00:00:00.000Z',
      dueAt: '2026-09-02T00:00:00.000Z',
      resolutionRule: {
        id: 'market-direction-forward-return',
        version: 1,
        metric: 'forward_return_percent',
        priceSource: 'shared_equities_close_adapter',
        startClosePolicy: 'first_available_on_or_after_publication_date',
        targetCloseIndexPolicy: 'min(windowDays, available_close_count_minus_one)',
        calendarEndBufferMultiplier: 1.6,
        direction: 'up',
        windowDays: 1,
        pushBandPercent: 0.5,
        neutralPushBandPercent: 2,
      },
    });
    const summary = summarizeMeasurementCohort(
      [
        { signalSlug: 'one', claimId: 'claim-1', payload, outcome: null, notes: null },
        {
          signalSlug: 'two',
          claimId: 'claim-2',
          payload: payload.replace('claim-1', 'claim-2').replace('signal-1', 'signal-2'),
          outcome: 'pending',
          notes: 'TICKER pub=2026-09-01',
        },
        {
          signalSlug: 'three',
          claimId: 'claim-3',
          payload: payload
            .replace('claim-1', 'claim-3')
            .replace('signal-1', 'signal-3')
            .replace('2026-09-02T00:00:00.000Z', '2030-01-02T00:00:00.000Z'),
          outcome: 'pending',
          notes: 'forward window still open',
        },
      ],
      new Date('2026-09-03T00:00:00.000Z')
    );
    expect(summary).toMatchObject({
      denominator: 3,
      pending: 1,
      resolved: 0,
      unresolved: 2,
      unscorable: 0,
      unresolvedReasons: { due_without_score: 1, forward_return_unavailable: 1 },
    });
  });
});
