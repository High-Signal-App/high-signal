import {
  createMcpHandler,
  type CreateMcpHandlerOptions,
  hostHeaderValidationResponse,
  LATEST_PROTOCOL_VERSION,
  McpServer,
} from '@modelcontextprotocol/server';
import { z } from 'zod';
import { app, type Env } from './app';
import { handlePublicApiCache } from './public-cache';

const MCP_SCHEMA_VERSION = '2';
const MCP_SERVER_VERSION = '2.0.0';
const IST_TIME_ZONE = 'Asia/Kolkata';
const DAY_MS = 24 * 60 * 60 * 1000;
const MCP_ALLOWED_HOSTNAMES = ['api.highsignal.app', 'localhost', '127.0.0.1'];
const MCP_ALLOWED_ORIGIN_HOSTNAMES = new Set([
  'highsignal.app',
  'www.highsignal.app',
  'chatgpt.com',
  'chat.openai.com',
  'localhost',
  '127.0.0.1',
]);

export const HIGH_SIGNAL_MCP_SERVER_CARD = {
  $schema: 'https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json',
  name: 'app.highsignal/daily-brief',
  title: 'High Signal',
  description:
    'Read the evidence-qualified Daily Brief, search published signals, browse source data, inspect signal proofs, and review the public track record.',
  version: MCP_SERVER_VERSION,
  websiteUrl: 'https://highsignal.app/api-docs',
  repository: {
    url: 'https://github.com/High-Signal-App/high-signal',
    source: 'github',
    subfolder: 'workers/api',
  },
  remotes: [
    {
      type: 'streamable-http',
      url: 'https://api.highsignal.app/mcp',
      supportedProtocolVersions: [LATEST_PROTOCOL_VERSION],
    },
  ],
} as const;

const toolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

type PublicJsonRead = {
  status: number;
  body: Record<string, unknown>;
  cacheStatus: string | null;
};

type PublicJsonReaderOptions = {
  cache?: Pick<Cache, 'match' | 'put'> | null;
  fetchPublic: (request: Request) => Promise<Response>;
  waitUntil?: (promise: Promise<unknown>) => void;
};

export type HighSignalMcpDependencies = {
  readPublicJson: (path: string) => Promise<PublicJsonRead>;
  now?: () => Date;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function dateInIst(now: Date, offsetDays = 0) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: IST_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(now.getTime() + offsetDays * DAY_MS));
}

function isCalendarDate(value: string) {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function snapshotId(date: string) {
  return `hs-${date}`;
}

function reportingWindow(date: string) {
  return {
    date,
    timeZone: IST_TIME_ZONE,
    start: `${date}T00:00:00+05:30`,
    end: `${date}T23:59:59+05:30`,
  };
}

/**
 * Summarise the raw `/data/sources` payload into the compact coverage receipt
 * the PRD asks for: configured / healthy / stale / empty / disabled / failed.
 */
function sourceCoverageSummary(sources: unknown) {
  if (!Array.isArray(sources)) return null;
  const buckets = {
    configured: 0,
    healthy: 0,
    stale: 0,
    empty: 0,
    disabled: 0,
    failed: 0,
    unknown: 0,
  };
  for (const src of sources) {
    if (!isRecord(src)) continue;
    buckets.configured++;
    const status = src['runStatus'];
    if (status === 'success_with_data') buckets.healthy++;
    else if (status === 'parked' || status === 'manual') buckets.disabled++;
    else if (status === 'failed') buckets.failed++;
    else if (status === 'success_empty') buckets.empty++;
    else if (status === 'unknown') buckets.stale++;
    else buckets.unknown++;
  }
  return buckets;
}

function dataUpdatedAt(body: Record<string, unknown>, now: Date) {
  for (const key of ['generatedAt', 'updatedAt', 'publishedAt']) {
    if (typeof body[key] === 'string') return body[key];
  }
  return now.toISOString();
}

function textResult(payload: Record<string, unknown>, isError = false) {
  return {
    ...(isError ? { isError: true } : {}),
    content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
    structuredContent: payload,
  };
}

function errorResult(tool: string, read: PublicJsonRead, now: Date) {
  const code = typeof read.body['error'] === 'string' ? read.body['error'] : 'upstream_error';
  return textResult(
    {
      schemaVersion: MCP_SCHEMA_VERSION,
      dataUpdatedAt: now.toISOString(),
      tool,
      error: {
        code,
        status: read.status,
        message:
          code === 'history_verification_required'
            ? 'This signal or brief is outside the public today/yesterday window.'
            : 'High Signal could not return the requested public data.',
      },
    },
    true
  );
}

function successResult(
  tool: string,
  data: Record<string, unknown>,
  cache: Record<string, string | null>,
  now: Date,
  snapshot?: { snapshotId: string; reportingWindow?: ReturnType<typeof reportingWindow> }
) {
  return textResult({
    schemaVersion: MCP_SCHEMA_VERSION,
    dataUpdatedAt: dataUpdatedAt(data, now),
    tool,
    ...(snapshot
      ? {
          snapshotId: snapshot.snapshotId,
          ...(snapshot.reportingWindow ? { reportingWindow: snapshot.reportingWindow } : {}),
        }
      : {}),
    cache,
    data,
  });
}

function createHighSignalMcpServer(dependencies: HighSignalMcpDependencies) {
  const server = new McpServer({
    name: 'high-signal',
    version: MCP_SERVER_VERSION,
    title: 'High Signal',
  });

  server.registerTool(
    'get_daily_brief',
    {
      title: 'Get Daily Brief',
      description:
        'Return the evidence-qualified High Signal brief for today or yesterday in India Standard Time, with source coverage, health, and counts of available records. The response includes publishStatus ("published" when served from a precomputed snapshot, "pending" when the daily publish cron has not run yet) and nextExpectedPublishAt (ISO timestamp for the next scheduled publish at 03:30 UTC / 09:00 IST) when pending. If publishStatus is "pending", the brief content reflects the previous day\'s published signals — retry after nextExpectedPublishAt for today\'s edition.',
      inputSchema: z.object({
        day: z
          .enum(['today', 'yesterday'])
          .default('today')
          .describe('Which public brief to return.'),
      }),
      annotations: toolAnnotations,
    },
    async ({ day }) => {
      const now = dependencies.now?.() ?? new Date();
      const istDate = day === 'today' ? dateInIst(now) : dateInIst(now, -1);
      const briefPath = day === 'today' ? '/brief/daily' : `/brief/daily?date=${istDate}`;
      const [brief, sources] = await Promise.all([
        dependencies.readPublicJson(briefPath),
        dependencies.readPublicJson('/data/sources?samples=0'),
      ]);
      if (brief.status !== 200) return errorResult('get_daily_brief', brief, now);
      const coverage =
        sources.status === 200 ? sourceCoverageSummary(sources.body['sources']) : null;
      const data: Record<string, unknown> = {
        ...brief.body,
        sourceCoverage: coverage,
        sourceTotal: isRecord(sources.body) ? (sources.body['total'] ?? null) : null,
      };
      return successResult(
        'get_daily_brief',
        data,
        { brief: brief.cacheStatus, sources: sources.cacheStatus },
        now,
        { snapshotId: snapshotId(istDate), reportingWindow: reportingWindow(istDate) }
      );
    }
  );

  server.registerTool(
    'get_signal',
    {
      title: 'Get Signal Proofs',
      description:
        'Return one currently public High Signal record with its evidence events, scoring data, claim provenance, and related signals for the same entity.',
      inputSchema: z.object({
        signal_id: z
          .string()
          .trim()
          .min(1)
          .max(160)
          .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
          .describe('The canonical High Signal slug shown on the signal page.'),
      }),
      annotations: toolAnnotations,
    },
    async ({ signal_id: signalId }) => {
      const now = dependencies.now?.() ?? new Date();
      const encodedSignalId = encodeURIComponent(signalId);
      const detail = await dependencies.readPublicJson(`/signals/${encodedSignalId}`);
      if (detail.status !== 200) return errorResult('get_signal', detail, now);

      const signalBody = isRecord(detail.body) ? detail.body : {};
      const signalRecord = isRecord(signalBody['signal']) ? signalBody['signal'] : signalBody;
      const entityId =
        typeof signalRecord['primaryEntityId'] === 'string'
          ? signalRecord['primaryEntityId']
          : typeof signalRecord['entityId'] === 'string'
            ? signalRecord['entityId']
            : null;

      const [evidence, claims, related] = await Promise.all([
        dependencies.readPublicJson(`/signals/${encodedSignalId}/evidence`),
        dependencies.readPublicJson(`/claims/by-signal/${encodedSignalId}`),
        entityId
          ? dependencies.readPublicJson(`/signals/by-entity/${encodeURIComponent(entityId)}`)
          : Promise.resolve({
              status: 200,
              body: { signals: [] },
              cacheStatus: null,
            } as PublicJsonRead),
      ]);
      if (evidence.status !== 200) return errorResult('get_signal', evidence, now);
      if (claims.status !== 200) return errorResult('get_signal', claims, now);

      const relatedSignals =
        isRecord(related.body) && Array.isArray(related.body['signals'])
          ? (related.body['signals'] as Array<Record<string, unknown>>).filter(
              (s) => s['slug'] !== signalId
            )
          : [];

      return successResult(
        'get_signal',
        {
          ...detail.body,
          proofs: {
            evidence: evidence.body,
            claims: claims.body,
          },
          relatedSignals,
        },
        {
          signal: detail.cacheStatus,
          evidence: evidence.cacheStatus,
          claims: claims.cacheStatus,
          related: related.cacheStatus,
        },
        now
      );
    }
  );

  server.registerTool(
    'get_daily_dump',
    {
      title: 'Get Complete Daily Dump',
      description:
        'Return the canonical machine-readable High Signal dump for one public day, including signals, evidence events, and attention overlays.',
      inputSchema: z.object({
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe('Calendar date in YYYY-MM-DD. Defaults to the current IST date.'),
      }),
      annotations: toolAnnotations,
    },
    async ({ date }) => {
      const now = dependencies.now?.() ?? new Date();
      const resolvedDate = date ?? dateInIst(now);
      if (!isCalendarDate(resolvedDate)) {
        return errorResult(
          'get_daily_dump',
          { status: 400, body: { error: 'invalid_date' }, cacheStatus: null },
          now
        );
      }
      const publicDates = new Set([dateInIst(now), dateInIst(now, -1)]);
      if (!publicDates.has(resolvedDate)) {
        return errorResult(
          'get_daily_dump',
          { status: 403, body: { error: 'history_verification_required' }, cacheStatus: null },
          now
        );
      }
      const read = await dependencies.readPublicJson(`/data/daily?date=${resolvedDate}`);
      if (read.status !== 200) return errorResult('get_daily_dump', read, now);
      return successResult('get_daily_dump', read.body, { dailyDump: read.cacheStatus }, now, {
        snapshotId: snapshotId(resolvedDate),
        reportingWindow: reportingWindow(resolvedDate),
      });
    }
  );

  server.registerTool(
    'get_source_coverage',
    {
      title: 'Get Source Coverage',
      description:
        'Return the full source catalog with per-source health, run status, stored-row counts, and representative samples. Distinguishes configured, healthy, stale, empty, disabled, and failed sources.',
      inputSchema: z.object({
        samples: z
          .number()
          .int()
          .min(0)
          .max(10)
          .default(3)
          .describe('Number of representative sample events per source (0-10).'),
      }),
      annotations: toolAnnotations,
    },
    async ({ samples }) => {
      const now = dependencies.now?.() ?? new Date();
      const read = await dependencies.readPublicJson(`/data/sources?samples=${samples}`);
      if (read.status !== 200) return errorResult('get_source_coverage', read, now);
      const istDate = dateInIst(now);
      const coverage = sourceCoverageSummary(read.body['sources']);
      const data: Record<string, unknown> = {
        ...read.body,
        coverageSummary: coverage,
      };
      return successResult('get_source_coverage', data, { sources: read.cacheStatus }, now, {
        snapshotId: snapshotId(istDate),
      });
    }
  );

  server.registerTool(
    'search_signals',
    {
      title: 'Search Published Signals',
      description:
        'Search published High Signal records filtered by entity, signal type, direction, confidence, or date range. Returns bounded, paginated results with evidence counts and provenance.',
      inputSchema: z.object({
        entity: z.string().optional().describe('Entity ID (e.g. OPENAI, AMZN) to filter by.'),
        type: z
          .string()
          .optional()
          .describe('Signal type filter (e.g. new_product_launch, antitrust_action).'),
        direction: z
          .enum(['up', 'down', 'neutral'])
          .optional()
          .describe('Predicted direction filter.'),
        confidence: z
          .enum(['low', 'medium', 'high'])
          .optional()
          .describe('Confidence band filter.'),
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe('Filter to signals published on this calendar date (YYYY-MM-DD).'),
        from: z.string().optional().describe('Start date for published_at range (ISO 8601).'),
        to: z.string().optional().describe('End date for published_at range (ISO 8601).'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(200)
          .default(50)
          .describe('Maximum number of signals to return (1-200).'),
      }),
      annotations: toolAnnotations,
    },
    async (params) => {
      const now = dependencies.now?.() ?? new Date();
      const query = new URLSearchParams();
      query.set('status', 'published');
      query.set('limit', String(params.limit));
      if (params.entity) query.set('entity', params.entity);
      if (params.type) query.set('type', params.type);
      if (params.direction) query.set('direction', params.direction);
      if (params.confidence) query.set('confidence', params.confidence);
      if (params.date) query.set('date', params.date);
      if (params.from) query.set('from', params.from);
      if (params.to) query.set('to', params.to);
      const read = await dependencies.readPublicJson(`/signals?${query.toString()}`);
      if (read.status !== 200) return errorResult('search_signals', read, now);
      const istDate = dateInIst(now);
      return successResult('search_signals', read.body, { signals: read.cacheStatus }, now, {
        snapshotId: snapshotId(istDate),
      });
    }
  );

  server.registerTool(
    'browse_source',
    {
      title: 'Browse Source Events',
      description:
        'Browse raw collected events for one source family with keyset pagination. Returns events newest-first with cursor-based pagination. Use get_source_coverage first to discover available source IDs.',
      inputSchema: z.object({
        source_id: z
          .string()
          .min(1)
          .max(80)
          .describe('Source family ID (e.g. hackernews, edgar, github, digg).'),
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe('Filter to events on this calendar date (YYYY-MM-DD).'),
        cursor: z
          .string()
          .optional()
          .describe('Pagination cursor from a previous response nextCursor field.'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(200)
          .default(50)
          .describe('Maximum events per page (1-200).'),
      }),
      annotations: toolAnnotations,
    },
    async (params) => {
      const now = dependencies.now?.() ?? new Date();
      const query = new URLSearchParams();
      query.set('limit', String(params.limit));
      if (params.date) query.set('date', params.date);
      if (params.cursor) query.set('cursor', params.cursor);
      const encodedId = encodeURIComponent(params.source_id);
      const read = await dependencies.readPublicJson(
        `/data/sources/${encodedId}?${query.toString()}`
      );
      if (read.status !== 200) return errorResult('browse_source', read, now);
      const istDate = params.date ?? dateInIst(now);
      return successResult('browse_source', read.body, { sourceEvents: read.cacheStatus }, now, {
        snapshotId: snapshotId(istDate),
      });
    }
  );

  server.registerTool(
    'get_track_record',
    {
      title: 'Get Track Record',
      description:
        'Return the public hit-rate ledger with resolved/pending counts, outcome definitions, and calibration by signal type. Shows sample sizes before any confidence claim.',
      inputSchema: z.object({
        cohort: z
          .enum(['all', 'live', 'backfill'])
          .default('all')
          .describe('Which cohort of signals to score.'),
      }),
      annotations: toolAnnotations,
    },
    async ({ cohort }) => {
      const now = dependencies.now?.() ?? new Date();
      const read = await dependencies.readPublicJson(`/track-record?cohort=${cohort}`);
      if (read.status !== 200) return errorResult('get_track_record', read, now);
      const istDate = dateInIst(now);
      return successResult('get_track_record', read.body, { trackRecord: read.cacheStatus }, now, {
        snapshotId: snapshotId(istDate),
      });
    }
  );

  server.registerTool(
    'get_entity',
    {
      title: 'Get Entity Detail',
      description:
        'Return one tracked entity with its supplier/customer/peer relationships, recent published signals, and market quotes. Use for drill-down from a signal or for mapping the spillover graph.',
      inputSchema: z.object({
        entity_id: z
          .string()
          .trim()
          .min(1)
          .max(160)
          .describe('The canonical High Signal entity ID (e.g. OPENAI, AMZN).'),
      }),
      annotations: toolAnnotations,
    },
    async ({ entity_id: entityId }) => {
      const now = dependencies.now?.() ?? new Date();
      const encodedId = encodeURIComponent(entityId);
      const read = await dependencies.readPublicJson(`/entities/${encodedId}`);
      if (read.status !== 200) return errorResult('get_entity', read, now);
      const istDate = dateInIst(now);
      return successResult('get_entity', read.body, { entity: read.cacheStatus }, now, {
        snapshotId: snapshotId(istDate),
      });
    }
  );

  return server;
}

export function createHighSignalMcpHandler(
  dependencies: HighSignalMcpDependencies,
  options: CreateMcpHandlerOptions = {}
) {
  const protocolHandler = createMcpHandler(() => createHighSignalMcpServer(dependencies), {
    onerror(error) {
      console.error(JSON.stringify({ event: 'mcp_error', message: error.message }));
    },
    ...options,
  });

  return async (request: Request, _env: unknown, _ctx: ExecutionContext) => {
    const hostError = hostHeaderValidationResponse(request, MCP_ALLOWED_HOSTNAMES);
    if (hostError) return hostError;

    const origin = request.headers.get('Origin');
    if (origin && !isAllowedMcpOrigin(origin)) {
      return new Response('Origin not allowed.', { status: 403 });
    }
    if (request.method === 'OPTIONS') {
      return withMcpCors(new Response(null, { status: 204 }), origin);
    }

    return withMcpCors(await protocolHandler.fetch(request), origin);
  };
}

function isAllowedMcpOrigin(value: string) {
  try {
    const origin = new URL(value);
    return (
      (origin.protocol === 'https:' || origin.protocol === 'http:') &&
      MCP_ALLOWED_ORIGIN_HOSTNAMES.has(origin.hostname)
    );
  } catch {
    return false;
  }
}

function withMcpCors(response: Response, origin: string | null) {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'private, no-store');
  headers.set('Access-Control-Allow-Origin', origin ?? '*');
  headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  headers.set(
    'Access-Control-Allow-Headers',
    'Accept, Content-Type, Last-Event-ID, MCP-Protocol-Version, MCP-Session-Id'
  );
  headers.set('Access-Control-Expose-Headers', 'MCP-Session-Id');
  headers.append('Vary', 'Origin');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function createCachedPublicJsonReader(options: PublicJsonReaderOptions) {
  return async (path: string): Promise<PublicJsonRead> => {
    const request = new Request(new URL(path, 'https://api.highsignal.app'), {
      headers: { Accept: 'application/json' },
    });
    const response = await handlePublicApiCache(request, () => options.fetchPublic(request), {
      cache: options.cache,
      waitUntil: options.waitUntil,
    });
    const parsed: unknown = await response.json();
    return {
      status: response.status,
      body: isRecord(parsed) ? parsed : { data: parsed },
      cacheStatus: response.headers.get('x-edge-cache'),
    };
  };
}

export async function handleHighSignalMcpRequest(
  request: Request,
  env: Env,
  ctx: ExecutionContext
) {
  const cache =
    typeof caches === 'undefined' ? null : (caches as CacheStorage & { default: Cache }).default;
  const readPublicJson = createCachedPublicJsonReader({
    cache,
    fetchPublic: async (publicRequest) => app.fetch(publicRequest, env, ctx),
    waitUntil: (promise) => ctx.waitUntil(promise),
  });
  const handler = createHighSignalMcpHandler({
    readPublicJson,
  });
  return handler(request, env, ctx);
}

export function handleHighSignalMcpCardRequest(request: Request) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed.', {
      status: 405,
      headers: { Allow: 'GET, HEAD' },
    });
  }
  const body =
    request.method === 'HEAD' ? null : `${JSON.stringify(HIGH_SIGNAL_MCP_SERVER_CARD)}\n`;
  return new Response(body, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=300, s-maxage=86400',
      'Content-Type': 'application/mcp-server-card+json; charset=utf-8',
    },
  });
}
