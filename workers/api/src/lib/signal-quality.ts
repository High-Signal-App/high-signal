import { assessSignalQuality } from '@high-signal/shared';
import { schema } from '../db';

export function enrichSignal<T extends typeof schema.signals.$inferSelect>(signal: T) {
  const quality = assessSignalQuality({
    signalType: signal.signalType,
    primaryEntityId: signal.primaryEntityId,
    confidence: signal.confidence,
    evidenceUrls: (signal.evidenceUrls ?? []) as string[],
    bodyMd: signal.bodyMd,
  });
  return {
    ...signal,
    contentCategory: quality.contentCategory,
    qualityScore: quality.score,
    qualityBand: quality.band,
    publishable: quality.publishable,
    sourceClasses: quality.sourceClasses,
    independentSourceCount: quality.independentSourceCount,
    qualityReasons: quality.reasons,
  };
}
