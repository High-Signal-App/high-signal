import { Hono } from 'hono';

type Env = { DB: D1Database };

const MAX_REQUEST_BYTES = 2_000_000;
const MAX_BACKTEST_EVENTS = 25_000;
const MAX_BACKTEST_SIGNALS = 5_000;
const MAX_VALID_EPOCH_SECONDS = 4_102_444_800; // 2100-01-01T00:00:00Z

interface D2CNicheInput {
  id: string;
  slug: string;
  name: string;
  category: string;
  region: string;
  status: string;
  createdAt: number;
  updatedAt: number;
}

interface D2CSnapshotInput {
  id: string;
  nicheId: string;
  snapshotDate: number;
  opportunityScore: number;
  demandScore: number | null;
  competitionScore: number | null;
  pricingScore: number | null;
  adSaturationScore: number | null;
  agentVisibilityScore: number | null;
  sourceDiversity: number;
  verdict: 'enter' | 'test' | 'watch' | 'avoid';
  confidence: 'low' | 'medium' | 'high';
  evidenceJson: unknown[];
  freshnessDate: string;
  notes: string | null;
  createdAt: number;
}

interface D2CAgentVisibilityInput {
  id: string;
  nicheId: string;
  platform: string;
  model: string;
  promptText: string;
  responseText: string;
  recommendedBrands: string[];
  citedUrls: string[];
  brandMentioned: boolean;
  gapScore: number;
  runDate: number;
  createdAt: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isEpochSeconds(value: unknown): value is number {
  return (
    isNumber(value) && Number.isInteger(value) && value >= 0 && value <= MAX_VALID_EPOCH_SECONDS
  );
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || isNumber(value);
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.length <= 100 && value.every((item) => typeof item === 'string')
  );
}

function isNiche(value: unknown): value is D2CNicheInput {
  if (!isRecord(value)) return false;
  const { id, slug, name, category, region, status, createdAt, updatedAt } = value;
  return (
    isString(id) &&
    isString(slug) &&
    isString(name) &&
    isString(category) &&
    isString(region) &&
    status === 'active' &&
    isEpochSeconds(createdAt) &&
    isEpochSeconds(updatedAt)
  );
}

function isSnapshot(value: unknown): value is D2CSnapshotInput {
  if (!isRecord(value)) return false;
  const {
    id,
    nicheId,
    snapshotDate,
    opportunityScore,
    demandScore,
    competitionScore,
    pricingScore,
    adSaturationScore,
    agentVisibilityScore,
    sourceDiversity,
    verdict,
    confidence,
    evidenceJson,
    freshnessDate,
    notes,
    createdAt,
  } = value;
  return (
    isString(id) &&
    isString(nicheId) &&
    isEpochSeconds(snapshotDate) &&
    isNumber(opportunityScore) &&
    isNullableNumber(demandScore) &&
    isNullableNumber(competitionScore) &&
    isNullableNumber(pricingScore) &&
    isNullableNumber(adSaturationScore) &&
    isNullableNumber(agentVisibilityScore) &&
    isNumber(sourceDiversity) &&
    ['enter', 'test', 'watch', 'avoid'].includes(String(verdict)) &&
    ['low', 'medium', 'high'].includes(String(confidence)) &&
    Array.isArray(evidenceJson) &&
    evidenceJson.length <= 500 &&
    isString(freshnessDate) &&
    (notes === null || typeof notes === 'string') &&
    isEpochSeconds(createdAt)
  );
}

function isAgentVisibility(value: unknown): value is D2CAgentVisibilityInput {
  if (!isRecord(value)) return false;
  const {
    id,
    nicheId,
    platform,
    model,
    promptText,
    responseText,
    recommendedBrands,
    citedUrls,
    brandMentioned,
    gapScore,
    runDate,
    createdAt,
  } = value;
  return (
    isString(id) &&
    isString(nicheId) &&
    isString(platform) &&
    isString(model) &&
    isString(promptText) &&
    typeof responseText === 'string' &&
    isStringArray(recommendedBrands) &&
    isStringArray(citedUrls) &&
    typeof brandMentioned === 'boolean' &&
    isNumber(gapScore) &&
    isEpochSeconds(runDate) &&
    isEpochSeconds(createdAt)
  );
}

function requestIsTooLarge(contentLength: string | undefined): boolean {
  if (!contentLength) return false;
  const parsed = Number.parseInt(contentLength, 10);
  return Number.isFinite(parsed) && parsed > MAX_REQUEST_BYTES;
}

const nicheUpsertSql = `
  INSERT INTO d2c_niches
    (id, slug, name, category, region, status, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    slug = excluded.slug,
    name = excluded.name,
    category = excluded.category,
    region = excluded.region,
    status = excluded.status,
    updated_at = excluded.updated_at
`;

function nicheStatement(d1: D1Database, niche: D2CNicheInput) {
  return d1
    .prepare(nicheUpsertSql)
    .bind(
      niche.id,
      niche.slug,
      niche.name,
      niche.category,
      niche.region,
      niche.status,
      niche.createdAt,
      niche.updatedAt
    );
}

export const scheduledDataAdminRoute = new Hono<{ Bindings: Env }>();

scheduledDataAdminRoute.get('/backtest', async (c) => {
  const requestedDays = Number.parseInt(c.req.query('days') ?? '21', 10);
  if (!Number.isFinite(requestedDays) || requestedDays < 1 || requestedDays > 90) {
    return c.json({ error: 'days_must_be_between_1_and_90' }, 400);
  }
  const cutoff = Math.floor(Date.now() / 1000) - requestedDays * 86_400;
  const [events, signals] = await Promise.all([
    c.env.DB.prepare(
      `SELECT primary_entity_id, source, published_at
       FROM events
       WHERE primary_entity_id IS NOT NULL AND published_at >= ?
       LIMIT ${MAX_BACKTEST_EVENTS + 1}`
    )
      .bind(cutoff)
      .all(),
    c.env.DB.prepare(
      `SELECT primary_entity_id, published_at, review_status, signal_type
       FROM signals
       WHERE published_at >= ?
       LIMIT ${MAX_BACKTEST_SIGNALS + 1}`
    )
      .bind(cutoff)
      .all(),
  ]);
  if (
    (events.results?.length ?? 0) > MAX_BACKTEST_EVENTS ||
    (signals.results?.length ?? 0) > MAX_BACKTEST_SIGNALS
  ) {
    return c.json({ error: 'backtest_dataset_exceeds_safe_limit' }, 409);
  }
  return c.json({
    days: requestedDays,
    generatedAt: new Date().toISOString(),
    events: events.results ?? [],
    signals: signals.results ?? [],
  });
});

scheduledDataAdminRoute.post('/d2c-snapshots', async (c) => {
  if (requestIsTooLarge(c.req.header('content-length'))) {
    return c.json({ error: 'payload_too_large' }, 413);
  }
  const body: unknown = await c.req.json().catch(() => null);
  if (!isRecord(body)) {
    return c.json({ error: 'invalid_d2c_snapshot_payload' }, 400);
  }
  const niches = body['niches'];
  const snapshots = body['snapshots'];
  if (
    !Array.isArray(niches) ||
    !Array.isArray(snapshots) ||
    niches.length > 20 ||
    snapshots.length > 20 ||
    !niches.every(isNiche) ||
    !snapshots.every(isSnapshot)
  ) {
    return c.json({ error: 'invalid_d2c_snapshot_payload' }, 400);
  }

  const statements = [
    c.env.DB.prepare('DELETE FROM d2c_niche_snapshots WHERE snapshot_date > ?').bind(
      MAX_VALID_EPOCH_SECONDS
    ),
    ...niches.map((niche) => nicheStatement(c.env.DB, niche)),
  ];
  for (const snapshot of snapshots) {
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO d2c_niche_snapshots
            (id, niche_id, snapshot_date, opportunity_score, demand_score,
             competition_score, pricing_score, ad_saturation_score,
             agent_visibility_score, source_diversity, verdict, confidence,
             evidence_json, freshness_date, notes, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(niche_id, snapshot_date) DO UPDATE SET
             opportunity_score = excluded.opportunity_score,
             demand_score = excluded.demand_score,
             competition_score = excluded.competition_score,
             pricing_score = excluded.pricing_score,
             ad_saturation_score = excluded.ad_saturation_score,
             agent_visibility_score = excluded.agent_visibility_score,
             source_diversity = excluded.source_diversity,
             verdict = excluded.verdict,
             confidence = excluded.confidence,
             evidence_json = excluded.evidence_json,
             freshness_date = excluded.freshness_date,
             notes = excluded.notes`
      ).bind(
        snapshot.id,
        snapshot.nicheId,
        snapshot.snapshotDate,
        snapshot.opportunityScore,
        snapshot.demandScore,
        snapshot.competitionScore,
        snapshot.pricingScore,
        snapshot.adSaturationScore,
        snapshot.agentVisibilityScore,
        snapshot.sourceDiversity,
        snapshot.verdict,
        snapshot.confidence,
        JSON.stringify(snapshot.evidenceJson),
        snapshot.freshnessDate,
        snapshot.notes,
        snapshot.createdAt
      )
    );
  }
  await c.env.DB.batch(statements);
  return c.json({ niches: niches.length, snapshots: snapshots.length });
});

scheduledDataAdminRoute.post('/d2c-agent-visibility', async (c) => {
  if (requestIsTooLarge(c.req.header('content-length'))) {
    return c.json({ error: 'payload_too_large' }, 413);
  }
  const body: unknown = await c.req.json().catch(() => null);
  if (!isRecord(body)) {
    return c.json({ error: 'invalid_d2c_agent_visibility_payload' }, 400);
  }
  const niches = body['niches'];
  const entries = body['entries'];
  const runDate = body['runDate'];
  if (
    !Array.isArray(niches) ||
    !Array.isArray(entries) ||
    !isEpochSeconds(runDate) ||
    niches.length > 20 ||
    entries.length > 100 ||
    !niches.every(isNiche) ||
    !entries.every(isAgentVisibility) ||
    entries.some((entry) => entry.runDate !== runDate)
  ) {
    return c.json({ error: 'invalid_d2c_agent_visibility_payload' }, 400);
  }

  const statements = [
    c.env.DB.prepare('DELETE FROM d2c_agent_visibility WHERE run_date > ?').bind(
      MAX_VALID_EPOCH_SECONDS
    ),
    ...niches.map((niche) => nicheStatement(c.env.DB, niche)),
  ];
  statements.push(
    c.env.DB.prepare('DELETE FROM d2c_agent_visibility WHERE run_date = ?').bind(runDate)
  );
  for (const entry of entries) {
    statements.push(
      c.env.DB.prepare(
        `INSERT OR REPLACE INTO d2c_agent_visibility
            (id, niche_id, platform, model, prompt_text, response_text,
             recommended_brands, cited_urls, brand_mentioned, gap_score,
             run_date, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        entry.id,
        entry.nicheId,
        entry.platform,
        entry.model,
        entry.promptText,
        entry.responseText,
        JSON.stringify(entry.recommendedBrands),
        JSON.stringify(entry.citedUrls),
        entry.brandMentioned ? 1 : 0,
        entry.gapScore,
        entry.runDate,
        entry.createdAt
      )
    );
  }
  await c.env.DB.batch(statements);
  return c.json({ niches: niches.length, entries: entries.length });
});
