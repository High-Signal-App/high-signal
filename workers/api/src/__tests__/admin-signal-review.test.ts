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
    signal: { slug: string; reviewStatus: string };
    claims: { reviewStatus: string; evidence: unknown[] }[];
    evidence: unknown[];
  };
  expect(payload.signal).toMatchObject({ slug: 'aged-draft', reviewStatus: 'draft' });
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
  await database.binding
    .prepare('UPDATE evidence SET excerpt = NULL WHERE url = ?')
    .bind(urls[1])
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
      { url: urls[1], excerpt: 'Retained source text', sourceType: 'techmeme' },
    ])
  );
});

it.each([
  {
    source_class: 'attention_aggregator',
    evidence_tier: 'derived',
    confidence_contribution: 'none',
  },
  { confidenceContribution: 'none' },
  { evidenceTier: 'derived' },
])(
  'keeps retained source policy authoritative over model-certified proof: %j',
  async (metadata) => {
    await database.binding
      .prepare('UPDATE source_documents SET source = ?, parsed_fields = ? WHERE id = ?')
      .bind('reddit:ClaudeAI', JSON.stringify(metadata), 'source-1')
      .run();
    const response = await request('/admin/signals-review/aged-draft', `Bearer ${token}`);
    const payload = (await response.json()) as {
      claims: { evidence: { evidenceUrl: string; role: string; semanticAlignment: string }[] }[];
      evidence: { url: string; excerpt: string; sourceType: string; contextOnly?: boolean }[];
    };
    expect(payload.claims[0]?.evidence.find((link) => link.evidenceUrl === urls[1])).toMatchObject({
      role: 'context',
      semanticAlignment: 'unverified',
    });
    expect(payload.evidence.find((item) => item.url === urls[1])).toMatchObject({
      excerpt: 'Retained excerpt 1',
      contextOnly: true,
    });
    expect(
      await database.binding
        .prepare('SELECT role, semantic_alignment FROM claim_evidence_links WHERE evidence_url = ?')
        .bind(urls[1])
        .first()
    ).toEqual({ role: 'corroboration', semantic_alignment: 'verified' });
  }
);

it('preserves supporting proof for a discussion document whose policy permits it', async () => {
  await database.binding
    .prepare('UPDATE source_documents SET source = ?, parsed_fields = ? WHERE id = ?')
    .bind('reddit:ClaudeAI', JSON.stringify({ confidence_contribution: 'allowed' }), 'source-1')
    .run();
  const response = await request('/admin/signals-review/aged-draft', `Bearer ${token}`);
  const payload = (await response.json()) as {
    claims: { evidence: { evidenceUrl: string; role: string; semanticAlignment: string }[] }[];
  };
  expect(payload.claims[0]?.evidence.find((link) => link.evidenceUrl === urls[1])).toMatchObject({
    role: 'corroboration',
    semanticAlignment: 'verified',
  });
});

it('recovers blank legacy excerpts from the exact linked retained document', async () => {
  await database.binding.prepare("UPDATE evidence SET excerpt = '  '").run();
  const response = await request('/admin/signals-review/aged-draft', `Bearer ${token}`);
  const payload = (await response.json()) as { evidence: { excerpt: string }[] };
  expect(payload.evidence.map((item) => item.excerpt)).toEqual([
    'Retained source text',
    'Retained source text',
  ]);
});

it('never substitutes text from a document whose canonical URL differs from the citation', async () => {
  await database.binding.prepare('UPDATE evidence SET excerpt = NULL').run();
  await database.binding
    .prepare(
      "UPDATE source_documents SET canonical_url = 'https://different.example/report' WHERE id = 'source-1'"
    )
    .run();
  const response = await request('/admin/signals-review/aged-draft', `Bearer ${token}`);
  const payload = (await response.json()) as {
    evidenceCoverage: {
      url: string;
      linked: boolean;
      documentPresent: boolean;
      canonicalMatch: boolean;
      retainedText: boolean;
      legacyText: boolean;
    }[];
    claims: { evidence: { evidenceUrl: string; semanticAlignment: string; role: string }[] }[];
    evidence: { url: string; excerpt: string | null }[];
  };
  expect(payload.evidence.find((item) => item.url === urls[0])?.excerpt).toBe(
    'Retained source text'
  );
  expect(payload.evidence.find((item) => item.url === urls[1])?.excerpt).toBeNull();
  expect(payload.claims[0]?.evidence.find((link) => link.evidenceUrl === urls[1])).toMatchObject({
    semanticAlignment: 'unverified',
    role: 'context',
  });
  expect(payload.evidenceCoverage.find((item) => item.url === urls[1])).toEqual({
    url: urls[1],
    legacyText: false,
    linked: true,
    documentPresent: true,
    canonicalMatch: false,
    retainedText: false,
  });
  expect(
    await database.binding
      .prepare('SELECT semantic_alignment, role FROM claim_evidence_links WHERE evidence_url = ?')
      .bind(urls[1])
      .first()
  ).toEqual({
    semantic_alignment: 'verified',
    role: 'corroboration',
  });
});

it('keeps missing retained text unavailable and caps recovered excerpts', async () => {
  await database.binding.prepare('UPDATE evidence SET excerpt = NULL').run();
  await database.binding
    .prepare('UPDATE source_documents SET raw_text = ? WHERE id = ?')
    .bind('x'.repeat(3000), 'source-0')
    .run();
  await database.binding
    .prepare("UPDATE source_documents SET raw_text = NULL WHERE id = 'source-1'")
    .run();
  const response = await request('/admin/signals-review/aged-draft', `Bearer ${token}`);
  const payload = (await response.json()) as {
    evidenceCoverage: { url: string; canonicalMatch: boolean; retainedText: boolean }[];
    evidence: { url: string; excerpt: string | null }[];
  };
  expect(payload.evidence.find((item) => item.url === urls[0])?.excerpt).toBe('x'.repeat(1500));
  expect(payload.evidence.find((item) => item.url === urls[1])?.excerpt).toBeNull();
  expect(payload.evidenceCoverage.find((item) => item.url === urls[1])).toMatchObject({
    canonicalMatch: true,
    retainedText: false,
  });
});

it('reviews 101 linked documents within the production D1 parameter limit', async () => {
  const claim = await database.binding
    .prepare('SELECT id, signal_id FROM claim_records LIMIT 1')
    .first<{ id: string; signal_id: string }>();
  expect(claim).not.toBeNull();
  for (let index = 2; index < 101; index++) {
    const url = `https://source-${index}.example/report`;
    await database.binding
      .prepare(`INSERT INTO source_documents
      (id, source, canonical_url, document_key, fetched_at, raw_hash, raw_text, created_at)
      VALUES (?, 'news', ?, ?, 1, 'fixture-hash', 'Retained source text', 1)`)
      .bind(`source-${index}`, url, `news:fixture:${url}`)
      .run();
    await database.binding
      .prepare(`INSERT INTO claim_evidence_links
      (id, claim_id, evidence_url, source_document_id, role, added_at)
      VALUES (?, ?, ?, ?, 'corroboration', 1)`)
      .bind(`link-${index}`, claim!.id, url, `source-${index}`)
      .run();
    await database.binding
      .prepare(`INSERT INTO evidence (id, signal_id, url, source_type)
      VALUES (?, ?, ?, 'news')`)
      .bind(`evidence-${index}`, claim!.signal_id, url)
      .run();
  }
  await database.binding.prepare('UPDATE evidence SET excerpt = NULL').run();
  const prepare = database.binding.prepare.bind(database.binding);
  database.binding.prepare = (sql: string) => {
    const statement = prepare(sql);
    const bind = statement.bind.bind(statement);
    statement.bind = (...values: unknown[]) => {
      if (values.length > 100) throw new Error('D1 bound-parameter limit exceeded');
      return bind(...values);
    };
    return statement;
  };
  const response = await request('/admin/signals-review/aged-draft', `Bearer ${token}`);
  expect(response.status).toBe(200);
  const payload = (await response.json()) as { evidence: { excerpt: string }[] };
  expect(payload.evidence).toHaveLength(101);
  expect(payload.evidence.every((item) => item.excerpt === 'Retained source text')).toBe(true);
});

it('distinguishes an unlinked citation from a missing linked document without source text', async () => {
  await database.binding.prepare('UPDATE evidence SET excerpt = NULL').run();
  await database.binding
    .prepare('UPDATE claim_evidence_links SET source_document_id = NULL WHERE evidence_url = ?')
    .bind(urls[0])
    .run();
  await database.binding
    .prepare('UPDATE claim_evidence_links SET source_document_id = ? WHERE evidence_url = ?')
    .bind('missing-document', urls[1])
    .run();
  const response = await request('/admin/signals-review/aged-draft', `Bearer ${token}`);
  expect(response.status).toBe(200);
  const payload = (await response.json()) as { evidenceCoverage: unknown[] };
  expect(payload.evidenceCoverage).toEqual(
    expect.arrayContaining([
      {
        url: urls[0],
        legacyText: false,
        linked: false,
        documentPresent: false,
        canonicalMatch: false,
        retainedText: false,
      },
      {
        url: urls[1],
        legacyText: false,
        linked: true,
        documentPresent: false,
        canonicalMatch: false,
        retainedText: false,
      },
    ])
  );
});
