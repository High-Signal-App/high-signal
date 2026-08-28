import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { adminRoute } from './routes/admin';
import { attentionRoute } from './routes/attention';
import { briefRoute } from './routes/brief';
import { claimsRoute } from './routes/claims';
import { communitiesRoute } from './routes/communities';
import { companyUniverseRoute } from './routes/company-universe';
import { convergenceRoute } from './routes/convergence';
import { d2cRoute } from './routes/d2c';
import { dataRoute } from './routes/data';
import { enrichRoute } from './routes/enrich';
import { entitiesRoute } from './routes/entities';
import { historyRoute } from './routes/history';
import { learningRoute } from './routes/learning';
import { marketsRoute } from './routes/markets';
import { productsRoute } from './routes/products';
import { sectorsRoute } from './routes/sectors';
import { signalsRoute } from './routes/signals';
import { trackRecordRoute } from './routes/track-record';
import { unmappedRoute } from './routes/unmapped';

export type Env = {
  DB: D1Database;
  ENVIRONMENT: string;
  ADMIN_TOKEN?: string;
  API_BASE?: string;
  BRIEF_CACHE?: KVNamespace;
  GITHUB_WORKFLOW_TOKEN?: string;
  TURNSTILE_HOSTNAMES?: string;
  TURNSTILE_SECRET?: string;
};

export const app = new Hono<{ Bindings: Env }>();
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

app.onError((error, c) => {
  console.error(`[error] ${c.req.method} ${c.req.path}:`, error.message, error.stack);
  return c.json({ error: 'Internal Server Error' }, 500);
});
