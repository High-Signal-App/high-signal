import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/server';
import { describe, expect, it, vi } from 'vitest';
import worker from '../index';
import {
  createCachedPublicJsonReader,
  createHighSignalMcpHandler,
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
    ]);
  });

  it('exposes exactly three stable read-only tools', async () => {
    const readPublicJson = vi.fn();
    const { response, body } = await rpc({ readPublicJson }, 'tools/list');

    expect(response.status).toBe(200);
    const tools = result(body)['tools'] as Array<Record<string, unknown>>;
    expect(tools.map((tool) => tool['name'])).toEqual([
      'get_daily_brief',
      'get_signal',
      'get_daily_dump',
    ]);
    expect(
      tools.every((tool) => (tool['annotations'] as Record<string, unknown>)['readOnlyHint'])
    ).toBe(true);
    expect(readPublicJson).not.toHaveBeenCalled();
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });

  it('uses IST for today and yesterday without changing the tool contract', async () => {
    const readPublicJson = vi.fn(async (path: string) => ({
      status: 200,
      body: { generatedAt: '2026-08-26T20:00:00.000Z', path },
      cacheStatus: 'API-HIT',
    }));
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

    expect(readPublicJson).toHaveBeenNthCalledWith(1, '/brief/daily');
    expect(readPublicJson).toHaveBeenNthCalledWith(2, '/brief/daily?date=2026-08-26');
    expect(structuredContent(today.body)).toMatchObject({
      schemaVersion: '1',
      dataUpdatedAt: '2026-08-26T20:00:00.000Z',
      tool: 'get_daily_brief',
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
      schemaVersion: '1',
      tool: 'get_daily_dump',
      cache: { dailyDump: 'API-MISS' },
      data: { signals: [], evidenceEvents: [], attention: {} },
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

  it('combines signal detail, evidence events, and claims into one proof result', async () => {
    const readPublicJson = vi.fn(async (path: string) => {
      if (path.endsWith('/evidence')) {
        return { status: 200, body: { evidenceEvents: [{ id: 'e-1' }] }, cacheStatus: 'API-HIT' };
      }
      if (path.startsWith('/claims/')) {
        return { status: 200, body: { claims: [{ id: 'c-1' }] }, cacheStatus: 'API-HIT' };
      }
      return {
        status: 200,
        body: { signal: { slug: 'proof-bearing-signal' }, evidence: [], scores: [] },
        cacheStatus: 'API-MISS',
      };
    });

    const { body } = await rpc({ readPublicJson }, 'tools/call', {
      name: 'get_signal',
      arguments: { signal_id: 'proof-bearing-signal' },
    });

    expect(readPublicJson).toHaveBeenCalledTimes(3);
    expect(structuredContent(body)).toMatchObject({
      tool: 'get_signal',
      data: {
        signal: { slug: 'proof-bearing-signal' },
        proofs: {
          evidence: { evidenceEvents: [{ id: 'e-1' }] },
          claims: { claims: [{ id: 'c-1' }] },
        },
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
      serverInfo: { name: 'high-signal', version: '1.0.0', title: 'High Signal' },
      capabilities: { tools: {} },
    });
  });
});
