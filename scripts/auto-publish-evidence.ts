import { hasValidPublishReceipt, type VerdictResult } from './auto-publish-rules';
import { classifySource, type SourceClass } from '@high-signal/shared';

export interface JudgeEvidence {
  url: string;
  excerpt: string | null;
  textCoverage: 'retained_excerpt' | 'unavailable';
  sourceType?: string;
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
    return {
      url,
      excerpt,
      textCoverage: excerpt ? 'retained_excerpt' : 'unavailable',
      ...(typeof row?.sourceType === 'string' ? { sourceType: row.sourceType } : {}),
    };
  });
}

/** Retained ingestion types describe documents; they never certify independent origins. */
export function retainedSourceClasses(evidence: JudgeEvidence[]): SourceClass[] {
  return [
    ...new Set(
      evidence.map((item): SourceClass => {
        if (item.sourceType === 'ir' || item.sourceType === 'sec') return 'official';
        if (item.sourceType === 'news') return 'news';
        return classifySource(item.url);
      })
    ),
  ];
}

// Conservative publisher-independence gate: a credited wire reprint cannot
// supply a second independent publisher beside that wire service. This does
// not assert identical story identity; ambiguous assessments need review.
// Ordinary mentions and short quotations do not establish syndication.
function wireAttribution(item: JudgeEvidence): string | null {
  return (
    /^\s*\((Bloomberg|Reuters)\)\s*(?:--|—|–)/i.exec(item.excerpt ?? '')?.[1]?.toLowerCase() ?? null
  );
}

function wirePublisher(url: string): string | null {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return (
      ['bloomberg', 'reuters'].find(
        (wire) => host === `${wire}.com` || host.endsWith(`.${wire}.com`)
      ) ?? null
    );
  } catch {
    return null;
  }
}

/** A model cannot certify a source it was not shown, even when its JSON is valid. */
export function groundJudgeVerdict(
  verdict: VerdictResult,
  evidence: JudgeEvidence[]
): VerdictResult {
  if (verdict.verdict !== 'publish') return verdict;
  if (!hasValidPublishReceipt(verdict)) {
    return { verdict: 'kill', source: 'rule', reason: 'invalid publish receipt' };
  }
  const expected = new Set(evidence.map((item) => item.url));
  const assessments = verdict.evidenceAssessments!;
  if (assessments.length !== expected.size || assessments.some((item) => !expected.has(item.url))) {
    return {
      verdict: 'kill',
      source: 'rule',
      reason: 'publish receipt must assess each cited URL exactly once',
    };
  }
  const visible = new Set(evidence.filter((item) => item.excerpt).map((item) => item.url));
  const aligned = verdict.evidenceAssessments?.filter((item) => item.aligned) ?? [];
  if (
    new Set(aligned.map((item) => item.url)).size < 2 ||
    new Set(aligned.map((item) => item.originatingEvidenceId)).size < 2 ||
    aligned.some((item) => !visible.has(item.url))
  ) {
    return {
      verdict: 'kill',
      source: 'rule',
      reason: 'semantic publish assessment lacks retained source text for aligned evidence',
    };
  }
  for (const item of evidence) {
    const wire = wireAttribution(item);
    const assessment = aligned.find((link) => link.url === item.url);
    if (!wire || !assessment) continue;
    const contradicted = evidence.some((other) => {
      if (
        other.url === item.url ||
        (wireAttribution(other) !== wire && wirePublisher(other.url) !== wire)
      )
        return false;
      const peer = aligned.find((link) => link.url === other.url);
      return peer && peer.originatingEvidenceId !== assessment.originatingEvidenceId;
    });
    if (contradicted)
      return {
        verdict: 'kill',
        source: 'rule',
        reason: 'explicit wire attribution contradicts model-certified source independence',
      };
  }
  return verdict;
}
