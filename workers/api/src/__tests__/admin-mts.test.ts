import { describe, expect, it } from 'vitest';
import { mtsVerificationReasons } from '../routes/admin-mts';

describe('MTS attention thresholds', () => {
  it('requests verification for material rank, movement, velocity, or breadth', () => {
    expect(mtsVerificationReasons({ position: 10 })).toEqual(['rank<=20']);
    expect(mtsVerificationReasons({ position: 40, positionDelta: 6 })).toEqual([
      'rank_velocity>=5',
    ]);
    expect(mtsVerificationReasons({ position: 40, velocity: 1.5 })).toEqual([
      'narrative_velocity>=1.25',
    ]);
    expect(mtsVerificationReasons({ position: 40, distinctSourceCount: 3 })).toEqual([
      'sources>=3',
    ]);
  });

  it('does not promote an ordinary low-ranked single-source item', () => {
    expect(
      mtsVerificationReasons({
        position: 40,
        positionDelta: 1,
        velocity: 1,
        distinctSourceCount: 1,
      })
    ).toEqual([]);
  });
});
