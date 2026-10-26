export const SIGNAL_MEASUREMENT_INTENT = 'signal_measurement_intent';
export const SIGNAL_MEASUREMENT_PUBLISHED = 'signal_measurement_published';

export interface SignalMeasurementReceipt {
  schemaVersion: 1;
  signalId: string;
  claimId: string;
  claimSha256: string;
  firstPublishedAt: string;
  dueAt: string;
  resolutionRule: {
    id: 'market-direction-forward-return';
    version: 1;
    metric: 'forward_return_percent';
    priceSource: 'shared_equities_close_adapter';
    startClosePolicy: 'first_available_on_or_after_publication_date';
    targetCloseIndexPolicy: 'min(windowDays, available_close_count_minus_one)';
    calendarEndBufferMultiplier: 1.6;
    direction: 'up' | 'down' | 'neutral';
    windowDays: number;
    pushBandPercent: 0.5;
    neutralPushBandPercent: 2;
  };
}

export async function buildSignalMeasurementReceipt(input: {
  signalId: string;
  claimId: string;
  claimAssertion: string;
  direction: 'up' | 'down' | 'neutral';
  windowDays: number;
  firstPublishedAt: Date;
}): Promise<SignalMeasurementReceipt | null> {
  if (!Number.isSafeInteger(input.windowDays) || input.windowDays <= 0) return null;
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(input.claimAssertion)
  );
  const claimSha256 = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');
  const dueAt = new Date(input.firstPublishedAt.getTime() + input.windowDays * 86_400_000);
  return {
    schemaVersion: 1,
    signalId: input.signalId,
    claimId: input.claimId,
    claimSha256,
    firstPublishedAt: input.firstPublishedAt.toISOString(),
    dueAt: dueAt.toISOString(),
    resolutionRule: {
      id: 'market-direction-forward-return',
      version: 1,
      metric: 'forward_return_percent',
      priceSource: 'shared_equities_close_adapter',
      startClosePolicy: 'first_available_on_or_after_publication_date',
      targetCloseIndexPolicy: 'min(windowDays, available_close_count_minus_one)',
      calendarEndBufferMultiplier: 1.6,
      direction: input.direction,
      windowDays: input.windowDays,
      pushBandPercent: 0.5,
      neutralPushBandPercent: 2,
    },
  };
}

export type MeasurementState = 'pending' | 'resolved' | 'unresolved' | 'unscorable';
export type MeasurementReason =
  | 'due_without_score'
  | 'forward_return_unavailable'
  | 'missing_ticker'
  | 'invalid_receipt';

export interface MeasurementCohortRow {
  signalSlug: string | null;
  claimId: string;
  claimSha256: string | null;
  firstPublishedAt: string | null;
  dueAt: string | null;
  resolutionRule: SignalMeasurementReceipt['resolutionRule'] | null;
  outcome: 'hit' | 'miss' | 'push' | 'pending' | null;
  state: MeasurementState;
  reason: MeasurementReason | null;
}

export interface MeasurementCohortSummary {
  denominator: number;
  pending: number;
  resolved: number;
  unresolved: number;
  unscorable: number;
  unresolvedReasons: Partial<Record<MeasurementReason, number>>;
  unscorableReasons: Partial<Record<MeasurementReason, number>>;
  records: MeasurementCohortRow[];
}

export function parseSignalMeasurementReceipt(payload: string): SignalMeasurementReceipt | null {
  let value: unknown;
  try {
    value = JSON.parse(payload);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const row = value as Partial<SignalMeasurementReceipt>;
  const rule = row.resolutionRule;
  if (
    row.schemaVersion !== 1 ||
    typeof row.signalId !== 'string' ||
    typeof row.claimId !== 'string' ||
    typeof row.claimSha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(row.claimSha256) ||
    typeof row.firstPublishedAt !== 'string' ||
    !Number.isFinite(Date.parse(row.firstPublishedAt)) ||
    typeof row.dueAt !== 'string' ||
    !Number.isFinite(Date.parse(row.dueAt)) ||
    !rule ||
    rule.id !== 'market-direction-forward-return' ||
    rule.version !== 1 ||
    rule.metric !== 'forward_return_percent' ||
    rule.priceSource !== 'shared_equities_close_adapter' ||
    rule.startClosePolicy !== 'first_available_on_or_after_publication_date' ||
    rule.targetCloseIndexPolicy !== 'min(windowDays, available_close_count_minus_one)' ||
    rule.calendarEndBufferMultiplier !== 1.6 ||
    !['up', 'down', 'neutral'].includes(rule.direction) ||
    !Number.isSafeInteger(rule.windowDays) ||
    rule.windowDays <= 0 ||
    rule.pushBandPercent !== 0.5 ||
    rule.neutralPushBandPercent !== 2
  ) {
    return null;
  }
  return row as SignalMeasurementReceipt;
}

export function summarizeMeasurementCohort(
  input: Array<{
    signalSlug: string | null;
    claimId: string;
    payload: string;
    outcome: string | null;
    notes: string | null;
  }>,
  now = new Date()
): MeasurementCohortSummary {
  const summary: MeasurementCohortSummary = {
    denominator: input.length,
    pending: 0,
    resolved: 0,
    unresolved: 0,
    unscorable: 0,
    unresolvedReasons: {},
    unscorableReasons: {},
    records: [],
  };
  for (const row of input) {
    const receipt = parseSignalMeasurementReceipt(row.payload);
    if (!receipt || receipt.claimId !== row.claimId) {
      summary.unscorable++;
      summary.unscorableReasons['invalid_receipt'] =
        (summary.unscorableReasons['invalid_receipt'] ?? 0) + 1;
      summary.records.push({
        signalSlug: row.signalSlug,
        claimId: row.claimId,
        claimSha256: null,
        firstPublishedAt: null,
        dueAt: null,
        resolutionRule: null,
        outcome: null,
        state: 'unscorable',
        reason: 'invalid_receipt',
      });
      continue;
    }
    const outcome = ['hit', 'miss', 'push', 'pending'].includes(row.outcome ?? '')
      ? (row.outcome as MeasurementCohortRow['outcome'])
      : null;
    let state: MeasurementState;
    let reason: MeasurementReason | null = null;
    if (outcome === 'hit' || outcome === 'miss' || outcome === 'push') {
      state = 'resolved';
    } else if (outcome === 'pending' && row.notes?.startsWith('no ticker for entity ')) {
      state = 'unscorable';
      reason = 'missing_ticker';
      summary.unscorableReasons[reason] = (summary.unscorableReasons[reason] ?? 0) + 1;
    } else if (outcome === 'pending' && Date.parse(receipt.dueAt) <= now.getTime()) {
      state = 'unresolved';
      reason = 'forward_return_unavailable';
      summary.unresolvedReasons[reason] = (summary.unresolvedReasons[reason] ?? 0) + 1;
    } else if (outcome === 'pending') {
      state = 'pending';
    } else if (Date.parse(receipt.dueAt) <= now.getTime()) {
      state = 'unresolved';
      reason = 'due_without_score';
      summary.unresolvedReasons[reason] = (summary.unresolvedReasons[reason] ?? 0) + 1;
    } else {
      state = 'pending';
    }
    summary[state]++;
    summary.records.push({
      signalSlug: row.signalSlug,
      claimId: receipt.claimId,
      claimSha256: receipt.claimSha256,
      firstPublishedAt: receipt.firstPublishedAt,
      dueAt: receipt.dueAt,
      resolutionRule: receipt.resolutionRule,
      outcome,
      state,
      reason,
    });
  }
  return summary;
}
