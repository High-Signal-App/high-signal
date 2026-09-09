import type { VerdictResult } from './auto-publish-rules';

export interface JudgeEvidence {
  url: string;
  excerpt: string | null;
  textCoverage: 'retained_excerpt' | 'unavailable';
}

/** Only retained text from the owning API is evidence, never URL wording or draft prose. */
export function retainedJudgeEvidence(urls: string[], payload: unknown): JudgeEvidence[] {
  const rows =
    payload &&
    typeof payload === 'object' &&
    'evidence' in payload &&
    Array.isArray(payload.evidence)
      ? payload.evidence
      : [];
  return [...new Set(urls)].slice(0, 8).map((url) => {
    const row = rows.find(
      (item) =>
        item &&
        typeof item === 'object' &&
        item.url === url &&
        typeof item.excerpt === 'string' &&
        item.excerpt.trim()
    );
    const excerpt = row ? row.excerpt.trim().slice(0, 1500) : null;
    return { url, excerpt, textCoverage: excerpt ? 'retained_excerpt' : 'unavailable' };
  });
}

/** A model cannot certify a source it was not shown, even when its JSON is valid. */
export function groundJudgeVerdict(
  verdict: VerdictResult,
  evidence: JudgeEvidence[]
): VerdictResult {
  if (verdict.verdict !== 'publish') return verdict;
  const visible = new Set(evidence.filter((item) => item.excerpt).map((item) => item.url));
  const aligned = verdict.evidenceAssessments?.filter((item) => item.aligned) ?? [];
  if (
    new Set(aligned.map((item) => item.url)).size < 2 ||
    aligned.some((item) => !visible.has(item.url))
  ) {
    return {
      verdict: 'kill',
      source: 'rule',
      reason: 'semantic publish assessment lacks retained source text for aligned evidence',
    };
  }
  return verdict;
}
