import { describe, expect, it } from 'vitest';
import { canonicalAttentionUrl, positionUpdate } from '../routes/admin-digg';

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
});
