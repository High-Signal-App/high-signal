import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeApiRoute, observeApiRequest, stageTimingProps } from '../app-health';
import { observeStages } from '../lib/server-timing';
import { diagnosticSourceFamily } from '../routes/data';
import { applyMigrations, createSqliteD1 } from '../../test/sqlite-d1';
import worker from '../index';
import { observationContext } from '@high-signal/shared/observation-context.mjs';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('bounded observation context', () => {
  const release = 'a'.repeat(40);

  it('does not turn browser or publisher declarations into proven natural traffic', () => {
    const browser = new Request('https://api.example/brief/daily?region=private-value', {
      headers: { 'user-agent': 'Mozilla/5.0 private-browser', authorization: 'Bearer synthetic' },
    });
    expect(observationContext(browser)).toEqual({
      traffic_cohort: 'unknown',
      version: 'unknown',
      version_source: 'unknown',
    });
    const declared = new Request(browser.url, {
      headers: { 'user-agent': 'HighSignal-reader-publisher/1 (synthetic-private-marker)' },
    });
    const context = observationContext(declared, { release });
    expect(context).toEqual({
      traffic_cohort: 'declared_publisher',
      version: release,
      version_source: 'app_health_release',
    });
    expect(JSON.stringify(context)).not.toMatch(/private|Bearer|region|publisher\/1/);
    expect(
      observationContext(new Request('https://api.example/brief/daily?validation=secret'))
    ).toMatchObject({ traffic_cohort: 'declared_diagnostic' });
  });

  it('uses existing bounded version sources or an explicit unknown', () => {
    expect(
      observationContext(null, { release: 'unsafe?private=value', readerSource: release })
    ).toMatchObject({ version: release, version_source: 'reader_source' });
    expect(
      observationContext(null, { cacheBuild: '1a2b3c4d-1234-5678-90ab-0123456789ab' })
    ).toMatchObject({ version_source: 'cache_build' });
    expect(observationContext(null, { cacheBuild: 'Next_build-123' })).toMatchObject({
      version: 'Next_build-123',
      version_source: 'cache_build',
    });
    for (const value of [undefined, null, {}, 'private-value', 'a'.repeat(129)]) {
      expect(observationContext(null, { release: value })).toMatchObject({
        version: 'unknown',
        version_source: 'unknown',
      });
    }
  });
});

describe('API App Health observer', () => {
  afterEach(() => vi.restoreAllMocks());

  it('records one normalized request including query-free route and latency', async () => {
    const deliveries: Promise<unknown>[] = [];
    const requests: Array<{ input: string; body: Record<string, unknown> }> = [];
    const fetchMock = vi.fn(async (input: string, init: RequestInit) => {
      requests.push({ input, body: JSON.parse(String(init.body)) as Record<string, unknown> });
      return new Response(null, { status: 202 });
    });
    vi.stubGlobal('fetch', fetchMock);
    observeApiRequest(
      new Request('https://api.example/signals/secret-slug?limit=100'),
      new Response('ok', { status: 200 }),
      Date.now() - 12,
      { APP_HEALTH_INGEST_KEY: 'secret', APP_HEALTH_ENVIRONMENT: 'production' },
      {
        waitUntil: (promise: Promise<unknown>) => deliveries.push(promise),
      } as unknown as ExecutionContext
    );
    await vi.advanceTimersByTimeAsync(5000);
    await Promise.all(deliveries);
    expect(fetchMock).toHaveBeenCalled();
    const endpoints = requests.map(({ input }) => input);
    expect(endpoints).toContain('https://ingest.sassmaker.com/v1/ingest');
    const ingest = requests.find(({ input }) => input.endsWith('/v1/ingest'))?.body as {
      events: Array<Record<string, unknown>>;
    };
    expect(ingest.events).toHaveLength(1);
    expect(ingest.events[0]).toMatchObject({
      method: 'GET',
      route: '/api/signals/:slug',
      status_code: 200,
    });
    expect(ingest.events[0]).not.toHaveProperty('query');
    if (endpoints.length > 1) expect(endpoints).toContain('https://ingest.sassmaker.com/v1/logs');
  });

  it('fails open when the ingest backend errors and when no key is configured', async () => {
    const deliveries: Promise<unknown>[] = [];
    const fetchMock = vi.fn(async () => new Response(null, { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);
    const ctx = {
      waitUntil: (promise: Promise<unknown>) => deliveries.push(promise),
    } as unknown as ExecutionContext;
    expect(() =>
      observeApiRequest(
        new Request('https://api.example/health'),
        new Response(null, { status: 200 }),
        Date.now(),
        { APP_HEALTH_INGEST_KEY: 'secret' },
        ctx
      )
    ).not.toThrow();
    await vi.advanceTimersByTimeAsync(5000);
    await Promise.all(deliveries);
    expect(() =>
      observeApiRequest(
        new Request('https://api.example/health'),
        new Response(null, { status: 200 }),
        Date.now(),
        {},
        ctx
      )
    ).not.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('only returns allowlisted templates', () => {
    expect(normalizeApiRoute('/signals/private')).toBe('/signals/:slug');
    expect(normalizeApiRoute('/unknown/private')).toBeNull();
  });
});

describe('API stage-timing logs (#198)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function observed(url: string) {
    const request = new Request(url);
    observeStages(
      request,
      [
        { name: 'snapshot', durationMs: 12.4 },
        { name: 'news-query', durationMs: 80.6 },
        { name: 'Bad Name', durationMs: 1 },
      ],
      'MISS'
    );
    return request;
  }

  it('builds fixed-name props for an ordinary measured miss only', () => {
    const miss = new Response('{}', { headers: { 'x-edge-cache': 'API-MISS' } });
    expect(
      stageTimingProps(
        observed('https://api.example/brief/daily?region=europe'),
        miss,
        '/brief/daily',
        640
      )
    ).toEqual({
      traffic_cohort: 'unknown',
      version: 'unknown',
      version_source: 'unknown',
      route: '/api/brief/daily',
      edge_cache: 'MISS',
      inner_cache: 'MISS',
      colo: 'unknown',
      status: 200,
      total_ms: 640,
      request_variant: 'current',
      snapshot_ms: 12,
      news_query_ms: 81,
    });
    expect(
      stageTimingProps(
        observed('https://api.example/brief/daily?date=2026-01-02&region=europe'),
        miss,
        '/brief/daily',
        640
      )
    ).toMatchObject({ request_variant: 'date_qualified' });

    const hit = new Response('{}', { headers: { 'x-edge-cache': 'API-HIT' } });
    expect(
      stageTimingProps(observed('https://api.example/brief/daily'), hit, '/brief/daily', 5)
    ).toBeNull();
    expect(
      stageTimingProps(
        observed('https://api.example/brief/daily?timing=1'),
        miss,
        '/brief/daily',
        5
      )
    ).toBeNull();
    expect(
      stageTimingProps(observed('https://api.example/signals'), miss, '/signals', 5)
    ).toBeNull();
    expect(
      stageTimingProps(new Request('https://api.example/brief/daily'), miss, '/brief/daily', 5)
    ).toBeNull();
    expect(
      stageTimingProps(
        observed('https://api.example/brief/daily'),
        miss,
        '/brief/daily',
        5,
        0.25,
        () => 0.5
      )
    ).toBeNull();
  });

  it('allows only catalog source-family labels', () => {
    expect(diagnosticSourceFamily('courtlistener')).toBe('courtlistener');
    expect(diagnosticSourceFamily('mts')).toBe('attention');
    expect(diagnosticSourceFamily('private-or-unknown-id')).toBe('other');
  });

  it('logs source-detail stages without arbitrary IDs or query values', async () => {
    const d1 = createSqliteD1();
    applyMigrations(d1);
    vi.stubGlobal('caches', {
      default: {
        match: vi.fn().mockResolvedValue(undefined),
        put: vi.fn().mockResolvedValue(undefined),
      },
    });
    const bodies: Array<{ input: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init: RequestInit) => {
        bodies.push({ input, body: JSON.parse(String(init.body)) as Record<string, unknown> });
        return new Response(null, { status: 202 });
      })
    );
    const pending: Promise<unknown>[] = [];
    const response = await (
      worker as unknown as {
        fetch(r: Request, e: Record<string, unknown>, c: unknown): Promise<Response>;
      }
    ).fetch(
      new Request(
        'https://api.highsignal.app/data/sources/courtlistener?limit=7&date=2026-01-02&source=private-source-value'
      ),
      { DB: d1.binding, ENVIRONMENT: 'test', APP_HEALTH_INGEST_KEY: 'secret' },
      { waitUntil: (promise: Promise<unknown>) => pending.push(promise) }
    );
    await vi.advanceTimersByTimeAsync(5000);
    await Promise.all(pending);
    d1.close();
    expect(response.status).toBe(200);
    expect(response.headers.get('server-timing')).toBeNull();
    const logs = bodies
      .filter(({ input }) => input.endsWith('/v1/logs'))
      .flatMap(({ body }) => (body['logs'] ?? []) as Array<Record<string, unknown>>);
    const stage = logs.find((log) => log['event'] === 'api.stage_timing');
    expect(stage).toMatchObject({
      level: 'debug',
      props: {
        route: '/api/data/sources/:id',
        edge_cache: 'MISS',
        source_family: 'courtlistener',
        request_variant: 'date_source',
        page_mode: 'first',
        query_plan: expect.stringMatching(/^(?:seek|scan|empty)$/),
        status: 200,
      },
    });
    const props = stage?.['props'] as Record<string, unknown>;
    expect(props['source_totals_ms']).toEqual(expect.any(Number));
    expect(props['event_page_ms']).toEqual(expect.any(Number));
    expect(JSON.stringify(props)).not.toMatch(/2026-01-02|private-source-value|limit/);
  });
});
