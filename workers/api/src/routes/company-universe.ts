import { Hono } from 'hono';
import { desc, eq, like, or, sql } from 'drizzle-orm';
import { db, schema } from '../db';

type Env = { DB: D1Database };

export const companyUniverseRoute = new Hono<{ Bindings: Env }>();

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function companyPayload(row: typeof schema.companyUniverseCompanies.$inferSelect) {
  return {
    slug: row.slug,
    name: row.name,
    description: row.description,
    category: row.category,
    investors: parseJson<string[]>(row.investorsJson, []),
    sourceEvidence: parseJson<unknown[]>(row.sourceEvidenceJson, []),
    generatedAt: row.generatedAt,
    updatedAt: toIso(row.updatedAt),
    status: row.status,
    domain: row.domain,
    requestedBy: row.requestedBy,
    requestedAt: toIso(row.requestedAt),
    lastEnrichedAt: toIso(row.lastEnrichedAt),
  };
}

function toIso(value: Date | number | string | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'number') return new Date(value).toISOString();
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function normalizeDomain(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return null;
  try {
    const withProtocol = /^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
    const host = new URL(withProtocol).hostname.replace(/^www\./, '');
    return host || null;
  } catch {
    return (
      trimmed
        .replace(/^https?:\/\//, '')
        .replace(/^www\./, '')
        .split('/')[0] || null
    );
  }
}

function titleCase(value: string): string {
  return value
    .split(/[\s.-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function nameFromDomain(domain: string): string {
  return titleCase(domain.split('.')[0] ?? domain);
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function tokens(value: string): Set<string> {
  const stop = new Set(['ai', 'the', 'and', 'inc', 'labs', 'lab', 'app', 'co', 'io', 'com']);
  return new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 3 && !stop.has(token))
  );
}

function overlap(a: Set<string>, b: Set<string>): number {
  let count = 0;
  for (const item of a) {
    if (b.has(item)) count += 1;
  }
  return count;
}

function inferCategory(text: string): string {
  const haystack = text.toLowerCase();
  const rules: Array<[string, string[]]> = [
    ['AI agents', ['agent', 'copilot', 'assistant', 'workflow automation']],
    ['AI infrastructure', ['ai', 'llm', 'model', 'gpu', 'inference', 'training']],
    ['Developer tools', ['developer', 'devtool', 'api', 'sdk', 'code', 'github']],
    ['Data and analytics', ['data', 'analytics', 'warehouse', 'observability', 'metrics']],
    ['Cybersecurity', ['security', 'auth', 'identity', 'fraud', 'risk']],
    ['Fintech', ['finance', 'bank', 'payment', 'payroll', 'accounting', 'insurance']],
    ['Healthcare', ['health', 'care', 'clinic', 'medical', 'patient', 'bio']],
    ['Enterprise SaaS', ['sales', 'crm', 'support', 'enterprise', 'saas']],
    [
      'Collaboration and productivity',
      ['collaboration', 'docs', 'meetings', 'slack', 'productivity'],
    ],
    ['E-commerce', ['commerce', 'shop', 'retail', 'marketplace', 'store']],
    ['Climate and energy', ['climate', 'energy', 'carbon', 'battery', 'solar']],
    ['Crypto and web3', ['crypto', 'web3', 'wallet', 'defi', 'blockchain']],
  ];
  return rules.find(([, words]) => words.some((word) => haystack.includes(word)))?.[0] ?? 'Other';
}

async function getCompetitors(database: ReturnType<typeof db>, slug: string) {
  const competitorRows = await database
    .select({
      slug: schema.companyUniverseCompanies.slug,
      name: schema.companyUniverseCompanies.name,
      description: schema.companyUniverseCompanies.description,
      category: schema.companyUniverseCompanies.category,
      score: schema.companyUniverseCompetitors.score,
      reason: schema.companyUniverseCompetitors.reason,
    })
    .from(schema.companyUniverseCompetitors)
    .innerJoin(
      schema.companyUniverseCompanies,
      eq(schema.companyUniverseCompetitors.competitorSlug, schema.companyUniverseCompanies.slug)
    )
    .where(eq(schema.companyUniverseCompetitors.companySlug, slug))
    .orderBy(desc(schema.companyUniverseCompetitors.score))
    .limit(12);

  return competitorRows.map((row) => ({
    slug: row.slug,
    name: row.name,
    description: row.description,
    category: row.category,
    score: row.score,
    reason: row.reason,
  }));
}

async function findExistingCompany(
  database: ReturnType<typeof db>,
  input: { slug: string; name: string; domain: string | null }
) {
  const [bySlug] = await database
    .select()
    .from(schema.companyUniverseCompanies)
    .where(eq(schema.companyUniverseCompanies.slug, input.slug))
    .limit(1);
  if (bySlug) return bySlug;

  if (input.domain) {
    const [byDomain] = await database
      .select()
      .from(schema.companyUniverseCompanies)
      .where(eq(schema.companyUniverseCompanies.domain, input.domain))
      .limit(1);
    if (byDomain) return byDomain;
  }

  const [byName] = await database
    .select()
    .from(schema.companyUniverseCompanies)
    .where(eq(schema.companyUniverseCompanies.name, input.name))
    .limit(1);
  return byName ?? null;
}

async function mapFirstPassCompetitors(
  database: ReturnType<typeof db>,
  company: {
    slug: string;
    name: string;
    description: string;
    category: string;
    domain: string | null;
    generatedAt: string;
  }
) {
  const seedTokens = tokens(`${company.name} ${company.domain ?? ''} ${company.category}`);
  const sameCategory = await database
    .select()
    .from(schema.companyUniverseCompanies)
    .where(eq(schema.companyUniverseCompanies.category, company.category))
    .limit(120);
  const fallback =
    sameCategory.length >= 8
      ? []
      : await database.select().from(schema.companyUniverseCompanies).limit(120);

  const seen = new Set<string>();
  const scored = [...sameCategory, ...fallback]
    .filter((row) => row.slug !== company.slug)
    .filter((row) => {
      if (seen.has(row.slug)) return false;
      seen.add(row.slug);
      return true;
    })
    .map((row) => {
      const candidateTokens = tokens(`${row.name} ${row.description} ${row.category}`);
      const shared = overlap(seedTokens, candidateTokens);
      const sameCategoryScore = row.category === company.category ? 56 : 26;
      const tokenScore = Math.min(shared * 14, 34);
      const score = Math.min(95, sameCategoryScore + tokenScore);
      const reason =
        shared > 0
          ? `same inferred category plus ${shared} name/domain token overlap`
          : row.category === company.category
            ? 'same inferred category cohort peer'
            : 'fallback cohort peer pending deeper enrichment';
      return { row, score, reason };
    })
    .filter((item) => item.score >= 40)
    .sort((a, b) => b.score - a.score || a.row.name.localeCompare(b.row.name))
    .slice(0, 8);

  if (scored.length > 0) {
    await database
      .insert(schema.companyUniverseCompetitors)
      .values(
        scored.map((item) => ({
          companySlug: company.slug,
          competitorSlug: item.row.slug,
          score: item.score,
          reason: item.reason,
          generatedAt: company.generatedAt,
        }))
      )
      .onConflictDoNothing({
        target: [
          schema.companyUniverseCompetitors.companySlug,
          schema.companyUniverseCompetitors.competitorSlug,
        ],
      });
  }

  return getCompetitors(database, company.slug);
}

companyUniverseRoute.get('/', async (c) => {
  const database = db(c.env.DB);
  const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 50), 1), 100);
  const offset = Math.max(Number(c.req.query('offset') ?? 0), 0);
  const q = c.req.query('q')?.trim();

  const where = q
    ? or(
        like(schema.companyUniverseCompanies.name, `%${q}%`),
        like(schema.companyUniverseCompanies.description, `%${q}%`),
        like(schema.companyUniverseCompanies.category, `%${q}%`)
      )
    : undefined;

  const [run] = await database
    .select()
    .from(schema.companyUniverseRuns)
    .orderBy(desc(schema.companyUniverseRuns.createdAt))
    .limit(1);

  const [countRow] = await database
    .select({ n: sql<number>`count(*)` })
    .from(schema.companyUniverseCompanies)
    .where(where);

  const rows = await database
    .select()
    .from(schema.companyUniverseCompanies)
    .where(where)
    .orderBy(schema.companyUniverseCompanies.name)
    .limit(limit)
    .offset(offset);

  return c.json({
    generatedAt: run?.generatedAt ?? null,
    companyCount: Number(countRow?.n ?? 0),
    limit,
    offset,
    hasMore: offset + rows.length < Number(countRow?.n ?? 0),
    companies: rows.map(companyPayload),
  });
});

companyUniverseRoute.post('/lookup', async (c) => {
  const database = db(c.env.DB);
  const body = (await c.req.json().catch(() => ({}))) as {
    name?: string;
    domain?: string;
    requestedBy?: string;
  };
  const domain = normalizeDomain(body.domain);
  const name = (body.name?.trim() || (domain ? nameFromDomain(domain) : '')).trim();
  if (!name || name.length < 2) {
    return c.json({ error: 'missing_company_name' }, 400);
  }

  const slug = slugify(name) || (domain ? slugify(domain) : '');
  if (!slug) {
    return c.json({ error: 'invalid_company_name' }, 400);
  }

  const existing = await findExistingCompany(database, { slug, name, domain });
  if (existing) {
    return c.json({
      created: false,
      company: companyPayload(existing),
      competitors: await getCompetitors(database, existing.slug),
    });
  }

  const now = new Date();
  const generatedAt = now.toISOString();
  const category = inferCategory(`${name} ${domain ?? ''}`);
  const description = domain
    ? `Operator-submitted company at ${domain}; pending High Signal source enrichment.`
    : 'Operator-submitted company; pending High Signal source enrichment.';
  const sourceEvidence = [
    {
      source: 'operator-submitted',
      sourceUrl: domain ? `https://${domain}` : '',
      fund: 'High Signal lookup',
      position: 1,
      title: name,
      description,
      observedAt: generatedAt,
    },
  ];

  await database
    .insert(schema.companyUniverseCompanies)
    .values({
      slug,
      name,
      description,
      category,
      investorsJson: JSON.stringify([]),
      sourceEvidenceJson: JSON.stringify(sourceEvidence),
      generatedAt,
      updatedAt: now,
      status: 'pending_enrichment',
      domain,
      requestedBy: body.requestedBy?.trim() || c.req.header('X-Clerk-User-Id') || null,
      requestedAt: now,
      lastEnrichedAt: null,
    })
    .onConflictDoNothing({ target: schema.companyUniverseCompanies.slug });

  const [company] = await database
    .select()
    .from(schema.companyUniverseCompanies)
    .where(eq(schema.companyUniverseCompanies.slug, slug))
    .limit(1);
  if (!company) {
    return c.json({ error: 'create_failed' }, 500);
  }

  const competitors = await mapFirstPassCompetitors(database, {
    slug: company.slug,
    name: company.name,
    description: company.description,
    category: company.category,
    domain: company.domain,
    generatedAt: company.generatedAt,
  });

  return c.json({ created: true, company: companyPayload(company), competitors }, 201);
});

companyUniverseRoute.get('/:slug', async (c) => {
  const database = db(c.env.DB);
  const slug = c.req.param('slug');

  const [company] = await database
    .select()
    .from(schema.companyUniverseCompanies)
    .where(eq(schema.companyUniverseCompanies.slug, slug))
    .limit(1);
  if (!company) {
    return c.json({ error: 'not_found' }, 404);
  }

  return c.json({
    company: companyPayload(company),
    competitors: await getCompetitors(database, company.slug),
  });
});
