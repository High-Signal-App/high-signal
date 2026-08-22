import { describe, expect, it } from 'vitest';
import { normalizeCommunitySummary, redditSourceLink } from '@high-signal/shared';

// Was product-contracts.test.ts. The Mentions / AgentMode dashboard contracts it
// also covered were removed when High Signal went fully public; the community
// digest summary shape is the part that survives, and the public Daily Brief's
// "Behavior & Culture" section depends on it.
describe('community digest contracts', () => {
  it('normalizes source-linked digest summaries', () => {
    const summary = normalizeCommunitySummary({
      key_trend: {
        title: 'Operators want source links',
        desc: 'Digest consumers need provenance before acting.',
        sourceId: ['abc123', 'def456'],
      },
      notable_discussions: [{ title: 'Budget controls', desc: 'Teams ask for spend caps.' }],
    });

    expect(summary?.keyTrend?.title).toBe('Operators want source links');
    expect(summary?.notableDiscussions).toHaveLength(1);
    expect(redditSourceLink('LocalLLaMA', summary?.keyTrend?.sourceId)).toBe(
      'https://www.reddit.com/r/LocalLLaMA/comments/abc123/comment/def456'
    );
  });

  it('returns null for an unusable summary payload', () => {
    expect(normalizeCommunitySummary(null)).toBeNull();
    expect(normalizeCommunitySummary('not an object')).toBeNull();
  });
});
