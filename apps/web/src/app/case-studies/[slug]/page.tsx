import { withAgentMetadata } from '@/lib/agent-page-metadata';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ApiError, fetchJson } from '@/lib/api';
import { SITE_URL } from '@/lib/site';
import { evaluateCompany, robotsForVerdict } from '../../../../public-corpus-policy.mjs';
import { getCaseStudy, type UniverseCompany } from '../data';
import { CompanyProfileContent } from './CompanyProfileContent';

export const revalidate = 3600;
interface PageProps {
  params: Promise<{ slug: string }>;
}

export const dynamicParams = true;

// Populate the shared ISR cache on first access without building the whole corpus.
export function generateStaticParams() {
  return [];
}

interface LiveCompany extends UniverseCompany {
  status?: string;
  domain?: string | null;
  updatedAt?: string | null;
  requestedAt?: string | null;
  lastEnrichedAt?: string | null;
}

interface LiveCompanyResponse {
  company: LiveCompany;
  competitors: LiveCompany['competitors'];
}

async function getLiveCompany(slug: string): Promise<LiveCompany | null> {
  try {
    const payload = await fetchJson<LiveCompanyResponse>(
      `/company-universe/${encodeURIComponent(slug)}`
    );
    return { ...payload.company, competitors: payload.competitors };
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    // An unavailable lookup must fail rendering rather than cache a false not-found.
    throw error;
  }
}

async function pageMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const study = getCaseStudy(slug) ?? (await getLiveCompany(slug));
  if (!study) {
    return {};
  }

  const verdict = evaluateCompany(study);
  const category = study.category === 'Other' ? 'company' : study.category;
  const description = study.description
    ? `${study.description} Explore official provenance and meaningfully similar companies.`
    : `${study.name} company profile with official-source provenance and similar companies.`;
  return {
    title: `${study.name}: ${category}, provenance, and similar companies`,
    description: description.slice(0, 160).replace(/\s+\S*$/, ''),
    alternates: { canonical: `${SITE_URL}/case-studies/${study.slug}` },
    robots: robotsForVerdict(verdict),
  };
}

export default async function CaseStudyDetailPage({ params }: PageProps) {
  const { slug } = await params;
  const staticStudy = getCaseStudy(slug);
  const liveStudy = staticStudy ? null : await getLiveCompany(slug);
  const study: LiveCompany | null = liveStudy
    ? { ...staticStudy, ...liveStudy }
    : staticStudy
      ? { ...staticStudy }
      : null;
  if (!study) {
    notFound();
  }
  return (
    <CompanyProfileContent study={study} sourceMode={liveStudy ? 'D1 lookup' : 'artifact cache'} />
  );
}

export async function generateMetadata(props: Parameters<typeof pageMetadata>[0]) {
  const metadata = await pageMetadata(props);
  const params = await props.params;
  return withAgentMetadata(metadata, '/case-studies/' + encodeURIComponent(params['slug']));
}
