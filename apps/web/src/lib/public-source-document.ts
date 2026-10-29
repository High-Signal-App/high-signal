import Link from 'next/link';
import { ShareBar } from '@/components/molecules/ShareBar';
import { PromoteButton } from '@/components/unmapped/PromoteButton';
import { promoteIdleLabel } from '@/components/unmapped/promote-copy';
import { api, ApiError } from './api';
import { isBackfillSignal } from './signal-format';
import { isIndexableMetadata } from './agent-page-metadata';
import { absoluteMarkdownLinks } from '../../agent-surfaces/format.mjs';
import { HorizontalScrollRegion } from '@/components/HorizontalScrollRegion';
import { RegionPicker } from '@/components/brief/RegionPicker';
import { HistoryGate } from '@/components/history/HistoryGate';
import { historyGateCopy } from '@/components/history/history-gate-copy';
import { CompanyLookupForm } from '@/app/case-studies/CompanyLookupForm';
import { CompanySearchForm } from '@/app/case-studies/CompanySearchForm';
import { companySearchCopy } from '@/app/case-studies/company-search-copy';
import { isRegion, regionLabel } from '@high-signal/shared';
import Image from 'next/image';
import { MarkdownView } from '@/components/system/MarkdownView';
import { publicSourcePage } from './public-source-pages';
import { publicSourceTree, type SourceTreeOptions } from './public-source-tree';
import { SITE_URL, SITE_NAME, SITE_DESCRIPTION } from './site';

async function eligiblePublicPage(
  path: string,
  page: NonNullable<ReturnType<typeof publicSourcePage>>['page']
) {
  if (path.startsWith('/embed/')) {
    try {
      const { signal } = await api.signal(path.split('/').at(-1)!);
      if (signal.reviewStatus !== 'published' || isBackfillSignal(signal)) return false;
    } catch (error) {
      if (error instanceof ApiError && [403, 404].includes(error.status)) return false;
      throw error;
    }
  }
  if (/^\/data\/records\/[^/]+$/.test(path)) {
    try {
      const record = await api.dataRecord(path.split('/').at(-1)!);
      if (!record.available) throw new Error('Public record unavailable');
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return false;
      throw error;
    }
  } else if (/^\/data\/[^/]+$/.test(path) && page.generateStaticParams) {
    const source = path.split('/').at(-1)!;
    if (!page.generateStaticParams().some((params) => params['source'] === source)) {
      const sources = await api.dataSources();
      if (!sources.available) throw new Error('Public source inventory unavailable');
      if (!sources.sources.some((item) => item.id === source)) return false;
    }
  }
  return true;
}

function sourceOptions(canonical: string): SourceTreeOptions {
  const adapters: NonNullable<SourceTreeOptions['adapters']> = new Map();
  const options: SourceTreeOptions = { canonical, adapters };
  // Share controls are navigation chrome; never execute their browser hooks or clipboard actions.
  adapters.set(ShareBar, () => '');
  // The human-verified creation form has no published content; do not execute its client hooks.
  adapters.set(CompanyLookupForm, () => '');
  adapters.set(PromoteButton, () => promoteIdleLabel);
  adapters.set(
    Link,
    async (props) =>
      `[${(await publicSourceTree(props['children'], options)).trim()}](${new URL(String(props['href']), canonical).href})`
  );
  adapters.set(Image, (props) =>
    props['alt']
      ? `![${String(props['alt'])}](${new URL(String(props['src']), canonical).href})`
      : ''
  );
  adapters.set(MarkdownView, (props) => `\n\n${String(props['markdown'])}\n\n`);
  adapters.set(HorizontalScrollRegion, (props) => publicSourceTree(props['children'], options));
  adapters.set(
    RegionPicker,
    (props) =>
      `Region: ${regionLabel(isRegion(String(props['active'])) ? (String(props['active']) as Parameters<typeof regionLabel>[0]) : 'global')}\n`
  );
  adapters.set(
    HistoryGate,
    (props) =>
      `\n\n${historyGateCopy.eyebrow}\n\n## ${props['title'] ?? historyGateCopy.title}\n\n${props['description'] ?? historyGateCopy.description}\n\n${historyGateCopy.duration}\n\n`
  );
  adapters.set(CompanySearchForm, (props) => {
    const copy = companySearchCopy(Number(props['companyCount']), String(props['lastUpdatedAt']));
    return `\n\n${copy.label}\n\n${copy.freshness}\n\n`;
  });
  return options;
}

export async function publicSourceDocument(path: string) {
  const selected = publicSourcePage(path);
  if (!selected) return null;
  const { page, props } = selected;
  if (!(await eligiblePublicPage(path, page))) return null;
  const metadata = page.generateMetadata
    ? await page.generateMetadata(props)
    : (page.metadata ?? {});
  if (!isIndexableMetadata(metadata)) return null;
  const declared = metadata.alternates?.canonical;
  const canonicalValue =
    typeof declared === 'string' || declared instanceof URL ? declared : declared?.url;
  const canonical = new URL(canonicalValue ?? path, SITE_URL).href;
  if (new URL(canonical).origin !== SITE_URL)
    throw new Error('Public source canonical must belong to this site');
  const titleValue = metadata.title;
  const title =
    typeof titleValue === 'string'
      ? titleValue
      : titleValue && 'absolute' in titleValue
        ? titleValue.absolute
        : titleValue && 'default' in titleValue
          ? titleValue.default
          : SITE_NAME;
  const description = metadata.description ?? SITE_DESCRIPTION;
  const options = sourceOptions(canonical);
  const body = await publicSourceTree(await page.default(props), options);
  if (!body.trim()) throw new Error('Public source page has no content');
  return {
    path,
    url: canonical,
    title,
    description,
    markdown: absoluteMarkdownLinks(
      `# ${title}\n\n> ${description}\n\nCanonical: ${canonical}\n\n${body.replace(/^# [^\n]*\n/m, '').trim()}\n`,
      canonical
    ),
  };
}
