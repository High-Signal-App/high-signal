import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/server';
import { describe, expect, it, vi } from 'vitest';
import worker from '../index';
import {
  createCachedPublicJsonReader,
  createHighSignalMcpHandler,
  HIGH_SIGNAL_MCP_SERVER_CARD,
  type HighSignalMcpDependencies,
} from '../mcp';

const executionContext: ExecutionContext = {
  waitUntil: vi.fn(),
  passThroughOnException: vi.fn(),
  props: {},
};

function mcpRequest(method: string, params: Record<string, unknown> = {}, origin?: string) {
  const headers = new Headers({
    Accept: 'application/json, text/event-stream',
    'Content-Type': 'application/json',
    Host: 'api.highsignal.app',
  });
  if (origin) headers.set('Origin', origin);
  return new Request('https://api.highsignal.app/mcp', {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
}

async function rpc(
  dependencies: HighSignalMcpDependencies,
  method: string,
  params: Record<string, unknown> = {},
  origin?: string
) {
  const handler = createHighSignalMcpHandler(dependencies);
  const response = await handler(mcpRequest(method, params, origin), {}, executionContext);
  return { response, body: await parseMcpBody(response) };
}

async function parseMcpBody(response: Response) {
  const raw = await response.text();
  const payload = response.headers.get('content-type')?.includes('text/event-stream')
    ? raw
        .split('\n')
        .find((line) => line.startsWith('data: '))
        ?.slice('data: '.length)
    : raw;
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(payload ?? '{}') as Record<string, unknown>;
  } catch {
    body = { raw: payload };
  }
  return body;
}

function result(body: Record<string, unknown>) {
  const value = body['result'];
  expect(value).toBeTypeOf('object');
  return value as Record<string, unknown>;
}

function structuredContent(body: Record<string, unknown>) {
  const structured = result(body)['structuredContent'];
  expect(structured).toBeTypeOf('object');
  return structured as Record<string, unknown>;
}

describe('High Signal MCP', () => {
  it('routes safe anonymous GETs through the cached public entrypoint', async () => {
    const publicFetch = vi.fn(async () => Response.json({ cached: true }));
    const response = await worker.fetch(
      new Request('https://api.highsignal.app/data/daily'),
      { DB: {} as D1Database, ENVIRONMENT: 'test' },
      {
        ...executionContext,
        exports: { PublicApi: { fetch: publicFetch } },
      } as unknown as ExecutionContext
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ cached: true });
    expect(publicFetch).toHaveBeenCalledOnce();
  });

  it('publishes a cacheable, anonymous MCP Server Card', async () => {
    const response = await worker.fetch(
      new Request('https://api.highsignal.app/mcp/server-card'),
      { DB: {} as D1Database, ENVIRONMENT: 'test' },
      executionContext
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/mcp-server-card+json');
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(await response.json()).toEqual(HIGH_SIGNAL_MCP_SERVER_CARD);
  });

  it('routes the public Worker endpoint to the MCP handler', async () => {
    const response = await worker.fetch(
      mcpRequest('tools/list'),
      { DB: {} as D1Database, ENVIRONMENT: 'test' },
      executionContext
    );
    const tools = result(await parseMcpBody(response))['tools'] as Array<Record<string, unknown>>;

    expect(response.status).toBe(200);
    expect(tools.map((tool) => tool['name'])).toEqual([
      'get_daily_brief',
      'get_signal',
      'get_daily_dump',
      'get_source_coverage',
      'search_signals',
      'browse_source',
      'get_track_record',
      'get_entity',
    ]);
  });

  it('exposes eight stable read-only tools', async () => {
    const readPublicJson = vi.fn();
    const { response, body } = await rpc({ readPublicJson }, 'tools/list');

    expect(response.status).toBe(200);
    const tools = result(body)['tools'] as Array<Record<string, unknown>>;
    expect(tools.map((tool) => tool['name'])).toEqual([
      'get_daily_brief',
      'get_signal',
      'get_daily_dump',
      'get_source_coverage',
      'search_signals',
      'browse_source',
      'get_track_record',
      'get_entity',
    ]);
    expect(
      tools.every((tool) => (tool['annotations'] as Record<string, unknown>)['readOnlyHint'])
    ).toBe(true);
    expect(readPublicJson).not.toHaveBeenCalled();
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });

  it('uses IST for today and yesterday without changing the tool contract', async () => {
    const readPublicJson = vi.fn(async (path: string) => {
      if (path.startsWith('/data/sources')) {
        return {
          status: 200,
          body: { sources: [{ id: 'hackernews', runStatus: 'success_with_data' }], total: 1 },
          cacheStatus: 'API-HIT',
        };
      }
      return {
        status: 200,
        body: { generatedAt: '2026-08-26T20:00:00.000Z', path },
        cacheStatus: 'API-HIT',
      };
    });
    const dependencies = {
      readPublicJson,
      now: () => new Date('2026-08-26T20:00:00.000Z'),
    };

    const today = await rpc(dependencies, 'tools/call', {
      name: 'get_daily_brief',
      arguments: { day: 'today' },
    });
    const yesterday = await rpc(dependencies, 'tools/call', {
      name: 'get_daily_brief',
      arguments: { day: 'yesterday' },
    });

    expect(readPublicJson).toHaveBeenCalledWith('/brief/daily');
    expect(readPublicJson).toHaveBeenCalledWith('/brief/daily?date=2026-08-26');
    expect(readPublicJson).toHaveBeenCalledWith('/data/sources?samples=0');
    expect(structuredContent(today.body)).toMatchObject({
      schemaVersion: '2',
      dataUpdatedAt: '2026-08-26T20:00:00.000Z',
      tool: 'get_daily_brief',
      snapshotId: 'hs-2026-08-27',
      reportingWindow: { date: '2026-08-27', timeZone: 'Asia/Kolkata' },
    });
    expect(result(yesterday.body)['isError']).not.toBe(true);
  });

  it('returns the complete daily dump and defaults its date to the current IST day', async () => {
    const readPublicJson = vi.fn(async (path: string) => ({
      status: 200,
      body: {
        generatedAt: '2026-08-26T20:00:00.000Z',
        path,
        signals: [],
        evidenceEvents: [],
        attention: {},
      },
      cacheStatus: 'API-MISS',
    }));

    const { body } = await rpc(
      {
        readPublicJson,
        now: () => new Date('2026-08-26T20:00:00.000Z'),
      },
      'tools/call',
      { name: 'get_daily_dump', arguments: {} }
    );

    expect(readPublicJson).toHaveBeenCalledWith('/data/daily?date=2026-08-27');
    expect(structuredContent(body)).toMatchObject({
      schemaVersion: '2',
      tool: 'get_daily_dump',
      cache: { dailyDump: 'API-MISS' },
      data: { signals: [], evidenceEvents: [], attention: {} },
      snapshotId: 'hs-2026-08-27',
    });
  });

  it('does not expose older daily dumps to agents', async () => {
    const readPublicJson = vi.fn();
    const { body } = await rpc(
      {
        readPublicJson,
        now: () => new Date('2026-08-26T20:00:00.000Z'),
      },
      'tools/call',
      { name: 'get_daily_dump', arguments: { date: '2026-08-25' } }
    );

    expect(result(body)['isError']).toBe(true);
    expect(structuredContent(body)).toMatchObject({
      error: { code: 'history_verification_required', status: 403 },
    });
    expect(readPublicJson).not.toHaveBeenCalled();
  });

  it('combines signal detail, evidence events, claims, and related signals into one proof result', async () => {
    const readPublicJson = vi.fn(async (path: string) => {
      if (path.endsWith('/evidence')) {
        return { status: 200, body: { evidenceEvents: [{ id: 'e-1' }] }, cacheStatus: 'API-HIT' };
      }
      if (path.startsWith('/claims/')) {
        return { status: 200, body: { claims: [{ id: 'c-1' }] }, cacheStatus: 'API-HIT' };
      }
      if (path.startsWith('/signals/by-entity/')) {
        return {
          status: 200,
          body: {
            signals: [
              { slug: 'proof-bearing-signal', id: 's-1' },
              { slug: 'related-signal', id: 's-2' },
            ],
          },
          cacheStatus: 'API-HIT',
        };
      }
      return {
        status: 200,
        body: {
          signal: { slug: 'proof-bearing-signal', primaryEntityId: 'OPENAI' },
          evidence: [],
          scores: [],
        },
        cacheStatus: 'API-MISS',
      };
    });

    const { body } = await rpc({ readPublicJson }, 'tools/call', {
      name: 'get_signal',
      arguments: { signal_id: 'proof-bearing-signal' },
    });

    expect(readPublicJson).toHaveBeenCalledTimes(4);
    expect(readPublicJson).toHaveBeenCalledWith('/signals/by-entity/OPENAI');
    expect(structuredContent(body)).toMatchObject({
      tool: 'get_signal',
      data: {
        signal: { slug: 'proof-bearing-signal', primaryEntityId: 'OPENAI' },
        proofs: {
          evidence: { evidenceEvents: [{ id: 'e-1' }] },
          claims: { claims: [{ id: 'c-1' }] },
        },
        relatedSignals: [{ slug: 'related-signal', id: 's-2' }],
      },
    });
  });

  it('preserves the history boundary as a structured tool error', async () => {
    const readPublicJson = vi.fn(async () => ({
      status: 403,
      body: { error: 'history_verification_required' },
      cacheStatus: null,
    }));

    const { body } = await rpc({ readPublicJson }, 'tools/call', {
      name: 'get_signal',
      arguments: { signal_id: 'older-signal' },
    });

    expect(result(body)['isError']).toBe(true);
    expect(structuredContent(body)).toMatchObject({
      error: {
        code: 'history_verification_required',
        status: 403,
      },
    });
    expect(readPublicJson).toHaveBeenCalledTimes(1);
  });

  it('returns source coverage with a coverage summary and snapshot metadata', async () => {
    const readPublicJson = vi.fn(async () => ({
      status: 200,
      body: {
        sources: [
          { id: 'hackernews', runStatus: 'success_with_data' },
          { id: 'edgar', runStatus: 'success_with_data' },
          { id: 'patents', runStatus: 'parked' },
          { id: 'bluesky', runStatus: 'parked' },
          { id: 'guardian', runStatus: 'parked' },
        ],
        total: 100,
        available: true,
      },
      cacheStatus: 'API-HIT',
    }));
    const dependencies = {
      readPublicJson,
      now: () => new Date('2026-08-26T20:00:00.000Z'),
    };

    const { body } = await rpc(dependencies, 'tools/call', {
      name: 'get_source_coverage',
      arguments: { samples: 3 },
    });

    expect(readPublicJson).toHaveBeenCalledWith('/data/sources?samples=3');
    expect(structuredContent(body)).toMatchObject({
      tool: 'get_source_coverage',
      snapshotId: 'hs-2026-08-27',
      data: {
        coverageSummary: { configured: 5, healthy: 2, disabled: 3 },
      },
    });
  });

  it('searches signals with entity, type, and confidence filters', async () => {
    const readPublicJson = vi.fn(async () => ({
      status: 200,
      body: { signals: [{ slug: 'test-signal', id: 's-1' }], withheldCount: 0 },
      cacheStatus: 'API-MISS',
    }));
    const dependencies = {
      readPublicJson,
      now: () => new Date('2026-08-26T20:00:00.000Z'),
    };

    const { body } = await rpc(dependencies, 'tools/call', {
      name: 'search_signals',
      arguments: { entity: 'OPENAI', type: 'new_product_launch', confidence: 'high', limit: 10 },
    });

    expect(readPublicJson).toHaveBeenCalledWith(
      '/signals?status=published&limit=10&entity=OPENAI&type=new_product_launch&confidence=high'
    );
    expect(structuredContent(body)).toMatchObject({
      tool: 'search_signals',
      snapshotId: 'hs-2026-08-27',
      data: { signals: [{ slug: 'test-signal', id: 's-1' }] },
    });
  });

  it('browses source events with cursor pagination', async () => {
    const readPublicJson = vi.fn(async () => ({
      status: 200,
      body: {
        id: 'hackernews',
        total: 500,
        events: [{ title: 'Show HN: Foo', url: 'https://news.ycombinator.com/item?id=1' }],
        hasMore: true,
        nextCursor: 'abc123',
        available: true,
      },
      cacheStatus: 'API-HIT',
    }));
    const dependencies = {
      readPublicJson,
      now: () => new Date('2026-08-26T20:00:00.000Z'),
    };

    const { body } = await rpc(dependencies, 'tools/call', {
      name: 'browse_source',
      arguments: { source_id: 'hackernews', limit: 50, cursor: 'abc123' },
    });

    expect(readPublicJson).toHaveBeenCalledWith('/data/sources/hackernews?limit=50&cursor=abc123');
    expect(structuredContent(body)).toMatchObject({
      tool: 'browse_source',
      snapshotId: 'hs-2026-08-27',
      data: { id: 'hackernews', total: 500, hasMore: true, nextCursor: 'abc123' },
    });
  });

  it('returns the track record with cohort filter', async () => {
    const readPublicJson = vi.fn(async () => ({
      status: 200,
      body: {
        buckets: [
          { signalType: 'new_product_launch', count: 20, matured: 10, hits: 6, hitRate: 0.6 },
        ],
        summary: { total: 100, matured: 50, pending: 50 },
      },
      cacheStatus: 'API-HIT',
    }));
    const dependencies = {
      readPublicJson,
      now: () => new Date('2026-08-26T20:00:00.000Z'),
    };

    const { body } = await rpc(dependencies, 'tools/call', {
      name: 'get_track_record',
      arguments: { cohort: 'live' },
    });

    expect(readPublicJson).toHaveBeenCalledWith('/track-record?cohort=live');
    expect(structuredContent(body)).toMatchObject({
      tool: 'get_track_record',
      snapshotId: 'hs-2026-08-27',
      data: {
        buckets: [{ signalType: 'new_product_launch', hitRate: 0.6 }],
      },
    });
  });

  it('returns entity detail with relationships and signals', async () => {
    const readPublicJson = vi.fn(async () => ({
      status: 200,
      body: {
        entity: { id: 'OPENAI', name: 'OpenAI Inc.', type: 'private' },
        relationships: [{ fromEntityId: 'MSFT', toEntityId: 'OPENAI', type: 'partner' }],
        signals: [{ slug: 'openai-signal', id: 's-1' }],
        marketQuotes: [],
      },
      cacheStatus: 'API-MISS',
    }));
    const dependencies = {
      readPublicJson,
      now: () => new Date('2026-08-26T20:00:00.000Z'),
    };

    const { body } = await rpc(dependencies, 'tools/call', {
      name: 'get_entity',
      arguments: { entity_id: 'OPENAI' },
    });

    expect(readPublicJson).toHaveBeenCalledWith('/entities/OPENAI');
    expect(structuredContent(body)).toMatchObject({
      tool: 'get_entity',
      snapshotId: 'hs-2026-08-27',
      data: {
        entity: { id: 'OPENAI', name: 'OpenAI Inc.' },
        relationships: [{ type: 'partner' }],
      },
    });
  });

  it('rejects unapproved browser origins while accepting origin-less clients', async () => {
    const dependencies = { readPublicJson: vi.fn() };
    const blocked = await rpc(dependencies, 'tools/list', {}, 'https://evil.example');
    const allowed = await rpc(dependencies, 'tools/list');

    expect(blocked.response.status).toBe(403);
    expect(allowed.response.status).toBe(200);
  });

  it('reuses the existing public Cache API path for repeated MCP data reads', async () => {
    const entries = new Map<string, Response>();
    const cache = {
      match: vi.fn(async (request: Request) => entries.get(request.url)?.clone()),
      put: vi.fn(async (request: Request, response: Response) => {
        entries.set(request.url, response.clone());
      }),
    };
    const fetchPublic = vi.fn(async () => Response.json({ generatedAt: '2026-08-26T00:00:00Z' }));
    const reader = createCachedPublicJsonReader({ cache, fetchPublic });

    const miss = await reader('/data/daily?date=2026-08-26');
    const hit = await reader('/data/daily?date=2026-08-26');

    expect(miss.cacheStatus).toBe('API-MISS');
    expect(hit.cacheStatus).toBe('API-HIT');
    expect(fetchPublic).toHaveBeenCalledTimes(1);
    expect(cache.put).toHaveBeenCalledTimes(1);
  });

  it('speaks the current MCP protocol during initialization', async () => {
    const { response, body } = await rpc({ readPublicJson: vi.fn() }, 'initialize', {
      protocolVersion: LATEST_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'high-signal-test', version: '1.0.0' },
    });

    expect(response.status).toBe(200);
    expect(result(body)).toMatchObject({
      protocolVersion: LATEST_PROTOCOL_VERSION,
      serverInfo: { name: 'high-signal', version: '2.0.0', title: 'High Signal' },
      capabilities: { tools: {} },
    });
  });
});
