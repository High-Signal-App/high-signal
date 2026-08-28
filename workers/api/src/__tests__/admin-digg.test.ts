import { describe, expect, it } from 'vitest';
import {
  canonicalAttentionUrl,
  evidenceSearchTokens,
  positionUpdate,
  median,
  selectVerificationQueue,
  verificationReasons,
  type VerificationQueueRow,
} from '../routes/admin-digg';

function queueRow(
  shortId: string,
  overrides: Partial<VerificationQueueRow> = {}
): VerificationQueueRow {
  return {
    short_id: shortId,
    verification_status: 'requested',
    verification_attempts: 0,
    verification_requested_at: 1_000,
    verification_started_at: null,
    retrieved_at: 2_000,
    latest_retrieved_at: 2_000,
    position: 10,
    position_delta: 0,
    distinct_account_count: 2,
    ...overrides,
  };
}

describe('Digg attention normalization', () => {
  it('calculates positive velocity when a cluster rises', () => {
    expect(positionUpdate(9, 4)).toEqual({ position: 4, delta: 5 });
    expect(positionUpdate(4, 9)).toEqual({ position: 9, delta: -5 });
    expect(positionUpdate(4, null)).toEqual({ position: 4, delta: null });
  });

  it('canonicalizes source URLs without tracking parameters', () => {
    expect(
      canonicalAttentionUrl('https://www.example.com/story/?utm_source=digg&ref=home&id=7#top')
    ).toBe('https://example.com/story?id=7');
    expect(canonicalAttentionUrl('javascript:alert(1)')).toBeNull();
  });

  it('requests primary-source verification at rank, velocity, or voice thresholds', () => {
    expect(
      verificationReasons({ position: 18, positionDelta: 1, distinctAccountCount: 1 })
    ).toEqual(['rank<=20']);
    expect(
      verificationReasons({ position: 40, positionDelta: 6, distinctAccountCount: 4 })
    ).toEqual(['velocity>=5', 'contributors>=3']);
    expect(
      verificationReasons({ position: 40, positionDelta: 1, distinctAccountCount: 2 })
    ).toEqual([]);
  });

  it('calculates verification latency median', () => {
    expect(median([30, 90, 45])).toBe(45);
    expect(median([30, 90])).toBe(60);
    expect(median([])).toBeNull();
  });

  it('keeps fresh discoveries ahead of retries while reserving one fairness slot', () => {
    const fresh = Array.from({ length: 6 }, (_, index) =>
      queueRow(`fresh-${index + 1}`, {
        position: index + 1,
        verification_requested_at: 2_000 - index,
      })
    );
    const oldest = queueRow('oldest', {
      position: 50,
      retrieved_at: 500,
      verification_requested_at: 100,
    });
    const retry = queueRow('retry', {
      verification_status: 'insufficient_evidence',
      verification_attempts: 1,
      position: 1,
    });

    expect(selectVerificationQueue([...fresh, oldest, retry]).map((row) => row.short_id)).toEqual([
      'fresh-1',
      'fresh-2',
      'fresh-3',
      'fresh-4',
      'fresh-5',
      'oldest',
    ]);
  });

  it('uses remaining capacity for retries only after untouched discoveries', () => {
    const untouched = queueRow('untouched');
    const retryOnce = queueRow('retry-once', {
      verification_status: 'failed',
      verification_attempts: 1,
    });
    const retryTwice = queueRow('retry-twice', {
      verification_status: 'insufficient_evidence',
      verification_attempts: 2,
    });

    expect(
      selectVerificationQueue([retryTwice, retryOnce, untouched], 3).map((row) => row.short_id)
    ).toEqual(['untouched', 'retry-once', 'retry-twice']);
  });

  it('builds bounded retained-evidence search tokens with company-name variants', () => {
    expect(evidenceSearchTokens('Conviction Backs KeenableAI AI Search Team')).toEqual([
      'conviction',
      'backs',
      'keenable',
      'keenableai',
      'search',
    ]);
  });
});
