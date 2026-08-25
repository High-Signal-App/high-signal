import type { Direction } from '../primitives';

export interface PublishabilityInput {
  evidenceUrls: readonly string[];
  direction?: Direction | string | null;
  publishedAt?: string | number | Date | null;
  qualityEligible?: boolean;
  unresolvedContradictions?: number;
  oppositeDirectionConflict?: boolean;
  semanticOrigins?: readonly string[];
  requireSemanticOrigins?: boolean;
  now?: Date;
}

export interface PublishabilityResult {
  publishable: boolean;
  reason: string;
}

const PREDICTION_HOSTS = ['manifold.markets', 'polymarket.com', 'kalshi.com', 'metaculus.com'];

function host(value: string) {
  try {
    return new URL(value).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

function isPredictionOnly(urls: readonly string[]) {
  const usable = urls.filter(Boolean);
  return (
    usable.length > 0 &&
    usable.every((url) => {
      const value = host(url);
      return PREDICTION_HOSTS.some(
        (candidate) => value === candidate || value.endsWith(`.${candidate}`)
      );
    })
  );
}

/** The one fail-closed publication policy shared by every public surface. */
export function publishability(input: PublishabilityInput): PublishabilityResult {
  if (input.direction != null && !['up', 'down', 'neutral'].includes(input.direction)) {
    return { publishable: false, reason: 'impossible_direction' };
  }
  if (input.publishedAt != null) {
    const publishedAt = new Date(input.publishedAt).getTime();
    const now = (input.now ?? new Date()).getTime();
    if (!Number.isFinite(publishedAt)) return { publishable: false, reason: 'invalid_date' };
    if (publishedAt > now + 5 * 60 * 1000) return { publishable: false, reason: 'future_dated' };
  }
  if (isPredictionOnly(input.evidenceUrls)) {
    return { publishable: false, reason: 'prediction-market-only evidence' };
  }
  if ((input.unresolvedContradictions ?? 0) > 0) {
    return { publishable: false, reason: 'unresolved_contradiction' };
  }
  if (input.oppositeDirectionConflict) {
    return { publishable: false, reason: 'opposite_direction_conflict' };
  }
  if (input.requireSemanticOrigins && !input.semanticOrigins) {
    return { publishable: false, reason: 'missing_semantic_provenance' };
  }
  if (input.semanticOrigins) {
    const origins = new Set(input.semanticOrigins.filter(Boolean));
    if (origins.size < 2) return { publishable: false, reason: 'single_evidentiary_origin' };
  }
  if (input.qualityEligible === false) {
    return { publishable: false, reason: 'quality_gate_failed' };
  }
  return { publishable: true, reason: 'publishability_passed' };
}

export interface DirectionalSignal {
  id: string;
  primaryEntityId: string;
  signalType: string;
  direction: Direction;
  publishedAt: string | number | Date;
}

/** Same entity, event type, and UTC day cannot carry unresolved up/down calls. */
export function oppositeDirectionConflictIds(signals: readonly DirectionalSignal[]): Set<string> {
  const groups = new Map<string, DirectionalSignal[]>();
  for (const signal of signals) {
    if (signal.direction === 'neutral') continue;
    const time = new Date(signal.publishedAt);
    if (!Number.isFinite(time.getTime())) continue;
    const key = `${signal.primaryEntityId}:${signal.signalType}:${time.toISOString().slice(0, 10)}`;
    const group = groups.get(key) ?? [];
    group.push(signal);
    groups.set(key, group);
  }
  const conflicts = new Set<string>();
  for (const group of groups.values()) {
    if (new Set(group.map((signal) => signal.direction)).size < 2) continue;
    for (const signal of group) conflicts.add(signal.id);
  }
  return conflicts;
}
