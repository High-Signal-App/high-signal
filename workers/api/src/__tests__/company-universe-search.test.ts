import { describe, expect, it } from 'vitest';
import { companySearchTokens, normalizeCompanySearch } from '../routes/company-universe';

describe('company universe ranked search', () => {
  it('normalizes punctuation and accents consistently', () => {
    expect(normalizeCompanySearch('  Santé-AI / Finance  ')).toBe('sante ai finance');
  });

  it('removes question phrasing while preserving match terms', () => {
    expect(companySearchTokens('what companies do AI workflow finance')).toEqual([
      'ai',
      'workflow',
      'finance',
    ]);
  });

  it('deduplicates institution aliases and query terms', () => {
    expect(companySearchTokens('YC yc a16z')).toEqual(['yc', 'a16z']);
  });
});
