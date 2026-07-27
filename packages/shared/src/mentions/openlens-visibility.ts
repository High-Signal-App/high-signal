// High Signal retains product-only report sharing and agent-eval attribute
// ordering. Visibility analytics are owned by @saas-maker/ai-visibility.
export {
  buildVisibilityMatrix,
  classifyOwnership,
  computeCitationGaps,
  computePersonaVisibility,
  computeShareOfVoice,
  computeTrends,
  computeVisibilityScore,
  hostOf,
  perPlatformMentionRate,
  type BrandIdentity,
  type CitationGap,
  type MatrixCell,
  type MatrixRow,
  type MentionRow,
  type Ownership,
  type PersonaVisibility,
  type ShareOfVoice,
  type TrendPoint,
  type VisibilityScore,
} from '@saas-maker/ai-visibility';

export type AttributeArea =
  | 'positioning'
  | 'pricing'
  | 'proof'
  | 'comparisons'
  | 'docs'
  | 'policies'
  | 'reviews'
  | 'transaction_readiness';

export interface AttributeRow {
  area: string;
  status: 'missing' | 'weak' | 'clear' | 'strong';
  evidenceUrls: string[];
  notes: string;
  taskCount: number;
}

const ATTRIBUTE_ORDER: AttributeArea[] = [
  'positioning',
  'pricing',
  'proof',
  'comparisons',
  'docs',
  'policies',
  'reviews',
  'transaction_readiness',
];

export function sortAttributes(rows: AttributeRow[]): AttributeRow[] {
  const index = (area: string) => {
    const found = (ATTRIBUTE_ORDER as string[]).indexOf(area);
    return found === -1 ? ATTRIBUTE_ORDER.length : found;
  };
  return [...rows].sort((left, right) => index(left.area) - index(right.area));
}

export async function visibilityReportToken(secret: string, brandId: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(`report:${brandId}`));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32);
}

export async function verifyVisibilityReportToken(
  secret: string,
  brandId: string,
  candidate: string
): Promise<boolean> {
  const expected = await visibilityReportToken(secret, brandId);
  if (candidate.length !== expected.length) return false;
  let mismatch = 0;
  for (let index = 0; index < expected.length; index++) {
    mismatch |= expected.charCodeAt(index) ^ candidate.charCodeAt(index);
  }
  return mismatch === 0;
}
