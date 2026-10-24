import { describe, expect, it } from 'vitest';
import {
  communityPassages,
  communityReportProof,
  isCommunitySupportingDocument,
} from '../lib/community-report-proof';
import {
  reportFixture,
  researchDocument,
  verificationFixture,
} from '../../test/community-report-fixtures';

const documents = () => [researchDocument('primary'), researchDocument('corroboration')];

function resultFor(changes: Parameters<typeof communityReportProof>[2]) {
  return communityReportProof(reportFixture(), verificationFixture(), changes);
}

describe('community report retained proof', () => {
  it('resolves retained quotes and actual source documents for independent support', () => {
    const input = documents();
    const result = resultFor(input);
    expect(result).not.toHaveProperty('error');
    if ('error' in result) throw new Error(result.error);
    expect(result.evidence.map((link) => link.sourceDocumentId)).toEqual([
      'primary',
      'corroboration',
    ]);
    expect(new Set(result.evidence.map((link) => link.originatingEvidenceId)).size).toBe(2);
    for (const link of result.evidence) {
      const receipt = JSON.parse(link.notes!);
      const document = input.find((document) => document.id === link.sourceDocumentId)!;
      expect(receipt.quote).toBe(document.passages['P0']);
      expect(document.text).toContain(receipt.quote);
      expect(receipt.documentHash).toBe(document.hash);
    }
  });

  it.each(['identical_hash', 'normalized_repetitive_text', 'same_declared_origin'])(
    'withholds copied origins even when a verifier declares publisher diversity: %s',
    (scenario) => {
      const input = documents();
      const verification = verificationFixture();
      if (scenario === 'identical_hash') input[1].hash = input[0].hash;
      if (scenario === 'normalized_repetitive_text') {
        const text =
          'Developers reported additional review effort when checking generated code. '.repeat(9);
        input[0] = researchDocument('primary', { text });
        input[1] = researchDocument('corroboration', {
          text: text.toUpperCase().replaceAll(' ', '  '),
        });
      }
      if (scenario === 'same_declared_origin')
        verification.evidence[1].origin = verification.evidence[0].origin;
      expect(communityReportProof(reportFixture(), verification, input)).toHaveProperty('error');
    }
  );

  it.each(['reuters', 'bloomberg'])(
    'collapses an explicit %s reprint beside its originating wire',
    (wire) => {
      const input = documents();
      input[0].url = `https://www.${wire}.com/news/developer-study`;
      input[1] = researchDocument('corroboration', {
        text: `(${wire[0].toUpperCase()}${wire.slice(1)}) -- ${input[1].text}`,
      });
      expect(resultFor(input)).toHaveProperty('error');
    }
  );

  it('does not mistake a shared short quotation for copied independent studies', () => {
    const input = documents();
    const quote = 'The authors caution that self-reported results have limits. ';
    input[0] = researchDocument('primary', { text: quote + input[0].text });
    input[1] = researchDocument('corroboration', { text: quote + input[1].text });
    expect(resultFor(input)).not.toHaveProperty('error');
  });

  it('withholds fabricated documents and missing passage IDs', () => {
    const report = reportFixture();
    report.citations[0].documentId = 'fabricated-document';
    expect(communityReportProof(report, verificationFixture(), documents())).toHaveProperty(
      'error'
    );
    const missingPassage = reportFixture();
    missingPassage.citations[0].passageId = 'missing-passage';
    expect(communityReportProof(missingPassage, verificationFixture(), documents())).toEqual({
      error: 'invalid_passage',
    });
  });

  it('rejects an invented passage value even if its ID is supplied', () => {
    const input = documents();
    input[0].passages['P0'] =
      'This fabricated paragraph is not present in the retained source document.';
    expect(resultFor(input)).toEqual({ error: 'invalid_passage' });
  });

  it('requires a separate document for corroboration', () => {
    const report = reportFixture();
    report.citations[1].documentId = 'primary';
    expect(communityReportProof(report, verificationFixture(), documents())).toEqual({
      error: 'duplicate_document',
    });
  });

  it.each([
    { source: 'reddit:ExperiencedDevs' },
    { metadata: { source_class: 'attention_aggregator' } },
    { metadata: { evidenceTier: 'derived', confidenceContribution: 'none' } },
    { url: 'https://www.reddit.com/r/ExperiencedDevs/comments/source' },
    { url: 'https://polymarket.com/event/developer-productivity' },
    { url: 'http://127.0.0.1/article' },
    { url: 'http://localhost/article' },
    { url: 'https://research.internal/article' },
    { url: 'https://publisher.example/article?access_token=private-value' },
    { url: 'https://name:password@publisher.example/article' },
  ])('withholds attention-only or nonpublic evidence: %j', (changes) => {
    const input = [researchDocument('primary', changes), researchDocument('corroboration')];
    expect(isCommunitySupportingDocument(input[0])).toBe(false);
    expect(resultFor(input)).toEqual({ error: 'unsupported_document' });
  });

  it.each([-29 * 86_400_000, 10 * 60_000])('rejects out-of-window evidence: %s ms', (offset) => {
    const now = new Date();
    const input = documents();
    input[0].publishedAt = new Date(now.getTime() + offset).toISOString();
    expect(communityReportProof(reportFixture(), verificationFixture(), input, now)).toEqual({
      error: 'outside_research_window',
    });
  });

  it('withholds an unsupported statistical headline even with a supported description', () => {
    const report = reportFixture({ title: '90% of developers demand paid code review tools' });
    const verification = verificationFixture();
    verification.copyAligned = false;
    expect(communityReportProof(report, verification, documents())).toHaveProperty('error');
  });

  it('withholds unsupported implications, contradictions and missing assessments', () => {
    const noImplication = verificationFixture();
    noImplication.evidence.forEach((item) => {
      item.supports = ['description'];
    });
    expect(communityReportProof(reportFixture(), noImplication, documents())).toEqual({
      error: 'unsupported_implication',
    });
    const contradiction = verificationFixture();
    contradiction.evidence[1].role = 'contradiction';
    expect(communityReportProof(reportFixture(), contradiction, documents())).toEqual({
      error: 'contradiction_present',
    });
    const missing = verificationFixture();
    missing.evidence.pop();
    expect(communityReportProof(reportFixture(), missing, documents())).toEqual({
      error: 'missing_or_duplicate_assessment',
    });
  });

  it('constructs bounded exact passages, including long unbroken input', () => {
    const text = 'α'.repeat(1_200) + '\n' + 'A complete retained sentence. '.repeat(400);
    const passages = Object.values(communityPassages(text));
    expect(passages.length).toBeGreaterThan(2);
    expect(
      passages.every(
        (passage) => passage.length >= 40 && passage.length <= 600 && text.includes(passage)
      )
    ).toBe(true);
    expect(passages.join('').length).toBeLessThanOrEqual(8_000);
  });
});
