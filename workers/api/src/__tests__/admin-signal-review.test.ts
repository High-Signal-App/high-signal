import { afterEach, beforeEach, expect, it } from 'vitest';
import { applyMigrations, createSqliteD1, type TestD1 } from '../../test/sqlite-d1';
import app from '../index';

let database: TestD1;
const urls = ['https://one.example/report', 'https://two.example/report'];
const token = 'synthetic-review-token';
const fetcher = app as unknown as {
  fetch(request: Request, env: Record<string, unknown>): Promise<Response>;
};
const request = (path: string, authorization?: string) =>
  fetcher.fetch(
    new Request(`http://test${path}`, {
      headers: authorization ? { Authorization: authorization } : {},
    }),
    { DB: database.binding, ADMIN_TOKEN: token, TURNSTILE_SECRET: 'synthetic-history-secret' }
  );

beforeEach(async () => {
  database = createSqliteD1();
  applyMigrations(database);
  for (const [index, url] of urls.entries()) {
    await database.binding
      .prepare(`INSERT INTO source_documents
      (id, source, canonical_url, document_key, fetched_at, raw_hash, raw_text, created_at)
      VALUES (?, 'news', ?, ?, 1, 'fixture-hash', 'Retained source text', 1)`)
      .bind(`source-${index}`, url, `news:fixture:${url}`)
      .run();
  }
  const response = await fetcher.fetch(
    new Request('http://test/admin/sync', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        signals: [
          {
            slug: 'aged-draft',
            signalType: 'capacity_change',
            primaryEntityId: 'NVDA',
            direction: 'up',
            confidence: 'low',
            predictedWindowDays: 30,
            publishedAt: '2020-01-02T00:00:00Z',
            reviewStatus: 'draft',
            evidenceUrls: urls,
            bodyMd: 'Retained draft pending evidence review.',
            observedEvent: 'Capacity expanded.',
            directEntityImpact: 'More capacity.',
            claim: {
              assertion: 'Capacity expanded.',
              event: 'capacity expansion',
              date: '2020-01-02',
              direction: 'up',
            },
            evidence: urls.map((url, index) => ({
              url,
              sourceType: 'news',
              excerpt: `Retained excerpt ${index}`,
              sourceDocumentKey: `news:fixture:${url}`,
              originatingEvidenceId: `origin-${index}`,
              semanticAlignment: 'verified',
              role: index === 0 ? 'primary' : 'corroboration',
              supports: ['observed_event', 'direct_entity_impact'],
            })),
          },
        ],
      }),
    }),
    { DB: database.binding, ADMIN_TOKEN: token }
  );
  expect(response.status).toBe(200);
});

afterEach(() => database.close());

it('rejects missing and invalid operator credentials', async () => {
  for (const authorization of [undefined, 'Bearer wrong-token']) {
    expect((await request('/admin/signals-review/aged-draft', authorization)).status).toBe(401);
  }
});

it('reads retained historical draft evidence only through the protected review route', async () => {
  for (const path of ['/signals/aged-draft', '/claims/by-signal/aged-draft']) {
    for (const authorization of [undefined, `Bearer ${token}`]) {
      expect((await request(path, authorization)).status).toBe(403);
    }
  }
  const response = await request('/admin/signals-review/aged-draft', `Bearer ${token}`);
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  const payload = (await response.json()) as {
    claims: { reviewStatus: string; evidence: unknown[] }[];
    evidence: unknown[];
  };
  expect(payload.claims).toHaveLength(1);
  expect(payload.claims[0]).toMatchObject({
    reviewStatus: 'draft',
    evidence: [
      {
        evidenceUrl: urls[0],
        originatingEvidenceId: expect.any(String),
        semanticAlignment: 'verified',
        role: 'primary',
      },
      {
        evidenceUrl: urls[1],
        originatingEvidenceId: expect.any(String),
        semanticAlignment: 'verified',
        role: 'corroboration',
      },
    ],
  });
  const stored = await database.binding
    .prepare(
      'SELECT originating_evidence_id FROM claim_evidence_links ORDER BY originating_evidence_id'
    )
    .all<{ originating_evidence_id: string }>();
  const evidence = payload.claims[0]?.evidence as { originatingEvidenceId: string }[];
  expect(evidence.map((link) => link.originatingEvidenceId).sort()).toEqual(
    stored.results.map((link) => link.originating_evidence_id)
  );
  expect(payload.evidence).toEqual(
    expect.arrayContaining(
      urls.map((url, index) => ({
        url,
        excerpt: `Retained excerpt ${index}`,
        sourceType: 'news',
      }))
    )
  );
  const signal = await database.binding
    .prepare('SELECT review_status FROM signals WHERE slug = ?')
    .bind('aged-draft')
    .first();
  expect(signal).toEqual({ review_status: 'draft' });
});

it('does not substitute another draft when the requested slug is missing', async () => {
  const response = await request('/admin/signals-review/missing', `Bearer ${token}`);
  expect(response.status).toBe(404);
});

it('keeps retained aggregator documents context-only for the publisher', async () => {
  await database.binding
    .prepare('UPDATE source_documents SET source = ? WHERE id = ?')
    .bind('techmeme', 'source-1')
    .run();
  const response = await request('/admin/signals-review/aged-draft', `Bearer ${token}`);
  expect(response.status).toBe(200);
  const payload = (await response.json()) as {
    claims: { evidence: unknown[] }[];
    evidence: unknown[];
  };
  expect(payload.claims[0]?.evidence).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        evidenceUrl: urls[1],
        role: 'context',
        semanticAlignment: 'unverified',
      }),
    ])
  );
  expect(payload.evidence).toEqual(
    expect.arrayContaining([
      { url: urls[1], excerpt: 'Retained excerpt 1', sourceType: 'techmeme' },
    ])
  );
});
