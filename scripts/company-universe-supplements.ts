import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type {
  CompanyUniverseArtifact,
  OfficialCompanyEvidence,
  SourceEvidence,
  UniverseCompany,
} from '../apps/web/src/app/case-studies/data';

export type CompanySupplement = {
  id: string;
  companySlug: string;
  expectedName: string;
  expectedDirectoryUrl: string;
  expectedWebsiteHost: string;
  expectedDescriptionSha256: string;
  capture: {
    sourceUrl: string;
    finalUrl: string;
    fetchedAt: string;
    contentSha256: string;
    claim: string;
    excerpt: string;
    sourceCompanyIdentity: { name: string; canonicalWebsite: string; identityBasis: string };
  };
} & {
  review:
    | { state: 'pending' | 'rejected'; reason: string }
    | {
        state: 'accepted';
        reviewedAt: string;
        reviewer: string;
        validUntil: string;
        supportRationale: string;
        identityRationale: string;
      };
};

export type SupplementOutcome = {
  id: string;
  status:
    | 'applied'
    | 'pending'
    | 'rejected'
    | 'expired'
    | 'not-yet-current'
    | 'unknown-company'
    | 'identity-mismatch'
    | 'description-mismatch'
    | 'duplicate-source';
};

export const SUPPLEMENTS_PATH = resolve(__dirname, '../data/company-universe-supplements.json');
export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');
const WORD_SEPARATOR = /\s+/;

function record(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Supplement object required');
  }
  const item = value as Record<string, unknown>;
  if (
    Object.keys(item).some((key) => !keys.includes(key)) ||
    keys.some((key) => !Object.hasOwn(item, key))
  ) {
    throw new Error('Unknown or missing supplement field');
  }
  return item;
}

function text(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) {
    throw new Error('Nonempty trimmed supplement string required');
  }
}

function instant(value: unknown): asserts value is string {
  text(value);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value.replace(/Z$/, value.includes('.') ? 'Z' : '.000Z')
  ) {
    throw new Error('UTC supplement timestamp required');
  }
}

function hash(value: unknown): void {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error('SHA256 supplement hash required');
  }
}

function https(value: unknown): URL {
  text(value);
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.port) {
    throw new Error('HTTPS supplement URL without credentials or port required');
  }
  return url;
}

function host(value: string): string {
  return value.toLowerCase().replace(/^www\./, '');
}

export function canonicalSourceUrl(value: string): string {
  const url = https(value);
  url.hostname = host(url.hostname);
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) {
    if (/^(?:utm_.*|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid|ref|ref_src)$/i.test(key)) {
      url.searchParams.delete(key);
    }
  }
  url.searchParams.sort();
  return url.href;
}

function parseCapture(value: unknown): CompanySupplement['capture'] {
  const capture = record(value, [
    'sourceUrl',
    'finalUrl',
    'fetchedAt',
    'contentSha256',
    'claim',
    'excerpt',
    'sourceCompanyIdentity',
  ]);
  https(capture['sourceUrl']);
  https(capture['finalUrl']);
  instant(capture['fetchedAt']);
  hash(capture['contentSha256']);
  text(capture['claim']);
  text(capture['excerpt']);
  const excerptWords = capture['excerpt'].split(WORD_SEPARATOR);
  if (excerptWords.length > 25) throw new Error('Supplement excerpt exceeds 25 words');
  const identity = record(capture['sourceCompanyIdentity'], [
    'name',
    'canonicalWebsite',
    'identityBasis',
  ]);
  text(identity['name']);
  text(identity['identityBasis']);
  https(identity['canonicalWebsite']);
  return capture as CompanySupplement['capture'];
}

function parseReview(value: unknown, fetchedAt: string): CompanySupplement['review'] {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Supplement review required');
  const state = (value as Record<string, unknown>)['state'];
  if (state === 'accepted') {
    const review = record(value, [
      'state',
      'reviewedAt',
      'reviewer',
      'validUntil',
      'supportRationale',
      'identityRationale',
    ]);
    instant(review['reviewedAt']);
    instant(review['validUntil']);
    for (const key of ['reviewer', 'supportRationale', 'identityRationale']) text(review[key]);
    if (
      Date.parse(fetchedAt) > Date.parse(review['reviewedAt']) ||
      Date.parse(review['reviewedAt']) >= Date.parse(review['validUntil'])
    ) {
      throw new Error('Invalid supplement review chronology');
    }
    return review as CompanySupplement['review'];
  }
  if (state === 'pending' || state === 'rejected') {
    const review = record(value, ['state', 'reason']);
    text(review['reason']);
    return review as CompanySupplement['review'];
  }
  throw new Error('Unknown supplement review state');
}

function parseSupplement(value: unknown): CompanySupplement {
  const entry = record(value, [
    'id',
    'companySlug',
    'expectedName',
    'expectedDirectoryUrl',
    'expectedWebsiteHost',
    'expectedDescriptionSha256',
    'capture',
    'review',
  ]);
  for (const key of ['id', 'companySlug', 'expectedName', 'expectedWebsiteHost']) text(entry[key]);
  if (
    !/^[a-z0-9][a-z0-9-]*$/.test(entry['id'] as string) ||
    !/^[a-z0-9][a-z0-9-]*$/.test(entry['companySlug'] as string)
  ) {
    throw new Error('Invalid supplement identity');
  }
  hash(entry['expectedDescriptionSha256']);
  https(entry['expectedDirectoryUrl']);
  const expectedHost = entry['expectedWebsiteHost'] as string;
  if (https(`https://${expectedHost}`).hostname !== expectedHost || expectedHost.includes('/')) {
    throw new Error('Supplement website hostname required');
  }
  const capture = parseCapture(entry['capture']);
  parseReview(entry['review'], capture.fetchedAt);
  return entry as CompanySupplement;
}

export function parseCompanySupplements(input: unknown): readonly CompanySupplement[] {
  const registry = record(input, ['schemaVersion', 'entries']);
  if (registry['schemaVersion'] !== 1 || !Array.isArray(registry['entries'])) {
    throw new Error('Unsupported supplement registry version or entries');
  }
  const entries = registry['entries'].map(parseSupplement);
  if (new Set(entries.map((entry) => entry.id)).size !== entries.length) {
    throw new Error('Duplicate supplement identity');
  }
  return entries.sort((a, b) => a.id.localeCompare(b.id));
}

export function loadCompanySupplements(): readonly CompanySupplement[] {
  return parseCompanySupplements(JSON.parse(readFileSync(SUPPLEMENTS_PATH, 'utf8')));
}

export function isSupplementEvidence(item: SourceEvidence): item is OfficialCompanyEvidence {
  return (
    item.source === 'official-company-site' &&
    'evidenceKind' in item &&
    item.evidenceKind === 'reviewed-company-claim' &&
    'supplementId' in item
  );
}

// This allowlist is also the API boundary. Review rationales and private paths never project.
export function publicOfficialEvidence(item: OfficialCompanyEvidence): OfficialCompanyEvidence {
  return {
    source: 'official-company-site',
    evidenceKind: 'reviewed-company-claim',
    supplementId: item.supplementId,
    evidenceId: item.evidenceId,
    sourceUrl: item.sourceUrl,
    title: item.title,
    description: '',
    excerpt: item.excerpt,
    claim: item.claim,
    fetchedAt: item.fetchedAt,
    reviewedAt: item.reviewedAt,
    contentSha256: item.contentSha256,
    sourceCompanyName: item.sourceCompanyName,
  };
}

export function publicSourceEvidence(
  item: SourceEvidence,
  stripDescription = false
): SourceEvidence {
  if (isSupplementEvidence(item)) return publicOfficialEvidence(item);
  return {
    source: item.source,
    sourceUrl: item.sourceUrl,
    fund: item.fund,
    position: item.position,
    title: item.title,
    description: stripDescription ? '' : item.description,
    ...(item.cohort ? { cohort: item.cohort } : {}),
    ...(item.program ? { program: item.program } : {}),
    ...(!stripDescription && item.website ? { website: item.website } : {}),
    ...(!stripDescription && item.location ? { location: item.location } : {}),
    ...(!stripDescription && item.status ? { status: item.status } : {}),
  };
}

function matchesCompanyIdentity(company: UniverseCompany, entry: CompanySupplement): boolean {
  const directory = company.sourceEvidence.find(
    (item) =>
      !isSupplementEvidence(item) &&
      canonicalSourceUrl(item.sourceUrl) === canonicalSourceUrl(entry.expectedDirectoryUrl)
  );
  if (
    company.name !== entry.expectedName ||
    !directory ||
    !('website' in directory) ||
    !directory.website ||
    entry.capture.sourceCompanyIdentity.name !== entry.expectedName
  )
    return false;
  const expectedHost = host(entry.expectedWebsiteHost);
  try {
    const website = directory.website.includes('://')
      ? directory.website
      : `https://${directory.website}`;
    return (
      host(new URL(website).hostname) === expectedHost &&
      [
        entry.capture.sourceUrl,
        entry.capture.finalUrl,
        entry.capture.sourceCompanyIdentity.canonicalWebsite,
      ].every((url) => host(https(url).hostname) === expectedHost)
    );
  } catch {
    return false;
  }
}

function officialEvidence(entry: CompanySupplement): OfficialCompanyEvidence {
  if (entry.review.state !== 'accepted') throw new Error('Accepted supplement review required');
  return publicOfficialEvidence({
    source: 'official-company-site',
    evidenceKind: 'reviewed-company-claim',
    supplementId: entry.id,
    evidenceId: entry.id,
    sourceUrl: entry.capture.finalUrl,
    title: entry.expectedName,
    description: '',
    excerpt: entry.capture.excerpt,
    claim: entry.capture.claim,
    fetchedAt: entry.capture.fetchedAt,
    reviewedAt: entry.review.reviewedAt,
    contentSha256: entry.capture.contentSha256,
    sourceCompanyName: entry.capture.sourceCompanyIdentity.name,
  });
}

export function applyCompanySupplements(
  base: CompanyUniverseArtifact,
  entries: readonly CompanySupplement[],
  options: { asOf: string }
): { artifact: CompanyUniverseArtifact; outcomes: SupplementOutcome[] } {
  instant(options.asOf);
  // Revalidate even injected entries: malformed input must fail before any output replacement.
  const supplements = parseCompanySupplements({ schemaVersion: 1, entries });
  const registrySha256 = sha256(
    JSON.stringify({ schemaVersion: 1, entries: supplements }, (_key, value) =>
      value && typeof value === 'object' && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
        : value
    )
  );
  let companies = base.companies.map((company) => {
    const sourceEvidence = company.sourceEvidence.filter((item) => !isSupplementEvidence(item));
    return sourceEvidence.length === company.sourceEvidence.length
      ? company
      : { ...company, sourceEvidence };
  });
  const bySlug = new Map(companies.map((company, index) => [company.slug, index]));
  const sourceAliases = new Map(
    companies.map((company) => [
      company.slug,
      new Set(company.sourceEvidence.map((item) => canonicalSourceUrl(item.sourceUrl))),
    ])
  );
  const outcomes: SupplementOutcome[] = [];
  const appliedIds: string[] = [];
  for (const entry of supplements) {
    const outcome = (status: SupplementOutcome['status']) =>
      outcomes.push({ id: entry.id, status });
    if (entry.review.state !== 'accepted') {
      outcome(entry.review.state);
      continue;
    }
    if (Date.parse(entry.review.validUntil) <= Date.parse(options.asOf)) {
      outcome('expired');
      continue;
    }
    if (Date.parse(entry.review.reviewedAt) > Date.parse(options.asOf)) {
      outcome('not-yet-current');
      continue;
    }
    const index = bySlug.get(entry.companySlug);
    if (index === undefined) {
      outcome('unknown-company');
      continue;
    }
    const company = companies[index];
    if (!matchesCompanyIdentity(company, entry)) {
      outcome('identity-mismatch');
      continue;
    }
    if (sha256(company.description) !== entry.expectedDescriptionSha256) {
      outcome('description-mismatch');
      continue;
    }
    const aliases = new Set(
      [entry.capture.sourceUrl, entry.capture.finalUrl].map(canonicalSourceUrl)
    );
    if ([...aliases].some((url) => sourceAliases.get(company.slug)?.has(url))) {
      outcome('duplicate-source');
      continue;
    }
    const evidence = officialEvidence(entry);
    companies[index] = { ...company, sourceEvidence: [...company.sourceEvidence, evidence] };
    for (const alias of aliases) sourceAliases.get(company.slug)?.add(alias);
    appliedIds.push(entry.id);
    outcome('applied');
  }
  companies = companies.map((company) =>
    company.sourceEvidenceCount === undefined
      ? company
      : { ...company, sourceEvidenceCount: company.sourceEvidence.length }
  );
  return {
    artifact: {
      ...base,
      companies,
      supplementReview: { schemaVersion: 1, registrySha256, appliedIds, asOf: options.asOf },
    },
    outcomes,
  };
}
