import { describe, expect, it } from 'vitest';
import {
  canonicalAttentionUrl,
  positionUpdate,
  median,
  verificationReasons,
} from '../routes/admin-digg';

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
    expect(verificationReasons({ position: 18, positionDelta: 1, distinctAccountCount: 1 })).toEqual([
      'rank<=20',
    ]);
    expect(verificationReasons({ position: 40, positionDelta: 6, distinctAccountCount: 4 })).toEqual([
      'velocity>=5',
      'contributors>=3',
    ]);
    expect(verificationReasons({ position: 40, positionDelta: 1, distinctAccountCount: 2 })).toEqual(
      []
    );
  });

  it('calculates verification latency median', () => {
    expect(median([30, 90, 45])).toBe(45);
    expect(median([30, 90])).toBe(60);
    expect(median([])).toBeNull();
  });
});
