export const PUBLIC_CORPUS_POLICY_REVISION = '2026-08-14.1';

export const PUBLIC_CORPUS_ROUTE_FAMILIES = Object.freeze([
  'company',
  'signal',
  'entity',
  'entity-period',
  'brief',
  'taxonomy',
  'directory-page',
]);

const PRODUCT_OVERLAP =
  /shared (?:extracted concept terms|product terms|product theme|capabilit(?:y|ies)|use cases?|technolog(?:y|ies)|target customers?|industr(?:y|ies))/i;

function verdict(family, reasons, tier = 'withheld') {
  const orderedReasons = [...new Set(reasons)].sort();
  return Object.freeze({
    family,
    eligible: orderedReasons.length === 0,
    tier: orderedReasons.length === 0 ? tier : 'withheld',
    reasons: Object.freeze(orderedReasons),
    policyRevision: PUBLIC_CORPUS_POLICY_REVISION,
  });
}

function textLength(value) {
  return typeof value === 'string' ? value.trim().length : 0;
}

function count(value) {
  return Array.isArray(value) ? value.length : 0;
}

export function evaluateCompany(company) {
  const reasons = [];
  if (count(company?.sourceEvidence) < 2) reasons.push('fewer-than-two-official-sources');
  if (textLength(company?.description) < 160) reasons.push('description-under-160');
  if (count(company?.entities) < 2) reasons.push('fewer-than-two-product-facets');
  if (!company?.competitors?.some((edge) => PRODUCT_OVERLAP.test(edge?.reason ?? ''))) {
    reasons.push('no-product-supported-similarity');
  }
  return verdict('company', reasons, 'substantive');
}

export function evaluateSignal(signal) {
  const reasons = [];
  if (signal?.reviewStatus !== 'published') reasons.push('not-published');
  if (
    signal?.isBackfill === true ||
    signal?.isBackfill === 1 ||
    signal?.bodyMd?.trimStart().startsWith('> _backfill_')
  ) {
    reasons.push('backfill-record');
  }
  if (textLength(signal?.bodyMd) < 240) reasons.push('signal-body-under-240');
  if (count(signal?.evidenceUrls) < 2) reasons.push('fewer-than-two-citations');
  return verdict('signal', reasons, 'evidence');
}

export function evaluateEntity(entity) {
  const reasons = [];
  const signalCount = Number(entity?.signalCount ?? 0);
  const relationshipCount = Number(entity?.relationshipCount ?? 0);
  const marketQuoteCount = Number(entity?.marketQuoteCount ?? 0);
  if (signalCount < 1 && relationshipCount < 2 && marketQuoteCount < 1) {
    reasons.push('insufficient-entity-evidence');
  }
  return verdict('entity', reasons, 'evidence');
}

export function evaluateCollection(family, collection, minimumChildren = 2) {
  if (!['entity-period', 'brief', 'taxonomy'].includes(family)) {
    throw new Error(`Unsupported public corpus collection family: ${family}`);
  }
  const reasons = [];
  if (Number(collection?.childCount ?? 0) < minimumChildren) {
    reasons.push(`fewer-than-${minimumChildren}-eligible-children`);
  }
  if (collection?.hasProvenance === false) reasons.push('missing-collection-provenance');
  return verdict(family, reasons, 'collection');
}

export function evaluateDirectoryPage() {
  return verdict('directory-page', ['navigation-only']);
}

export function robotsForVerdict(result) {
  return result.eligible ? undefined : { index: false, follow: true };
}

export function meaningfulCompanySimilarity(edge) {
  return PRODUCT_OVERLAP.test(edge?.reason ?? '');
}

export function shouldIncludeInDiscovery(result) {
  return result.eligible;
}
