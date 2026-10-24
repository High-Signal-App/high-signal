import { Hono } from 'hono';
import { z } from 'zod';
import {
  communityResearchPlan,
  initializePublicCommunityReporting,
  researchPublicCommunity,
  type CommunityReportingEnv,
} from '../lib/community-reporting';

// Mounted under the existing operator bearer middleware. No reader writes.
export const communityReportingAdminRoute = new Hono<{ Bindings: CommunityReportingEnv }>();
communityReportingAdminRoute.use('*', async (c, next) => {
  c.header('Cache-Control', 'private, no-store');
  await next();
});
communityReportingAdminRoute.post('/initialize', async (c) => {
  await initializePublicCommunityReporting(c.env.DB);
  return c.json({ ok: true });
});
communityReportingAdminRoute.get('/', async (c) =>
  c.json({ communities: await communityResearchPlan(c.env.DB) })
);
const input = z
  .object({ communityId: z.string().min(1).max(80), leadId: z.string().min(1).max(80) })
  .strict();
communityReportingAdminRoute.post('/', async (c) => {
  const parsed = input.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'invalid_community_research' }, 400);
  const result = await researchPublicCommunity(c.env, parsed.data.communityId, parsed.data.leadId);
  return c.json(result, result.status === 'unavailable' ? 503 : 200);
});
