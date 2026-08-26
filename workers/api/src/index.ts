import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { signalsRoute } from './routes/signals';
import { entitiesRoute } from './routes/entities';
import { trackRecordRoute } from './routes/track-record';
import { adminRoute } from './routes/admin';
import { sectorsRoute } from './routes/sectors';
import { marketsRoute } from './routes/markets';
import { communitiesRoute } from './routes/communities';
import { productsRoute } from './routes/products';
import { briefRoute, precomputeBriefSnapshots } from './routes/brief';
import { convergenceRoute } from './routes/convergence';
import { unmappedRoute } from './routes/unmapped';
import { enrichRoute } from './routes/enrich';
import { attentionRoute } from './routes/attention';
import { claimsRoute } from './routes/claims';
import { dataRoute } from './routes/data';
import { d2cRoute } from './routes/d2c';
import { companyUniverseRoute } from './routes/company-universe';
import { learningRoute } from './routes/learning';
import { historyRoute } from './routes/history';
import { handlePublicApiCache } from './public-cache';

type Env = {
  DB: D1Database;
  ENVIRONMENT: string;
  ADMIN_TOKEN?: string;
  API_BASE?: string;
  TURNSTILE_HOSTNAMES?: string;
  TURNSTILE_SECRET?: string;
};

const app = new Hono<{ Bindings: Env }>();
const publicCors = cors({ origin: '*' });

app.use('*', async (c, next) => {
  const isAdminPath = c.req.path === '/admin' || c.req.path.startsWith('/admin/');
  if (!isAdminPath) return publicCors(c, next);
  if (c.req.method === 'OPTIONS') return c.json({ error: 'cors_not_allowed' }, 403);
  return next();
});

app.get('/', (c) => c.json({ name: 'high-signal-api', env: c.env.ENVIRONMENT }));
app.get('/health', (c) => c.json({ ok: true, ts: Date.now() }));

app.route('/signals', signalsRoute);
app.route('/entities', entitiesRoute);
app.route('/track-record', trackRecordRoute);
app.route('/admin', adminRoute);
app.route('/sectors', sectorsRoute);
app.route('/markets', marketsRoute);
app.route('/communities', communitiesRoute);
app.route('/products', productsRoute);
app.route('/brief', briefRoute);
app.route('/convergence', convergenceRoute);
app.route('/unmapped', unmappedRoute);
app.route('/enrich', enrichRoute);
app.route('/attention', attentionRoute);
app.route('/claims', claimsRoute);
app.route('/data', dataRoute);
app.route('/d2c', d2cRoute);
app.route('/company-universe', companyUniverseRoute);
app.route('/learning', learningRoute);
app.route('/history', historyRoute);

app.onError((err, c) => {
  console.error(`[error] ${c.req.method} ${c.req.path}:`, err.message, err.stack);
  return c.json({ error: 'Internal Server Error' }, 500);
});

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const cache =
      typeof caches === 'undefined' ? null : (caches as CacheStorage & { default: Cache }).default;
    return handlePublicApiCache(request, async () => app.fetch(request, env, ctx), {
      cache,
      waitUntil: (promise) => ctx.waitUntil(promise),
    });
  },
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    // Brief precompute is the API Worker's only scheduled responsibility.
    // This populates daily_brief_snapshots so /brief/daily does 1 D1 lookup
    // instead of 5-14 sequential queries.
    ctx.waitUntil(
      precomputeBriefSnapshots(env).catch((err) =>
        console.error('[cron] brief precompute failed:', err)
      )
    );
  },
};
