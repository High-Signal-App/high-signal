import artifact from '@/data/company-universe-web.json';

export interface SourceEvidence {
  source: string;
  sourceUrl: string;
  fund: string;
  position: number;
  title: string;
  description: string;
  cohort?: string;
  program?: string;
  location?: string;
  website?: string;
  status?: string;
}

export interface CompetitorEdge {
  slug: string;
  name?: string;
  score: number;
  reason: string;
}

export interface CompanyEntity {
  text: string;
  label: string;
  score: number;
}

export interface UniverseCompany {
  slug: string;
  name: string;
  description: string;
  category: string;
  investors: string[];
  sourceEvidence: SourceEvidence[];
  sourceEvidenceCount?: number;
  searchMetadata?: string[];
  competitors: CompetitorEdge[];
  entities?: CompanyEntity[];
  similarityVersion?: number;
}

export interface CompanyUniverseArtifact {
  generatedAt: string;
  generatedBy: string;
  strictHighSignalOnly: boolean;
  companyCount: number;
  sourceInputs: Array<{ id: string; label: string; url: string }>;
  sourceStats: Array<{
    id: string;
    label: string;
    fetchedCount: number;
    uniqueCompanyCount: number;
    providerReportedCount: number | null;
    reconciled: boolean | null;
  }>;
  competitorMapping: {
    method: string;
    minimumScore: number;
    maxCompetitorsPerCompany: number;
  };
  entityExtraction?: {
    generatedAt: string;
    model: string;
    labels: string[];
    threshold: number;
    processedCompanyCount: number;
    enrichedCompanyCount: number;
    entityCount: number;
    complete: boolean;
  };
  similarityMapping?: {
    generatedAt: string;
    algorithm: string;
    version: number;
    candidateLimit: number;
    maxPeersPerCompany: number;
    undirectedEdgeCount: number;
    companiesWithPeers: number;
    complete: boolean;
  };
  companies: UniverseCompany[];
}

export const COMPANY_UNIVERSE = artifact as CompanyUniverseArtifact;
export const CASE_STUDIES = COMPANY_UNIVERSE.companies;
export const COMPANY_UNIVERSE_LAST_UPDATED =
  COMPANY_UNIVERSE.similarityMapping?.generatedAt ??
  COMPANY_UNIVERSE.entityExtraction?.generatedAt ??
  COMPANY_UNIVERSE.generatedAt;
export const CASE_STUDIES_PAGE_SIZE = 50;
export const CASE_STUDIES_TOTAL_PAGES = Math.ceil(CASE_STUDIES.length / CASE_STUDIES_PAGE_SIZE);

export const FLOW = [
  {
    label: 'ingest',
    value: `${COMPANY_UNIVERSE.companyCount.toLocaleString()} companies`,
    sub: 'Generated from four first-party startup directories.',
  },
  {
    label: 'normalize',
    value: `${COMPANY_UNIVERSE.sourceInputs.length} sources`,
    sub: 'Dedupe names, preserve source evidence, infer category.',
  },
  {
    label: 'map',
    value: 'competitors',
    sub: 'Same category, shared affiliation/cohort, and description overlap.',
  },
  {
    label: 'render',
    value: 'D1 + SEO',
    sub: 'Synced to D1 for API reads; cached artifact renders crawlable pages.',
  },
];

export function getCaseStudy(slug: string): UniverseCompany | undefined {
  return CASE_STUDIES.find((study) => study.slug === slug);
}

export function getCaseStudiesPage(page: number): UniverseCompany[] {
  const start = (page - 1) * CASE_STUDIES_PAGE_SIZE;
  return CASE_STUDIES.slice(start, start + CASE_STUDIES_PAGE_SIZE);
}

export function caseStudiesPageHref(
  page: number
): '/case-studies' | `/case-studies/page/${number}` {
  return page <= 1 ? '/case-studies' : `/case-studies/page/${page}`;
}
