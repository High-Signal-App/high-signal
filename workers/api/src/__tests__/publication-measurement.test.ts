import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyMigration, applyMigrations, createSqliteD1, type TestD1 } from '../../test/sqlite-d1';
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
  const syncedSignal = (await database.binding
    .prepare('SELECT measurement_eligible FROM signals WHERE slug = ?')
    .bind(signal.slug)
    .first()) as { measurement_eligible: number };
  expect(syncedSignal.measurement_eligible).toBe(1);
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
  it('keeps pre-feature published rows ineligible when the additive migration lands', () => {
    const legacyDatabase = createSqliteD1();
    try {
      applyMigrations(legacyDatabase, '0032_first_publication_measurement_eligibility.sql');
      legacyDatabase.exec(`
        INSERT INTO entities (id, name, type, created_at, updated_at)
        VALUES ('NVDA', 'NVIDIA', 'company', 1, 1);
        INSERT INTO signals
          (id, slug, signal_type, primary_entity_id, direction, confidence,
           predicted_window_days, published_at, evidence_urls, review_status, body_md)
        VALUES ('legacy-signal', 'legacy-published', 'capacity_change', 'NVDA',
                'up', 'high', 30, 1, '[]', 'published', 'legacy');
      `);
      applyMigration(legacyDatabase, '0032_first_publication_measurement_eligibility.sql');
      const row = legacyDatabase.binding
        .prepare(
          'SELECT measurement_eligible, measurement_first_published_at FROM signals WHERE id = ?'
        )
        .bind('legacy-signal');
      return row
        .first()
        .then((result) => {
          expect(result).toEqual({
            measurement_eligible: 0,
            measurement_first_published_at: null,
          });
        })
        .finally(() => legacyDatabase.close());
    } catch (error) {
      legacyDatabase.close();
      throw error;
    }
  });

  it('does not append a publication intent when another writer wins the claim status race', async () => {
    await request('/admin/sync', 'POST', { signals: [fixtureSignal()] });
    const claim = (await database.binding
      .prepare('SELECT id FROM claim_records LIMIT 1')
      .first()) as { id: string };
    const claimId = claim.id;
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
    expect((await events('signal_measurement_intent')).results).toHaveLength(0);
    expect((await events('status_change')).results).toHaveLength(0);
  });

  it('keeps distinct status cycles instead of suppressing repeated transitions', async () => {
    await request('/admin/sync', 'POST', { signals: [fixtureSignal()] });
    const claim = (await database.binding
      .prepare('SELECT id FROM claim_records LIMIT 1')
      .first()) as { id: string };
    for (const status of ['held', 'draft', 'held', 'draft'] as const) {
      const response = await request(`/admin/claims/${claim.id}/status`, 'POST', { status });
      expect(response.status).toBe(200);
    }
    expect((await events('status_change')).results).toHaveLength(4);
  });

  it('chooses a published claim that actually has a measurement intent', async () => {
    const { signal, claimId: earlierClaimId } = await createDraftAndPublishClaim();
    await database.binding
      .prepare('DELETE FROM claim_timeline_events WHERE claim_id = ? AND kind = ?')
      .bind(earlierClaimId, 'signal_measurement_intent')
      .run();
    const laterClaimResponse = await request('/admin/claims', 'POST', {
      surface: 'signal',
      signalSlug: signal.slug,
      assertion: 'A second independently recorded claim for this signal.',
      claimTuple: {
        entity: 'NVDA',
        event: 'secondary capacity impact',
        amount: null,
        date: '2026-10-25',
        direction: 'up',
      },
      evidence: [
        {
          url: 'https://one.example/a',
          role: 'primary',
          sourceDocumentId: 'retained-0',
          originatingEvidenceId: 'announcement-1',
          semanticAlignment: 'verified',
        },
        {
          url: 'https://two.example/b',
          role: 'corroboration',
          sourceDocumentId: 'retained-1',
          originatingEvidenceId: 'filing-2',
          semanticAlignment: 'verified',
        },
      ],
    });
    expect(laterClaimResponse.status).toBe(200);
    const { id: laterClaimId } = (await laterClaimResponse.json()) as { id: string };
    const laterStatus = await request(`/admin/claims/${laterClaimId}/status`, 'POST', {
      status: 'published',
    });
    expect(laterStatus.status).toBe(200);
    expect((await events('signal_measurement_intent')).results).toHaveLength(1);

    const publishedSignal = await request(`/admin/signals/${signal.slug}`, 'PATCH', {
      reviewStatus: 'published',
    });
    expect(publishedSignal.status).toBe(200);
    const receipt = (await events('signal_measurement_published')).results[0] as {
      claim_id: string;
    };
    expect(receipt.claim_id).toBe(laterClaimId);
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
      measurement: { denominator: number; pending: number; records?: unknown };
    };
    expect(initialCohort.measurement).toMatchObject({
      denominator: 1,
      pending: 1,
    });
    expect(initialCohort.measurement).not.toHaveProperty('records');

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
        records?: unknown;
      };
    };
    expect(cohort.measurement).toMatchObject({
      denominator: 1,
      pending: 0,
      unscorable: 1,
      unscorableReasons: { missing_ticker: 1 },
    });
    expect(cohort.measurement).not.toHaveProperty('records');

    const repeated = await request(`/admin/signals/${signal.slug}`, 'PATCH', {
      reviewStatus: 'published',
    });
    expect(repeated.status).toBe(200);
    expect((await events('signal_measurement_published')).results).toHaveLength(1);
    const firstPublished = (await database.binding
      .prepare(
        'SELECT measurement_first_published_at, measurement_eligible FROM signals WHERE slug = ?'
      )
      .bind(signal.slug)
      .first()) as { measurement_first_published_at: number; measurement_eligible: number };
    expect(firstPublished.measurement_first_published_at).toBe(
      Math.floor(Date.parse(receipt.firstPublishedAt) / 1000)
    );
    expect(firstPublished.measurement_eligible).toBe(0);
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

    const legacy = fixtureSignal();
    legacy.slug = 'legacy-already-published';
    legacy.publishedAt = new Date().toISOString();
    await request('/admin/sync', 'POST', { signals: [legacy] });
    await database.binding
      .prepare(
        "UPDATE signals SET review_status = 'published', published_at = 1, measurement_eligible = 0 WHERE slug = ?"
      )
      .bind(legacy.slug)
      .run();
    await request('/admin/sync', 'POST', { signals: [legacy] });
    const afterResync = (await database.binding
      .prepare('SELECT measurement_eligible FROM signals WHERE slug = ?')
      .bind(legacy.slug)
      .first()) as { measurement_eligible: number };
    expect(afterResync.measurement_eligible).toBe(0);
    const legacyClaim = (await database.binding
      .prepare(
        'SELECT id FROM claim_records WHERE signal_id = (SELECT id FROM signals WHERE slug = ?)'
      )
      .bind(legacy.slug)
      .first()) as { id: string };
    await request(`/admin/claims/${legacyClaim.id}/status`, 'POST', { status: 'published' });
    await database.binding
      .prepare("UPDATE signals SET review_status = 'draft' WHERE slug = ?")
      .bind(legacy.slug)
      .run();
    const republishedLegacy = await request(`/admin/signals/${legacy.slug}`, 'PATCH', {
      reviewStatus: 'published',
    });
    expect(republishedLegacy.status).toBe(200);
    const legacyMarker = (await database.binding
      .prepare(
        'SELECT measurement_eligible, measurement_first_published_at FROM signals WHERE slug = ?'
      )
      .bind(legacy.slug)
      .first()) as { measurement_eligible: number; measurement_first_published_at: number | null };
    expect(legacyMarker).toEqual({
      measurement_eligible: 0,
      measurement_first_published_at: null,
    });
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
        { claimId: 'claim-1', payload, outcome: null, notes: null },
        {
          claimId: 'claim-2',
          payload: payload.replace('claim-1', 'claim-2').replace('signal-1', 'signal-2'),
          outcome: 'pending',
          notes: 'TICKER pub=2026-09-01',
        },
        {
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
