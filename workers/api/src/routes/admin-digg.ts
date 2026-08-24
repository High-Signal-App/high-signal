import { Hono } from 'hono';
import { buildPatterns, matchEntity, type GazetteerEntity } from '../lib/gazetteer';
import { sha16 } from '../lib/ids';

type Env = { DB: D1Database };

const MIN_REFRESH_SECONDS = 10 * 60;
const FEEDS = {
  ranked: 'https://digg.com/ai-clusters-ranked.json',
  rolling: 'https://digg.com/ai-clusters.json',
  today: 'https://digg.com/ai-clusters-today.yaml',
  rising: 'https://digg.com/ai-rising-clusters.yaml',
  rising_today: 'https://digg.com/ai-rising-clusters-today.yaml',
} as const;

type FeedKind = keyof typeof FEEDS;

interface DiggClusterInput {
  sourceId: string;
  shortId: string;
  canonicalDiggUrl: string;
  title: string;
  diggSummary?: string | null;
  createdAt?: string | null;
  firstSeenAt: string;
  retrievedAt: string;
  position?: number | null;
  peakPosition?: number | null;
  entryStatus?: string | null;
  badges?: unknown[];
  sourcePosts?: Array<Record<string, unknown>>;
  sourceUrls?: string[];
  contributingAccounts?: Array<Record<string, unknown>>;
  distinctAccountCount?: number;
  attentionMetrics?: Record<string, unknown>;
  externalGeneratedAnalysis?: Record<string, unknown> | null;
  rawPayloadHash: string;
  rawPayload: Record<string, unknown>;
}

interface DiggFeedInput {
  feedKind: FeedKind;
  feedUrl: string;
  generatedAt?: string | null;
  retrievedAt: string;
  rawPayloadHash: string;
  rawPayload: Record<string, unknown>;
  clusters: DiggClusterInput[];
}

interface ExistingCluster {
  short_id: string;
  first_seen_at: number;
  position: number | null;
  peak_position: number | null;
  source_urls: string;
  contributing_accounts: string;
  primary_entity_id: string | null;
}

interface FeedStateRow {
  feed_kind: string;
  last_retrieved_at: number;
}

export const diggAdminRoute = new Hono<{ Bindings: Env }>();

export function positionUpdate(
  previous: number | null | undefined,
  incoming: number | null | undefined
) {
  if (incoming == null) return { position: previous ?? null, delta: null };
  return {
    position: incoming,
    delta: previous == null ? null : previous - incoming,
  };
}

export function canonicalAttentionUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    url.hash = '';
    url.hostname = url.hostname.replace(/^www\./, '').toLowerCase();
    url.pathname = url.pathname.replace(/\/$/, '') || '/';
    for (const key of Array.from(url.searchParams.keys())) {
      if (/^utm_|^ref$|^source$|^fbclid$|^gclid$|^mc_cid$|^mc_eid$/i.test(key)) {
        url.searchParams.delete(key);
      }
    }
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

function epoch(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

function jsonArray(value: string | null | undefined): unknown[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function unionUrls(previous: string | null | undefined, incoming: string[] | undefined) {
  const values = [...jsonArray(previous), ...(incoming ?? [])];
  return Array.from(
    new Set(
      values.flatMap((value) =>
        typeof value === 'string'
          ? [canonicalAttentionUrl(value)].filter((url): url is string => url !== null)
          : []
      )
    )
  );
}

function unionAccounts(
  previous: string | null | undefined,
  incoming: Array<Record<string, unknown>> | undefined
) {
  const accounts = [...jsonArray(previous), ...(incoming ?? [])].filter(
    (value): value is Record<string, unknown> => !!value && typeof value === 'object'
  );
  const byUsername = new Map<string, Record<string, unknown>>();
  for (const account of accounts) {
    const username = String(account['username'] ?? '')
      .trim()
      .toLowerCase();
    if (username) byUsername.set(username, account);
  }
  return Array.from(byUsername.values());
}

async function feedStates(d1: D1Database): Promise<Map<string, number>> {
  try {
    const rows = (
      await d1
        .prepare('SELECT feed_kind, last_retrieved_at FROM digg_feed_state')
        .all<FeedStateRow>()
    ).results;
    return new Map((rows ?? []).map((row) => [row.feed_kind, row.last_retrieved_at]));
  } catch {
    return new Map();
  }
}

diggAdminRoute.get('/status', async (c) => {
  const now = Math.floor(Date.now() / 1000);
  const states = await feedStates(c.env.DB);
  return c.json({
    minimumRefreshSeconds: MIN_REFRESH_SECONDS,
    feeds: Object.entries(FEEDS).map(([feedKind, feedUrl]) => {
      const lastRetrievedAt = states.get(feedKind) ?? null;
      const dueAt = lastRetrievedAt == null ? null : lastRetrievedAt + MIN_REFRESH_SECONDS;
      return {
        feedKind,
        feedUrl,
        lastRetrievedAt:
          lastRetrievedAt == null ? null : new Date(lastRetrievedAt * 1000).toISOString(),
        dueAt: dueAt == null ? null : new Date(dueAt * 1000).toISOString(),
        isDue: dueAt == null || dueAt <= now,
      };
    }),
  });
});

diggAdminRoute.post('/', async (c) => {
  const body = (await c.req.json()) as { feeds?: DiggFeedInput[] };
  if (!Array.isArray(body.feeds)) return c.json({ error: 'bad_payload' }, 400);

  const now = Math.floor(Date.now() / 1000);
  const states = await feedStates(c.env.DB);
  const acceptedFeeds = body.feeds.filter((feed) => {
    if (!(feed.feedKind in FEEDS) || FEEDS[feed.feedKind] !== feed.feedUrl) return false;
    const retrievedAt = epoch(feed.retrievedAt);
    if (retrievedAt == null || retrievedAt > now + 300) return false;
    const last = states.get(feed.feedKind);
    return last == null || retrievedAt - last >= MIN_REFRESH_SECONDS;
  });
  if (acceptedFeeds.length === 0) {
    return c.json({ skipped: true, reason: 'minimum_refresh_interval', feeds: 0, clusters: 0 });
  }

  const shortIds = Array.from(
    new Set(
      acceptedFeeds.flatMap((feed) =>
        feed.clusters.filter(validCluster).map((cluster) => cluster.shortId)
      )
    )
  );
  const existing = await existingClusters(c.env.DB, shortIds);
  const entityPatterns = await loadEntityPatterns(c.env.DB);
  const clusterStatements: D1PreparedStatement[] = [];
  const normalizedByShortId = new Map<
    string,
    { cluster: DiggClusterInput; entityId: string | null; sourceUrls: string[] }
  >();
  let snapshots = 0;

  for (const feed of acceptedFeeds) {
    const retrievedAt = epoch(feed.retrievedAt)!;
    const generatedAt = epoch(feed.generatedAt);
    clusterStatements.push(
      c.env.DB.prepare(
        `INSERT INTO digg_feed_snapshots
          (id, feed_kind, feed_url, generated_at, retrieved_at, raw_payload_hash, raw_payload)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT DO NOTHING`
      ).bind(
        await sha16(`digg-feed:${feed.feedKind}:${retrievedAt}:${feed.rawPayloadHash}`),
        feed.feedKind,
        feed.feedUrl,
        generatedAt,
        retrievedAt,
        feed.rawPayloadHash,
        JSON.stringify(feed.rawPayload)
      )
    );

    for (const cluster of feed.clusters.filter(validCluster)) {
      const prior = existing.get(cluster.shortId);
      const rankedPosition = feed.feedKind === 'ranked' || prior?.position == null;
      const rank = positionUpdate(prior?.position, rankedPosition ? cluster.position : null);
      const incomingPeak = rankedPosition ? cluster.peakPosition : null;
      const peakPosition = bestPosition(prior?.peak_position, incomingPeak, rank.position);
      const firstSeenAt = Math.min(
        epoch(cluster.firstSeenAt) ?? retrievedAt,
        prior?.first_seen_at ?? Infinity
      );
      const sourceUrls = unionUrls(prior?.source_urls, cluster.sourceUrls);
      const accounts = unionAccounts(prior?.contributing_accounts, cluster.contributingAccounts);
      const entityId =
        prior?.primary_entity_id ??
        matchEntity(`${cluster.title} ${cluster.diggSummary ?? ''}`, entityPatterns);

      clusterStatements.push(
        c.env.DB.prepare(
          `INSERT INTO digg_clusters
            (short_id, source_id, canonical_digg_url, title, digg_summary, created_at,
             first_seen_at, retrieved_at, position, position_delta, peak_position, entry_status,
             badges, source_posts, source_urls, contributing_accounts, distinct_account_count,
             primary_entity_id, source_class, evidence_tier, confidence_contribution,
             attention_contribution, external_generated_analysis, raw_payload_hash, raw_payload)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                   'attention_aggregator', 'derived', 'none', 'allowed', ?, ?, ?)
           ON CONFLICT(short_id) DO UPDATE SET
             source_id=excluded.source_id,
             canonical_digg_url=excluded.canonical_digg_url,
             title=excluded.title,
             digg_summary=excluded.digg_summary,
             created_at=COALESCE(digg_clusters.created_at, excluded.created_at),
             first_seen_at=MIN(digg_clusters.first_seen_at, excluded.first_seen_at),
             retrieved_at=excluded.retrieved_at,
             position=COALESCE(excluded.position, digg_clusters.position),
             position_delta=COALESCE(excluded.position_delta, digg_clusters.position_delta),
             peak_position=COALESCE(excluded.peak_position, digg_clusters.peak_position),
             entry_status=COALESCE(excluded.entry_status, digg_clusters.entry_status),
             badges=excluded.badges,
             source_posts=excluded.source_posts,
             source_urls=excluded.source_urls,
             contributing_accounts=excluded.contributing_accounts,
             distinct_account_count=MAX(digg_clusters.distinct_account_count, excluded.distinct_account_count),
             primary_entity_id=COALESCE(digg_clusters.primary_entity_id, excluded.primary_entity_id),
             external_generated_analysis=COALESCE(excluded.external_generated_analysis, digg_clusters.external_generated_analysis),
             raw_payload_hash=excluded.raw_payload_hash,
             raw_payload=excluded.raw_payload`
        ).bind(
          cluster.shortId,
          cluster.sourceId,
          cluster.canonicalDiggUrl,
          cluster.title,
          cluster.diggSummary?.slice(0, 600) ?? null,
          epoch(cluster.createdAt),
          Number.isFinite(firstSeenAt) ? firstSeenAt : retrievedAt,
          retrievedAt,
          rank.position,
          rank.delta,
          peakPosition,
          cluster.entryStatus ?? null,
          JSON.stringify(cluster.badges ?? []),
          JSON.stringify(cluster.sourcePosts ?? []),
          JSON.stringify(sourceUrls),
          JSON.stringify(accounts),
          Math.max(0, Math.floor(cluster.distinctAccountCount ?? accounts.length)),
          entityId,
          cluster.externalGeneratedAnalysis
            ? JSON.stringify(cluster.externalGeneratedAnalysis)
            : null,
          cluster.rawPayloadHash,
          JSON.stringify(cluster.rawPayload)
        )
      );
      clusterStatements.push(
        c.env.DB.prepare(
          `INSERT INTO digg_cluster_snapshots
            (id, short_id, feed_kind, generated_at, retrieved_at, position, position_delta,
             peak_position, distinct_account_count, attention_metrics, raw_payload_hash, raw_payload)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT DO NOTHING`
        ).bind(
          await sha16(
            `digg-cluster:${cluster.shortId}:${feed.feedKind}:${retrievedAt}:${cluster.rawPayloadHash}`
          ),
          cluster.shortId,
          feed.feedKind,
          generatedAt,
          retrievedAt,
          cluster.position ?? null,
          rank.delta,
          cluster.peakPosition ?? null,
          Math.max(0, Math.floor(cluster.distinctAccountCount ?? accounts.length)),
          JSON.stringify(cluster.attentionMetrics ?? {}),
          cluster.rawPayloadHash,
          JSON.stringify(cluster.rawPayload)
        )
      );
      snapshots++;
      existing.set(cluster.shortId, {
        short_id: cluster.shortId,
        first_seen_at: Number.isFinite(firstSeenAt) ? firstSeenAt : retrievedAt,
        position: rank.position,
        peak_position: peakPosition,
        source_urls: JSON.stringify(sourceUrls),
        contributing_accounts: JSON.stringify(accounts),
        primary_entity_id: entityId,
      });
      normalizedByShortId.set(cluster.shortId, { cluster, entityId, sourceUrls });
    }

    clusterStatements.push(
      c.env.DB.prepare(
        `INSERT INTO digg_feed_state
          (feed_kind, feed_url, last_retrieved_at, last_generated_at, last_raw_payload_hash)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(feed_kind) DO UPDATE SET
           feed_url=excluded.feed_url,
           last_retrieved_at=excluded.last_retrieved_at,
           last_generated_at=excluded.last_generated_at,
           last_raw_payload_hash=excluded.last_raw_payload_hash`
      ).bind(feed.feedKind, feed.feedUrl, retrievedAt, generatedAt, feed.rawPayloadHash)
    );
  }

  await runBatches(c.env.DB, clusterStatements);
  const links = await linkSignals(c.env.DB, normalizedByShortId, now);
  return c.json({
    feeds: acceptedFeeds.length,
    clusters: normalizedByShortId.size,
    snapshots,
    signalLinks: links,
    classification: {
      sourceClass: 'attention_aggregator',
      evidenceTier: 'derived',
      confidenceContribution: 'none',
      attentionContribution: 'allowed',
    },
  });
});

function validCluster(cluster: DiggClusterInput) {
  return Boolean(
    cluster &&
      cluster.shortId &&
      cluster.sourceId &&
      cluster.title &&
      cluster.canonicalDiggUrl &&
      canonicalAttentionUrl(cluster.canonicalDiggUrl) &&
      cluster.rawPayloadHash &&
      cluster.rawPayload
  );
}

function bestPosition(...values: Array<number | null | undefined>) {
  const valid = values.filter((value): value is number => Number.isInteger(value) && value! > 0);
  return valid.length > 0 ? Math.min(...valid) : null;
}

async function existingClusters(d1: D1Database, shortIds: string[]) {
  const result = new Map<string, ExistingCluster>();
  for (let i = 0; i < shortIds.length; i += 80) {
    const chunk = shortIds.slice(i, i + 80);
    if (chunk.length === 0) continue;
    const rows = await d1
      .prepare(
        `SELECT short_id, first_seen_at, position, peak_position, source_urls,
                contributing_accounts, primary_entity_id
         FROM digg_clusters WHERE short_id IN (${chunk.map(() => '?').join(',')})`
      )
      .bind(...chunk)
      .all<ExistingCluster>();
    for (const row of rows.results ?? []) result.set(row.short_id, row);
  }
  return result;
}

async function loadEntityPatterns(d1: D1Database) {
  const rows = await d1
    .prepare('SELECT id, name, ticker, metadata FROM entities')
    .all<GazetteerEntity>();
  return buildPatterns(rows.results ?? []);
}

async function linkSignals(
  d1: D1Database,
  clusters: Map<
    string,
    { cluster: DiggClusterInput; entityId: string | null; sourceUrls: string[] }
  >,
  now: number
) {
  const urlOwners = new Map<string, string[]>();
  for (const [shortId, value] of clusters) {
    for (const url of value.sourceUrls) {
      const owners = urlOwners.get(url) ?? [];
      owners.push(shortId);
      urlOwners.set(url, owners);
    }
  }

  const linkCandidates = new Map<
    string,
    { signalId: string; entityId: string | null; basis: string; confidence: number }
  >();
  const urls = Array.from(urlOwners.keys());
  for (let i = 0; i < urls.length; i += 80) {
    const chunk = urls.slice(i, i + 80);
    if (chunk.length === 0) continue;
    const rows = await d1
      .prepare(
        `SELECT e.url, e.signal_id, s.primary_entity_id
         FROM evidence e JOIN signals s ON s.id = e.signal_id
         WHERE s.review_status = 'published' AND e.url IN (${chunk.map(() => '?').join(',')})`
      )
      .bind(...chunk)
      .all<{ url: string; signal_id: string; primary_entity_id: string | null }>();
    for (const row of rows.results ?? []) {
      for (const shortId of urlOwners.get(row.url) ?? []) {
        linkCandidates.set(`${shortId}:${row.signal_id}`, {
          signalId: row.signal_id,
          entityId: row.primary_entity_id,
          basis: 'evidence_url',
          confidence: 1,
        });
      }
    }
  }

  const entityIds = Array.from(
    new Set(
      Array.from(clusters.values()).flatMap((value) => (value.entityId ? [value.entityId] : []))
    )
  );
  if (entityIds.length > 0) {
    const rows = await d1
      .prepare(
        `SELECT id, primary_entity_id FROM signals
         WHERE review_status = 'published' AND published_at >= ?
           AND primary_entity_id IN (${entityIds.map(() => '?').join(',')})
         ORDER BY published_at DESC`
      )
      .bind(now - 7 * 24 * 60 * 60, ...entityIds)
      .all<{ id: string; primary_entity_id: string }>();
    const perEntity = new Map<string, number>();
    for (const row of rows.results ?? []) {
      const used = perEntity.get(row.primary_entity_id) ?? 0;
      if (used >= 3) continue;
      perEntity.set(row.primary_entity_id, used + 1);
      for (const [shortId, value] of clusters) {
        if (value.entityId !== row.primary_entity_id) continue;
        const key = `${shortId}:${row.id}`;
        if (!linkCandidates.has(key)) {
          linkCandidates.set(key, {
            signalId: row.id,
            entityId: row.primary_entity_id,
            basis: 'entity',
            confidence: 0.55,
          });
        }
      }
    }
  }

  const statements = Array.from(linkCandidates.entries()).map(([key, link]) => {
    const shortId = key.slice(0, key.lastIndexOf(':'));
    return d1
      .prepare(
        `INSERT INTO digg_signal_links
          (short_id, signal_id, entity_id, match_basis, match_confidence, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(short_id, signal_id) DO UPDATE SET
           entity_id=excluded.entity_id,
           match_basis=CASE WHEN digg_signal_links.match_basis='evidence_url'
                            THEN digg_signal_links.match_basis ELSE excluded.match_basis END,
           match_confidence=MAX(digg_signal_links.match_confidence, excluded.match_confidence),
           updated_at=excluded.updated_at`
      )
      .bind(shortId, link.signalId, link.entityId, link.basis, link.confidence, now, now);
  });
  await runBatches(d1, statements);
  return statements.length;
}

async function runBatches(d1: D1Database, statements: D1PreparedStatement[]) {
  for (let i = 0; i < statements.length; i += 50) {
    const chunk = statements.slice(i, i + 50);
    if (chunk.length > 0) await d1.batch(chunk);
  }
}
