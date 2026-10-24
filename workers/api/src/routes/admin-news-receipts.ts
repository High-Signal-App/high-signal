import { Hono } from 'hono';
import { sha16 } from '../lib/ids';

type Env = { DB: D1Database };
type EventState = {
  id: string;
  source: string;
  sourceUrl: string;
  title: string | null;
  content: string | null;
  publishedAt: number;
  primaryEntityId: string | null;
  rawHash: string;
  fetchRunId: string | null;
  sourceDocumentId: string;
};
type DocumentState = {
  id: string;
  source: string;
  canonicalUrl: string;
  documentKey: string;
  fetchedAt: number;
  publishedAt: number | null;
  rawHash: string;
  rawText: string | null;
  rawJson: string | null;
  parsedFields: string | null;
};
type ReceiptState = { event: EventState; document: DocumentState };
const EVENT_KEYS = [
  'id',
  'source',
  'sourceUrl',
  'title',
  'content',
  'publishedAt',
  'primaryEntityId',
  'rawHash',
  'fetchRunId',
  'sourceDocumentId',
];
const DOCUMENT_KEYS = [
  'id',
  'source',
  'canonicalUrl',
  'documentKey',
  'fetchedAt',
  'publishedAt',
  'rawHash',
  'rawText',
  'rawJson',
  'parsedFields',
];

function exactKeys(value: unknown, keys: string[]): value is Record<string, unknown> {
  return (
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => key in value)
  );
}

function validState(value: unknown): value is ReceiptState {
  if (!exactKeys(value, ['event', 'document'])) return false;
  const state = value as unknown as ReceiptState;
  if (!exactKeys(state.event, EVENT_KEYS) || !exactKeys(state.document, DOCUMENT_KEYS))
    return false;
  const e = state.event;
  const d = state.document;
  return (
    typeof e.id === 'string' &&
    typeof e.source === 'string' &&
    typeof e.sourceUrl === 'string' &&
    (e.title === null || typeof e.title === 'string') &&
    (e.content === null || typeof e.content === 'string') &&
    Number.isSafeInteger(e.publishedAt) &&
    (e.primaryEntityId === null || typeof e.primaryEntityId === 'string') &&
    typeof e.rawHash === 'string' &&
    (e.fetchRunId === null || typeof e.fetchRunId === 'string') &&
    typeof e.sourceDocumentId === 'string' &&
    typeof d.id === 'string' &&
    typeof d.source === 'string' &&
    typeof d.canonicalUrl === 'string' &&
    typeof d.documentKey === 'string' &&
    Number.isSafeInteger(d.fetchedAt) &&
    (d.publishedAt === null || Number.isSafeInteger(d.publishedAt)) &&
    typeof d.rawHash === 'string' &&
    (d.rawText === null || typeof d.rawText === 'string') &&
    (d.rawJson === null || typeof d.rawJson === 'string') &&
    (d.parsedFields === null || typeof d.parsedFields === 'string')
  );
}

async function readBody(c: {
  req: { raw: { body: ReadableStream<Uint8Array> | null } };
}): Promise<Record<string, unknown> | null> {
  const stream = c.req.raw.body;
  if (!stream) return null;
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 100_000) {
        await reader.cancel();
        return null;
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  const text = new TextDecoder().decode(
    chunks.reduce((all, chunk) => {
      const merged = new Uint8Array(all.length + chunk.length);
      merged.set(all);
      merged.set(chunk, all.length);
      return merged;
    }, new Uint8Array())
  );
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function samePublisher(left: string, right: string): boolean {
  try {
    const a = new URL(left);
    const b = new URL(right);
    if (
      a.protocol !== 'https:' ||
      b.protocol !== 'https:' ||
      a.username ||
      a.password ||
      b.username ||
      b.password
    )
      return false;
    const host = (value: string) => value.toLowerCase().replace(/^www\./, '');
    return host(a.hostname) === host(b.hostname);
  } catch {
    return false;
  }
}

export const newsReceiptAdminRoute = new Hono<{ Bindings: Env }>();

async function fingerprint(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function textHash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function loadState(binding: D1Database, eventId: string): Promise<ReceiptState | null> {
  const row = await binding
    .prepare(
      `SELECT e.id AS event_id,e.source AS event_source,e.source_url,e.title AS event_title,
        e.content AS event_content,e.published_at,e.primary_entity_id,e.raw_hash AS event_raw_hash,
        e.fetch_run_id,e.source_document_id,s.id AS document_id,s.source AS document_source,
        s.canonical_url,s.document_key,s.fetched_at,s.published_at AS document_published_at,
        s.raw_hash AS document_raw_hash,s.raw_text,s.raw_json,s.parsed_fields
       FROM events e JOIN source_documents s ON s.id=e.source_document_id WHERE e.id=? LIMIT 1`
    )
    .bind(eventId)
    .first<Record<string, unknown>>();
  if (!row) return null;
  return {
    event: {
      id: String(row['event_id']),
      source: String(row['event_source']),
      sourceUrl: String(row['source_url']),
      title: row['event_title'] == null ? null : String(row['event_title']),
      content: row['event_content'] == null ? null : String(row['event_content']),
      publishedAt: Number(row['published_at']),
      primaryEntityId: row['primary_entity_id'] == null ? null : String(row['primary_entity_id']),
      rawHash: String(row['event_raw_hash']),
      fetchRunId: row['fetch_run_id'] == null ? null : String(row['fetch_run_id']),
      sourceDocumentId: String(row['source_document_id']),
    },
    document: {
      id: String(row['document_id']),
      source: String(row['document_source']),
      canonicalUrl: String(row['canonical_url']),
      documentKey: String(row['document_key']),
      fetchedAt: Number(row['fetched_at']),
      publishedAt:
        row['document_published_at'] == null ? null : Number(row['document_published_at']),
      rawHash: String(row['document_raw_hash']),
      rawText: row['raw_text'] == null ? null : String(row['raw_text']),
      rawJson: row['raw_json'] == null ? null : String(row['raw_json']),
      parsedFields: row['parsed_fields'] == null ? null : String(row['parsed_fields']),
    },
  };
}

function isRecoverable(state: ReceiptState): boolean {
  const { event, document } = state;
  return (
    event.source.startsWith('news:') &&
    event.content === null &&
    event.title !== null &&
    document.publishedAt === event.publishedAt &&
    event.sourceDocumentId === document.id &&
    document.source === event.source &&
    document.rawText === null &&
    document.rawJson === null
  );
}

async function hasOriginalIdentity(state: ReceiptState): Promise<boolean> {
  return (await sha16(state.event.rawHash)) === state.event.id;
}

function eventBindings(event: EventState): unknown[] {
  return [
    event.id,
    event.source,
    event.sourceUrl,
    event.title,
    event.content,
    event.publishedAt,
    event.primaryEntityId,
    event.rawHash,
    event.fetchRunId,
    event.sourceDocumentId,
  ];
}

function documentBindings(document: DocumentState): unknown[] {
  return [
    document.id,
    document.source,
    document.canonicalUrl,
    document.documentKey,
    document.fetchedAt,
    document.publishedAt,
    document.rawHash,
    document.rawText,
    document.rawJson,
    document.parsedFields,
  ];
}

const eventExists = `EXISTS (
  SELECT 1 FROM events e WHERE e.id=? AND e.source=? AND e.source_url=? AND e.title IS ?
    AND e.content IS ? AND e.published_at=? AND e.primary_entity_id IS ? AND e.raw_hash=?
    AND e.fetch_run_id IS ? AND e.source_document_id=?
)`;

function documentWhere(): string {
  return `id=? AND source=? AND canonical_url=? AND document_key=? AND fetched_at=?
    AND published_at IS ? AND raw_hash=? AND raw_text IS ? AND raw_json IS ? AND parsed_fields IS ?`;
}

newsReceiptAdminRoute.get('/:eventId', async (c) => {
  if (!/^[a-f0-9]{16}$/.test(c.req.param('eventId')))
    return c.json({ error: 'invalid_event_id' }, 400);
  const state = await loadState(c.env.DB, c.req.param('eventId'));
  if (!state) return c.json({ error: 'not_found' }, 404);
  if (!(await hasOriginalIdentity(state))) return c.json({ error: 'invalid_event_identity' }, 409);
  if (!isRecoverable(state)) {
    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = state.document.parsedFields
        ? (JSON.parse(state.document.parsedFields) as Record<string, unknown>)
        : null;
    } catch {
      /* malformed receipt */
    }
    let raw: Record<string, unknown> | null = null;
    try {
      raw = state.document.rawJson
        ? (JSON.parse(state.document.rawJson) as Record<string, unknown>)
        : null;
    } catch {
      /* malformed receipt */
    }
    const marker = raw?.['receiptRecovery'] as Record<string, unknown> | undefined;
    if (
      state.event.content !== null ||
      !state.event.source.startsWith('news:') ||
      parsed?.['receiptRecoveryEventId'] !== state.event.id ||
      parsed?.['retrievedFrom'] !== 'public_article_page' ||
      !state.document.rawText ||
      marker?.['bodyHash'] !== state.document.rawHash ||
      marker?.['bodyChars'] !== state.document.rawText.length ||
      (await textHash(state.document.rawText)) !== state.document.rawHash
    ) {
      return c.json({ error: 'not_metadata_only_news' }, 409);
    }
    return c.json({
      state: {
        event: state.event,
        document: { ...state.document, rawText: null, rawJson: null, parsedFields: null },
      },
      fingerprint: await fingerprint(state),
      receipt: {
        bodyHash: state.document.rawHash,
        bodyChars: state.document.rawText.length,
        applied: true,
      },
    });
  }
  if (!(await hasOriginalIdentity(state))) {
    return c.json({ error: 'not_metadata_only_news' }, 409);
  }
  return c.json({ state, fingerprint: await fingerprint(state) });
});

newsReceiptAdminRoute.post('/:eventId/apply', async (c) => {
  if (!/^[a-f0-9]{16}$/.test(c.req.param('eventId')))
    return c.json({ error: 'invalid_event_id' }, 400);
  const body = (await readBody(c)) ?? {};
  const before = body['before'];
  const rawText = body?.['rawText'];
  if (
    !validState(before) ||
    before.event.id !== c.req.param('eventId') ||
    !isRecoverable(before) ||
    !(await hasOriginalIdentity(before)) ||
    !/^[a-f0-9]{64}$/.test(String(body?.['fingerprint'] ?? '')) ||
    typeof rawText !== 'string' ||
    rawText.length < 500 ||
    rawText.length > 30_000 ||
    !/^[a-f0-9]{64}$/.test(String(body?.['rawHash'] ?? '')) ||
    (await textHash(rawText)) !== body?.['rawHash'] ||
    !Number.isSafeInteger(body?.['fetchedAt']) ||
    typeof body?.['rawJson'] !== 'string' ||
    (body['rawJson'] as string).length > 10_000 ||
    typeof body?.['parsedFields'] !== 'string' ||
    (body['parsedFields'] as string).length > 4_000 ||
    Number(body?.['fetchedAt']) < before?.document.fetchedAt ||
    Number(body?.['fetchedAt']) > Math.floor(Date.now() / 1000) + 300
  ) {
    return c.json({ error: 'invalid_recovery' }, 400);
  }
  try {
    const parsedFields = JSON.parse(body['parsedFields'] as string) as Record<string, unknown>;
    const rawJson = JSON.parse(body['rawJson'] as string) as Record<string, unknown>;
    const receiptRecovery = rawJson['receiptRecovery'] as Record<string, unknown> | undefined;
    const originalDocument = receiptRecovery?.['originalDocument'] as
      | Record<string, unknown>
      | undefined;
    const retrievedUrl = String(parsedFields['retrievedUrl']);
    const originalDocumentMatches =
      exactKeys(originalDocument, DOCUMENT_KEYS) &&
      (Object.keys(before.document) as Array<keyof DocumentState>).every(
        (key) => originalDocument[key] === before.document[key]
      );
    if (
      parsedFields['documentKind'] !== 'news_article' ||
      parsedFields['retrievedFrom'] !== 'public_article_page' ||
      parsedFields['receiptRecoveryEventId'] !== before.event.id ||
      !samePublisher(retrievedUrl, before.event.sourceUrl) ||
      !samePublisher(retrievedUrl, before.document.canonicalUrl) ||
      receiptRecovery?.['bodyHash'] !== body['rawHash'] ||
      receiptRecovery?.['retrievedUrl'] !== parsedFields['retrievedUrl'] ||
      receiptRecovery?.['bodyChars'] !== rawText.length ||
      !originalDocumentMatches
    )
      return c.json({ error: 'invalid_recovery_provenance' }, 400);
  } catch {
    return c.json({ error: 'invalid_recovery_json' }, 400);
  }
  if ((await fingerprint(before)) !== body['fingerprint'])
    return c.json({ error: 'invalid_snapshot' }, 400);
  const current = await loadState(c.env.DB, before.event.id);
  if (
    !current ||
    (await fingerprint(current)) !== body['fingerprint'] ||
    !isRecoverable(current) ||
    !(await hasOriginalIdentity(current))
  ) {
    return c.json({ error: 'compare_and_swap_failed' }, 409);
  }
  const next: DocumentState = {
    ...before.document,
    fetchedAt: body['fetchedAt'] as number,
    rawHash: body['rawHash'] as string,
    rawText,
    rawJson: body['rawJson'] as string,
    parsedFields: body['parsedFields'] as string,
  };
  const result = await c.env.DB.prepare(
    `UPDATE source_documents SET fetched_at=?,raw_hash=?,raw_text=?,raw_json=?,parsed_fields=?
       WHERE ${documentWhere()} AND ${eventExists}`
  )
    .bind(
      next.fetchedAt,
      next.rawHash,
      next.rawText,
      next.rawJson,
      next.parsedFields,
      ...documentBindings(before.document),
      ...eventBindings(before.event)
    )
    .run();
  if (result.meta.changes !== 1) return c.json({ error: 'compare_and_swap_failed' }, 409);
  const after = await loadState(c.env.DB, before.event.id);
  if (!after || (await fingerprint(after.document)) !== (await fingerprint(next))) {
    return c.json({ error: 'post_write_verification_failed' }, 500);
  }
  return c.json({
    state: {
      event: after.event,
      document: { ...after.document, rawText: null, rawJson: null, parsedFields: null },
    },
    fingerprint: await fingerprint(after),
    receipt: { bodyHash: after.document.rawHash, bodyChars: after.document.rawText?.length ?? 0 },
  });
});

newsReceiptAdminRoute.post('/:eventId/rollback', async (c) => {
  if (!/^[a-f0-9]{16}$/.test(c.req.param('eventId')))
    return c.json({ error: 'invalid_event_id' }, 400);
  const body = (await readBody(c)) ?? {};
  const before = body['before'];
  if (
    !validState(before) ||
    before.event.id !== c.req.param('eventId') ||
    !isRecoverable(before) ||
    !(await hasOriginalIdentity(before)) ||
    !/^[a-f0-9]{64}$/.test(String(body?.['afterFingerprint'] ?? ''))
  )
    return c.json({ error: 'invalid_rollback' }, 400);
  const current = await loadState(c.env.DB, before.event.id);
  if (
    !current ||
    (await fingerprint(current)) !== body['afterFingerprint'] ||
    !(await hasOriginalIdentity(current))
  ) {
    return c.json({ error: 'compare_and_swap_failed' }, 409);
  }
  let parsed: Record<string, unknown>;
  let raw: Record<string, unknown>;
  try {
    parsed = JSON.parse(current.document.parsedFields ?? '') as Record<string, unknown>;
    raw = JSON.parse(current.document.rawJson ?? '') as Record<string, unknown>;
  } catch {
    return c.json({ error: 'rollback_verification_failed' }, 409);
  }
  const recovery = raw['receiptRecovery'] as Record<string, unknown> | undefined;
  const originalDocument = recovery?.['originalDocument'];
  if (
    !exactKeys(originalDocument, DOCUMENT_KEYS) ||
    !DOCUMENT_KEYS.every(
      (key) => originalDocument[key] === before.document[key as keyof DocumentState]
    ) ||
    parsed['receiptRecoveryEventId'] !== before.event.id ||
    parsed['retrievedFrom'] !== 'public_article_page' ||
    recovery?.['bodyHash'] !== current.document.rawHash ||
    recovery?.['bodyChars'] !== current.document.rawText?.length ||
    !current.document.rawText ||
    (await textHash(current.document.rawText)) !== current.document.rawHash ||
    parsed['retrievedUrl'] !== recovery['retrievedUrl'] ||
    !samePublisher(String(parsed['retrievedUrl']), before.event.sourceUrl) ||
    !samePublisher(String(parsed['retrievedUrl']), before.document.canonicalUrl)
  ) {
    return c.json({ error: 'rollback_verification_failed' }, 409);
  }
  const expected = current.document;
  const original = before.document;
  const result = await c.env.DB.prepare(
    `UPDATE source_documents SET fetched_at=?,raw_hash=?,raw_text=?,raw_json=?,parsed_fields=?
       WHERE ${documentWhere()} AND ${eventExists}`
  )
    .bind(
      original.fetchedAt,
      original.rawHash,
      original.rawText,
      original.rawJson,
      original.parsedFields,
      ...documentBindings(expected),
      ...eventBindings(before.event)
    )
    .run();
  if (result.meta.changes !== 1) return c.json({ error: 'compare_and_swap_failed' }, 409);
  const restored = await loadState(c.env.DB, before.event.id);
  if (!restored || (await fingerprint(restored)) !== (await fingerprint(before))) {
    return c.json({ error: 'rollback_verification_failed' }, 500);
  }
  return c.json({ state: restored, fingerprint: await fingerprint(restored) });
});
