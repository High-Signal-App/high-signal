import {
  createMcpHandler,
  type CreateMcpHandlerOptions,
  hostHeaderValidationResponse,
  McpServer,
} from '@modelcontextprotocol/server';
import { z } from 'zod';
import { app, type Env } from './app';
import { handlePublicApiCache } from './public-cache';

const MCP_SCHEMA_VERSION = '1';
const MCP_SERVER_VERSION = '1.0.0';
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
  now: Date
) {
  return textResult({
    schemaVersion: MCP_SCHEMA_VERSION,
    dataUpdatedAt: dataUpdatedAt(data, now),
    tool,
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
        'Return the evidence-qualified High Signal brief for today or yesterday in India Standard Time.',
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
      const path = day === 'today' ? '/brief/daily' : `/brief/daily?date=${dateInIst(now, -1)}`;
      const read = await dependencies.readPublicJson(path);
      if (read.status !== 200) return errorResult('get_daily_brief', read, now);
      return successResult('get_daily_brief', read.body, { brief: read.cacheStatus }, now);
    }
  );

  server.registerTool(
    'get_signal',
    {
      title: 'Get Signal Proofs',
      description:
        'Return one currently public High Signal record with its evidence events, scoring data, and claim provenance.',
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

      const [evidence, claims] = await Promise.all([
        dependencies.readPublicJson(`/signals/${encodedSignalId}/evidence`),
        dependencies.readPublicJson(`/claims/by-signal/${encodedSignalId}`),
      ]);
      if (evidence.status !== 200) return errorResult('get_signal', evidence, now);
      if (claims.status !== 200) return errorResult('get_signal', claims, now);

      return successResult(
        'get_signal',
        {
          ...detail.body,
          proofs: {
            evidence: evidence.body,
            claims: claims.body,
          },
        },
        {
          signal: detail.cacheStatus,
          evidence: evidence.cacheStatus,
          claims: claims.cacheStatus,
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
      return successResult('get_daily_dump', read.body, { dailyDump: read.cacheStatus }, now);
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
