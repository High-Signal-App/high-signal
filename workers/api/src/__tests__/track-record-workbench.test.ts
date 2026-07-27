import { describe, expect, it } from 'vitest';
import { actionBand, actionQualityScore, buildActionWorkbench } from '../routes/track-record';

const baseRow = {
  id: 'sig_1',
  slug: 'sig-1',
  title: 'Signal one',
  signalType: 'capex_raise',
  direction: 'up' as const,
  confidence: 'high' as const,
  predictedWindowDays: 14,
  publishedAt: 1_700_000_000,
  evidenceCount: 2,
  outcome: 'hit' as const,
  forwardReturn: 0.08,
  windowDays: 14,
  isBackfill: 0,
};

describe('track record action workbench', () => {
  it('scores action quality from outcome, evidence, confidence, and horizon', () => {
    const score = actionQualityScore(baseRow);

    expect(score).toBeGreaterThanOrEqual(90);
    expect(actionBand(score)).toBe('compound');
    expect(actionQualityScore({ ...baseRow, outcome: 'pending' })).toBeNull();
  });

  it('recommends promotion for repeatable high-quality signal types', () => {
    const workbench = buildActionWorkbench([
      baseRow,
      { ...baseRow, id: 'sig_2', slug: 'sig-2', forwardReturn: 0.06 },
      { ...baseRow, id: 'sig_3', slug: 'sig-3', confidence: 'medium', forwardReturn: 0.04 },
      {
        ...baseRow,
        id: 'sig_4',
        slug: 'sig-4',
        signalType: 'supplier_warning',
        confidence: 'high',
        outcome: 'miss',
        forwardReturn: -0.07,
      },
      {
        ...baseRow,
        id: 'sig_5',
        slug: 'sig-5',
        signalType: 'supplier_warning',
        confidence: 'medium',
        outcome: 'miss',
        evidenceCount: 1,
      },
      {
        ...baseRow,
        id: 'sig_6',
        slug: 'sig-6',
        signalType: 'supplier_warning',
        confidence: 'high',
        outcome: 'miss',
        predictedWindowDays: 90,
      },
    ]);

    expect(workbench.summary.signals).toBe(6);
    expect(workbench.summary.promoteTypes).toBe(1);
    expect(workbench.buckets[0]).toMatchObject({
      signalType: 'capex_raise',
      recommendedAction: 'promote',
    });
    expect(
      workbench.buckets.find((bucket) => bucket.signalType === 'supplier_warning')
        ?.recommendedAction
    ).toBe('retire-or-rewrite');
  });
});
