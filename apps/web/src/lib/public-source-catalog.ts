import { PUBLIC_STATIC_ROUTES } from '../../public-route-registry.mjs';
import {
  CASE_STUDIES,
  CASE_STUDIES_TOTAL_PAGES,
  COMPANY_UNIVERSE_LAST_UPDATED,
} from '@/app/case-studies/data';
import {
  evaluateCompany,
  evaluateDirectoryPage,
  evaluateSignal,
} from '../../public-corpus-policy.mjs';
import { api, fetchJson, type SignalRow } from './api';
import { istDay } from '@high-signal/shared';
import { isIndexableMetadata } from './agent-page-metadata';
import { isBackfillSignal } from './signal-format';
import { publicSourcePage } from './public-source-pages';
import { SITE_URL } from './site';

type Cursor = {
  stage: 'companies' | 'live-companies' | 'entities' | 'live' | 'records';
  offset?: number;
  cursor?: string;
};
export type MarkdownRoute = {
  path: string;
  url: string;
  md: string;
  title: string;
  description: string;
  lastModified?: string;
};
const route = (
  path: string,
  title: string,
  description: string,
  lastModified?: string
): MarkdownRoute => ({
  path,
  url: SITE_URL + path,
  md: SITE_URL + (path === '/' ? '/index.md' : path + '.md'),
  title,
  description,
  ...(lastModified ? { lastModified } : {}),
});
const encode = (cursor: Cursor) => JSON.stringify(cursor);
const nextUrl = (cursor: Cursor) =>
  `${SITE_URL}/api/md/_catalog?cursor=${encodeURIComponent(encode(cursor))}`;
function parse(value: string): Cursor {
  const cursor = JSON.parse(value) as Cursor;
  if (
    !cursor ||
    !['companies', 'live-companies', 'entities', 'live', 'records'].includes(cursor.stage) ||
    (cursor.offset !== undefined && (!Number.isSafeInteger(cursor.offset) || cursor.offset < 0)) ||
    (cursor.cursor !== undefined &&
      (typeof cursor.cursor !== 'string' || cursor.cursor.length > 4096))
  )
    throw new Error('Invalid public catalog cursor');
  return cursor;
}

async function initialRoutes() {
  let routes: MarkdownRoute[] = [];
  let next: string | null = null;
  routes = PUBLIC_STATIC_ROUTES.map((item) => route(item.path, item.title, item.description));
  const sources = await api.dataSources();
  if (!sources.available) throw new Error('Public source catalog unavailable');
  for (const source of sources.sources) {
    const selected = publicSourcePage(`/data/${source.id}`);
    if (!selected) continue;
    const metadata = await selected.page.generateMetadata!(selected.props);
    routes.push(
      route(
        `/data/${source.id}`,
        typeof metadata.title === 'string' ? metadata.title : source.id,
        metadata.description ?? 'Public source observations and freshness.'
      )
    );
  }
  next = nextUrl({ stage: 'companies', offset: 0 });

  return { routes, next };
}

async function companyRoutes(cursor: Cursor) {
  let routes: MarkdownRoute[] = [];
  let next: string | null = null;
  const eligible = CASE_STUDIES.filter((company) => evaluateCompany(company).eligible);
  const offset = cursor.offset ?? 0;
  routes = eligible
    .slice(offset, offset + 200)
    .map((company) =>
      route(
        `/case-studies/${company.slug}`,
        company.name,
        company.description,
        COMPANY_UNIVERSE_LAST_UPDATED
      )
    );
  if (offset === 0 && evaluateDirectoryPage().eligible)
    for (let page = 2; page <= CASE_STUDIES_TOTAL_PAGES; page++)
      routes.push(
        route(
          `/case-studies/page/${page}`,
          `Company universe — page ${page}`,
          'Published company profiles and their source evidence.'
        )
      );
  next =
    offset + 200 < eligible.length
      ? nextUrl({ stage: 'companies', offset: offset + 200 })
      : nextUrl({ stage: 'live-companies', offset: 0 });

  return { routes, next };
}

async function liveCompanyRoutes(cursor: Cursor) {
  const routes: MarkdownRoute[] = [];
  let next: string | null = null;
  const offset = cursor.offset ?? 0;
  const page = await fetchJson<{ companies: { slug: string; name: string }[]; hasMore: boolean }>(
    `/company-universe?limit=100&offset=${offset}`
  );
  const known = new Set(CASE_STUDIES.map((company) => company.slug));
  let examined = 0;
  let fetched = 0;
  for (const company of page.companies) {
    examined++;
    if (known.has(company.slug)) continue;
    const path = `/case-studies/${company.slug}`;
    const selected = publicSourcePage(path)!;
    const metadata = await selected.page.generateMetadata!(selected.props);
    fetched++;
    if (isIndexableMetadata(metadata))
      routes.push(
        route(
          path,
          typeof metadata.title === 'string' ? metadata.title : company.name,
          metadata.description ?? 'Public company profile and source evidence.'
        )
      );
    if (fetched >= 20) break;
  }
  next =
    examined < page.companies.length || page.hasMore
      ? nextUrl({ stage: 'live-companies', offset: offset + examined })
      : nextUrl({ stage: 'entities', offset: 0 });
  if (page.hasMore && examined === 0) throw new Error('Public company cursor did not advance');

  return { routes, next };
}

async function entityRoutes(cursor: Cursor) {
  const routes: MarkdownRoute[] = [];
  let next: string | null = null;
  const entities = (await api.entities()).entities;
  const offset = cursor.offset ?? 0;
  for (const entity of entities.slice(offset, offset + 20)) {
    for (const path of [
      `/entities/${entity.id}`,
      ...(entity.ticker ? [`/markets/${entity.ticker}`] : []),
    ]) {
      const selected = publicSourcePage(path)!;
      const metadata = await selected.page.generateMetadata!(selected.props);
      if (metadata.robots && typeof metadata.robots === 'object' && metadata.robots.index === false)
        continue;
      routes.push(
        route(
          path,
          typeof metadata.title === 'string' ? metadata.title : entity.name,
          metadata.description ?? 'Published evidence and relationships.'
        )
      );
    }
  }
  next =
    offset + 20 < entities.length
      ? nextUrl({ stage: 'entities', offset: offset + 20 })
      : nextUrl({ stage: 'live' });

  return { routes, next };
}

const headingPrefix = /^#+\s*/;

async function liveRoutes() {
  const routes: MarkdownRoute[] = [];
  let next: string | null = null;
  // The list API caps its result at 200. Its existing daily export is exhaustive;
  // enumerate only today and yesterday, the same public history window as HTML.
  const now = new Date();
  const days = await Promise.all(
    [istDay(now), istDay(now, -1)].map((day) =>
      fetchJson<{ signals: SignalRow[]; signalCount: number }>(`/data/daily?date=${day}`)
    )
  );
  if (days.some((day) => !Array.isArray(day.signals) || day.signalCount !== day.signals.length))
    throw new Error('Incomplete public daily signal export');
  const signals = [
    ...new Map(days.flatMap((day) => day.signals).map((signal) => [signal.slug, signal])).values(),
  ];
  const types = new Set<string>();
  const months = new Set<string>();
  for (const signal of signals.filter(
    (signal) => signal.reviewStatus === 'published' && !isBackfillSignal(signal)
  )) {
    const title =
      signal.bodyMd
        .split('\n')
        .find((line) => line.trim())
        ?.replace(headingPrefix, '') ?? signal.slug;
    routes.push(
      route(
        `/embed/${signal.slug}`,
        title,
        'Public compact signal card.',
        new Date(signal.publishedAt).toISOString()
      )
    );
    if (!evaluateSignal(signal).eligible) continue;
    routes.push(
      route(
        `/signals/${signal.slug}`,
        title,
        'Published signal, evidence, and uncertainty.',
        new Date(signal.publishedAt).toISOString()
      )
    );
    types.add(signal.signalType);
    months.add(
      `/entities/${signal.primaryEntityId}/${new Date(signal.publishedAt).toISOString().slice(0, 7)}`
    );
  }
  const dates = (await api.briefDates()).dates;
  const candidates = [...types]
    .map((type) => `/signals/types/${type}`)
    .concat(
      [...months],
      dates.map((day) => `/brief/${day.date}`)
    );
  for (const path of candidates) {
    const selected = publicSourcePage(path)!;
    const metadata = await selected.page.generateMetadata!(selected.props);
    if (metadata.robots && typeof metadata.robots === 'object' && metadata.robots.index === false)
      continue;
    routes.push(
      route(
        path,
        typeof metadata.title === 'string' ? metadata.title : path,
        metadata.description ?? 'Public evidence collection.'
      )
    );
  }
  next = nextUrl({ stage: 'records', offset: 0 });

  return { routes, next };
}

async function recordRoutes(cursor: Cursor) {
  let routes: MarkdownRoute[] = [];
  let next: string | null = null;
  const sources = await api.dataSources();
  if (!sources.available) throw new Error('Public source catalog unavailable');
  const source = sources.sources[cursor.offset ?? 0];
  if (source) {
    const page = await api.dataSourceEvents(source.id, {
      limit: 200,
      ...(cursor.cursor ? { cursor: cursor.cursor } : {}),
    });
    if (!page.available) throw new Error('Public records unavailable');
    routes = page.events
      .filter((event) => event.id)
      .map((event) =>
        route(
          `/data/records/${event.id}`,
          event.title ?? event.id!,
          `Retained public record from ${event.source}.`
        )
      );
    if (page.hasMore) {
      if (!page.nextCursor || page.nextCursor === cursor.cursor)
        throw new Error('Public record cursor did not advance');
      next = nextUrl({ stage: 'records', offset: cursor.offset ?? 0, cursor: page.nextCursor });
    } else if ((cursor.offset ?? 0) + 1 < sources.sources.length)
      next = nextUrl({ stage: 'records', offset: (cursor.offset ?? 0) + 1 });
  }

  return { routes, next };
}

/** Every public address can be enumerated through bounded pages; no private grant is accepted. */
export async function listMarkdownRoutes(value?: string | null) {
  const cursor = value ? parse(value) : null;
  const observedAt = new Date().toISOString();
  const stages = {
    companies: companyRoutes,
    'live-companies': liveCompanyRoutes,
    entities: entityRoutes,
    live: liveRoutes,
    records: recordRoutes,
  };
  const result = cursor ? await stages[cursor.stage](cursor) : await initialRoutes();
  return {
    ...result,
    observedAt,
    note: 'Paginated public discovery. Follow next until null. Live data is observed at request time; unavailable sources return an error rather than a partial-success claim. Company enumeration includes the checked-in corpus and the existing public company directory; profile metadata determines indexability.',
  };
}
