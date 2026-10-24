import { describe, expect, it } from 'vitest';
import {
  adminRoute,
  canonicalSourceUrl,
  normalizeSourceDocument,
  sourceDocumentKey,
} from '../routes/admin';
import { retainedEvidenceCandidates } from '../lib/attention-admin';
import { cftcReceiptRepairUrls } from '../lib/cftc-receipt-repair';
import { applyMigrations, createSqliteD1 } from '../../test/sqlite-d1';

describe('source document normalization', () => {
  it('canonicalizes tracking params and fragments', () => {
    expect(canonicalSourceUrl('https://www.example.com/a/?utm_source=x&ref=y&keep=1#section')).toBe(
      'https://example.com/a/?keep=1'
    );
  });

  it('uses source and canonical URL as stable document identity', () => {
    const first = normalizeSourceDocument({
      source: 'news:example',
      sourceUrl: 'https://www.example.com/a?utm_source=x#one',
      publishedAt: '2026-06-01T00:00:00.000Z',
      rawHash: 'event-hash-one',
    });
    const second = normalizeSourceDocument({
      source: 'news:example',
      sourceUrl: 'https://example.com/a',
      publishedAt: '2026-06-01T00:00:00.000Z',
      rawHash: 'event-hash-two',
    });

    expect(first.documentKey).toBe(second.documentKey);
    expect(first.rawHash).not.toBe(second.rawHash);
  });

  it('allows explicit producers to provide document keys', () => {
    const doc = normalizeSourceDocument({
      source: 'research-paper',
      sourceUrl: 'https://example.com/paper',
      publishedAt: '2026-06-01T00:00:00.000Z',
      rawHash: 'event',
      sourceDocument: {
        documentKey: 'paper:doi:10.0000/example',
        canonicalUrl: 'https://example.com/paper',
        rawHash: 'paper-version',
      },
    });

    expect(doc.documentKey).toBe('paper:doi:10.0000/example');
    expect(sourceDocumentKey('research-paper', doc.canonicalUrl)).toBe(
      'research-paper:https://example.com/paper'
    );
  });
});

describe('retained article receipt repair through actual SQLite upserts', () => {
  it('preserves discovery context across explicit refreshes without retaining stale proof metadata', async () => {
    const database = createSqliteD1();
    try {
      applyMigrations(database);
      const event = {
        source: 'news:mts-verification:example.com',
        sourceUrl: 'https://publisher.example/article',
        publishedAt: '2026-10-24T08:00:00Z',
        rawHash: 'same-article',
        title: 'Acme launches a new enterprise API',
      };
      async function push(parsedFields: unknown) {
        const response = await adminRoute.request(
          '/events',
          {
            method: 'POST',
            headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' },
            body: JSON.stringify({
              events: [
                {
                  ...event,
                  sourceDocument: { rawText: 'Refreshed public article body', parsedFields },
                },
              ],
            }),
          },
          { DB: database.binding, ADMIN_TOKEN: 'test' }
        );
        expect(await response.json()).toEqual({ inserted: 1 });
        return database.binding
          .prepare('SELECT parsed_fields FROM source_documents')
          .first<{ parsed_fields: string }>();
      }
      const discussionUrl = 'https://x.com/acme/status/123';
      await push({ discussionUrl, discussionUrls: [discussionUrl], oldEvidence: true });
      const refreshed = await push({ documentKind: 'news_article' });
      expect(JSON.parse(refreshed!.parsed_fields)).toEqual({
        discussionUrl,
        discussionUrls: [discussionUrl],
        documentKind: 'news_article',
      });
      const newer = await push({ discussionUrl: 'https://x.com/acme/status/456' });
      expect(JSON.parse(newer!.parsed_fields).discussionUrl).toBe('https://x.com/acme/status/456');
      database.exec("UPDATE source_documents SET parsed_fields = 'invalid historical JSON'");
      const repaired = await push({ documentKind: 'news_article' });
      expect(JSON.parse(repaired!.parsed_fields)).toEqual({ documentKind: 'news_article' });
    } finally {
      database.close();
    }
  });

  it.each([null, 'AI - unrelated navigation text retained by an older extraction'])(
    'repairs an existing receipt while preserving its original event observation: %s',
    async (initialText) => {
      const database = createSqliteD1();
      try {
        applyMigrations(database);
        const now = new Date();
        const fetchedAt = new Date(now.getTime() - 60_000);
        const source = 'news:refresh-example';
        const url = 'https://publisher.example/earnings?utm_source=feed';
        const title = 'Acme reports fiscal earnings and manufacturing output';
        const text =
          'Acme reported manufacturing output and fiscal earnings with the underlying operational details. '.repeat(
            12
          );
        const event = {
          source,
          sourceUrl: url,
          title,
          publishedAt: now.toISOString(),
          rawHash: 'unchanged-event-identity',
          content: initialText,
        };
        async function push(sourceDocument?: Record<string, unknown>) {
          const response = await adminRoute.request(
            '/events',
            {
              method: 'POST',
              headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' },
              body: JSON.stringify({
                events: [
                  { ...event, ...(sourceDocument ? { content: text, sourceDocument } : {}) },
                ],
              }),
            },
            { DB: database.binding, ADMIN_TOKEN: 'test' }
          );
          expect(response.status).toBe(200);
          expect(await response.json()).toEqual({ inserted: 1 });
        }
        await push();
        const original = await database.binding
          .prepare('SELECT id,source_document_id FROM events')
          .first<{ id: string; source_document_id: string }>();
        await push({
          canonicalUrl: url,
          fetchedAt: fetchedAt.toISOString(),
          publishedAt: now.toISOString(),
          rawHash: 'repaired-article-hash',
          rawText: text,
          parsedFields: { documentKind: 'news_article', retrievedFrom: 'public_article_page' },
        });
        // A failed subsequent collection is implicit, so it cannot clear a
        // substantive explicit retained article that was acknowledged before it.
        await push();
        const events = await database.binding
          .prepare('SELECT id,source_document_id,content FROM events')
          .all<{ id: string; source_document_id: string; content: string | null }>();
        expect(events.results).toEqual([{ ...original, content: initialText }]);
        const receipt = await database.binding
          .prepare('SELECT id,document_key,raw_text,raw_hash,fetched_at FROM source_documents')
          .first<{
            id: string;
            document_key: string;
            raw_text: string;
            raw_hash: string;
            fetched_at: number;
          }>();
        expect(receipt?.id).toBe(original?.source_document_id);
        expect(receipt?.document_key).toBe(
          'news:refresh-example:https://publisher.example/earnings'
        );
        expect(receipt?.raw_text).toBe(text);
        expect(receipt?.raw_hash).toBe('repaired-article-hash');
        expect(receipt?.fetched_at).toBe(Math.floor(fetchedAt.getTime() / 1000));
        const candidates = await retainedEvidenceCandidates(
          database.binding,
          title,
          Math.floor(now.getTime() / 1000),
          ['reddit:%']
        );
        expect(candidates).toHaveLength(1);
        expect(candidates[0]).toMatchObject({ url, retainedContent: text, retainedSource: source });
      } finally {
        database.close();
      }
    }
  );

  it('falls back to event content when a legacy retained body is empty', async () => {
    const database = createSqliteD1();
    try {
      applyMigrations(database);
      const now = Math.floor(Date.now() / 1000);
      const text =
        'Acme reported an operational manufacturing milestone with clear fiscal results. '.repeat(
          12
        );
      await database.binding
        .prepare(`INSERT INTO source_documents
        (id,source,canonical_url,document_key,fetched_at,published_at,raw_hash,raw_text,created_at)
        VALUES('empty-doc','news:legacy','https://publisher.example/legacy','legacy',?,?,'doc-hash','',?)`)
        .bind(now, now - 60, now)
        .run();
      await database.binding
        .prepare(`INSERT INTO events
        (id,source,source_url,published_at,title,content,raw_hash,source_document_id,ingested_at)
        VALUES('legacy','news:legacy','https://publisher.example/legacy',?,'Acme manufacturing fiscal results',?,'event-hash','empty-doc',?)`)
        .bind(now - 60, text, now)
        .run();
      const rows = await retainedEvidenceCandidates(
        database.binding,
        'Acme manufacturing fiscal results',
        now,
        []
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].retainedContent).toBe(text);
    } finally {
      database.close();
    }
  });
});

describe('guarded CFTC per-contract receipt replay', () => {
  it.each([false, true])(
    'repairs only matching observations and preserves their identity/copy: changed=%s',
    async (changed) => {
      const database = createSqliteD1();
      try {
        applyMigrations(database);
        const contract = 'ZCASH PERP STYLE - COINBASE DERIVATIVES, LLC';
        const reportDate = '2026-10-20T00:00:00.000';
        const content = `CFTC CoT ${contract} for ${reportDate}. Non-commercial long: 8518, short: 7216, net: 1302.`;
        const event = {
          source: 'us-gov-api:cftc-cot',
          sourceUrl: 'https://www.cftc.gov/MarketReports/CommitmentsofTraders/index.htm',
          title: `CFTC CoT: ${contract} (${reportDate})`,
          publishedAt: reportDate + 'Z',
          rawHash: 'stable-contract-report',
          content,
          fetchRunId: 'original-run',
        };
        async function push(input: object) {
          const response = await adminRoute.request(
            '/events',
            {
              method: 'POST',
              headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' },
              body: JSON.stringify({ events: [input] }),
            },
            { DB: database.binding, ADMIN_TOKEN: 'test' }
          );
          expect(await response.json()).toEqual({ inserted: 1 });
        }
        await push(event);
        const before = await database.binding
          .prepare('SELECT * FROM events')
          .first<Record<string, unknown>>();
        // Reproduce the contaminated shared receipt without changing its event-local observation.
        database.exec(
          "UPDATE source_documents SET raw_text = 'GULF FUEL OIL from an unrelated report'"
        );
        const url =
          'https://publicreporting.cftc.gov/resource/jun7-fc8e.json?' +
          new URLSearchParams({
            market_and_exchange_names: contract,
            report_date_as_yyyy_mm_dd: reportDate,
          });
        const newContent = changed ? content + ' Changed observation.' : content;
        const repaired = {
          ...event,
          sourceUrl: url,
          content: newContent,
          fetchRunId: 'replay-run',
          sourceDocument: {
            canonicalUrl: url,
            rawHash: event.rawHash,
            rawText: newContent,
            parsedFields: { documentKind: 'cftc_contract_report', contract, reportDate },
          },
        };
        await push(repaired);
        await push(repaired);
        const after = await database.binding
          .prepare('SELECT * FROM events')
          .first<Record<string, unknown>>();
        expect(await database.binding.prepare('SELECT count(*) AS n FROM events').first('n')).toBe(
          1
        );
        if (changed) {
          expect(after).toEqual(before);
        } else {
          expect(after?.['source_url']).toBe(url);
          expect(after?.['source_document_id']).not.toBe(before?.['source_document_id']);
          const { source_url: _oldUrl, source_document_id: _oldDoc, ...originalCopy } = before!;
          const { source_url: _newUrl, source_document_id: _newDoc, ...replayedCopy } = after!;
          expect(replayedCopy).toEqual(originalCopy);
          const receipt = await database.binding
            .prepare('SELECT canonical_url,raw_text FROM source_documents WHERE id = ?')
            .bind(after?.['source_document_id'])
            .first();
          expect(receipt).toEqual({ canonical_url: url, raw_text: content });
          await push({
            ...repaired,
            content: content + ' Conflicting later observation.',
            sourceDocument: {
              ...repaired.sourceDocument,
              rawText: content + ' Conflicting later observation.',
            },
          });
          expect(
            await database.binding
              .prepare('SELECT canonical_url,raw_text FROM source_documents WHERE id = ?')
              .bind(after?.['source_document_id'])
              .first()
          ).toEqual(receipt);
          expect(await database.binding.prepare('SELECT * FROM events').first()).toEqual(after);
          await push({
            ...repaired,
            sourceDocument: {
              ...repaired.sourceDocument,
              rawText: 'Unrelated malformed receipt',
              parsedFields: {},
            },
          });
          expect(
            await database.binding
              .prepare('SELECT canonical_url,raw_text FROM source_documents WHERE id = ?')
              .bind(after?.['source_document_id'])
              .first()
          ).toEqual(receipt);
        }
        const old = await database.binding
          .prepare('SELECT raw_text FROM source_documents WHERE id = ?')
          .bind(before?.['source_document_id'])
          .first('raw_text');
        expect(old).toBe('GULF FUEL OIL from an unrelated report');
      } finally {
        database.close();
      }
    }
  );
});

it('does not retarget generic, implicit or mismatched CFTC receipts', () => {
  const contract = 'ZCASH';
  const reportDate = '2026-10-20';
  const url =
    'https://publicreporting.cftc.gov/resource/jun7-fc8e.json?' +
    new URLSearchParams({
      market_and_exchange_names: contract,
      report_date_as_yyyy_mm_dd: reportDate,
    });
  const event = {
    source: 'us-gov-api:cftc-cot',
    sourceUrl: url,
    title: `CFTC CoT: ${contract} (${reportDate})`,
    publishedAt: reportDate + 'T00:00:00Z',
    rawHash: 'stable',
    content: 'Retained contract observation',
    sourceDocument: {
      canonicalUrl: url,
      rawHash: 'stable',
      rawText: 'Retained contract observation',
      parsedFields: { documentKind: 'cftc_contract_report', contract, reportDate },
    },
  };
  expect(cftcReceiptRepairUrls(event)).toHaveLength(4);
  expect(cftcReceiptRepairUrls({ ...event, sourceDocument: undefined })).toBeNull();
  expect(cftcReceiptRepairUrls({ ...event, source: 'news:publisher' })).toBeNull();
  expect(
    cftcReceiptRepairUrls({
      ...event,
      sourceUrl: 'https://www.cftc.gov/MarketReports/CommitmentsofTraders/index.htm',
    })
  ).toBeNull();
  expect(
    cftcReceiptRepairUrls({
      ...event,
      sourceDocument: { ...event.sourceDocument, rawText: 'Unrelated content' },
    })
  ).toBeNull();
  expect(
    cftcReceiptRepairUrls({
      ...event,
      sourceDocument: { ...event.sourceDocument, canonicalUrl: 'https://publisher.example/other' },
    })
  ).toBeNull();
  expect(
    cftcReceiptRepairUrls({
      ...event,
      sourceDocument: {
        ...event.sourceDocument,
        parsedFields: { ...event.sourceDocument.parsedFields, contract: 'GULF OIL' },
      },
    })
  ).toBeNull();
});
