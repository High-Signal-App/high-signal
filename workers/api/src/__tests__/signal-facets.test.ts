import { describe, expect, it } from 'vitest';
import { buildSignalFacets } from '../lib/signal-facets';

describe('buildSignalFacets', () => {
  it('derives every facet from the same bounded signal set', () => {
    const facets = buildSignalFacets([
      {
        signalType: 'funding',
        direction: 'up',
        confidence: 'high',
        primaryEntityId: 'entity-b',
        contentCategory: 'market',
        sourceClasses: ['official', 'news'],
      },
      {
        signalType: 'funding',
        direction: 'up',
        confidence: 'medium',
        primaryEntityId: 'entity-a',
        contentCategory: 'market',
        sourceClasses: ['official'],
      },
      {
        signalType: 'launch',
        direction: 'neutral',
        confidence: 'high',
        primaryEntityId: null,
        contentCategory: 'product',
        sourceClasses: ['news'],
      },
    ]);

    expect(facets).toEqual({
      types: [
        { k: 'funding', n: 2 },
        { k: 'launch', n: 1 },
      ],
      directions: [
        { k: 'up', n: 2 },
        { k: 'neutral', n: 1 },
      ],
      confidences: [
        { k: 'high', n: 2 },
        { k: 'medium', n: 1 },
      ],
      topEntities: [
        { k: 'entity-a', n: 1 },
        { k: 'entity-b', n: 1 },
      ],
      categories: [
        { k: 'market', n: 2 },
        { k: 'product', n: 1 },
      ],
      sourceClasses: [
        { k: 'news', n: 2 },
        { k: 'official', n: 2 },
      ],
    });
  });

  it('caps entity facets at twenty', () => {
    const signals = Array.from({ length: 25 }, (_, index) => ({
      signalType: 'launch',
      direction: 'up',
      confidence: 'high',
      primaryEntityId: `entity-${String(index).padStart(2, '0')}`,
      contentCategory: 'product',
      sourceClasses: ['official'],
    }));

    expect(buildSignalFacets(signals).topEntities).toHaveLength(20);
  });
});
