/** Coarse request classification, never a human-identity or bot-proof claim. */
export type TrafficClass = 'verified_bot' | 'declared_bot' | 'automation' | 'unknown';

type BotMetadata = { verifiedBot?: boolean };

export function classifyTraffic(request: Request): TrafficClass {
  const cf = (request as Request & { cf?: { botManagement?: BotMetadata } }).cf;
  if (cf?.botManagement?.verifiedBot === true) return 'verified_bot';
  return classifyUserAgent(request.headers.get('user-agent') ?? '');
}

export function classifyUserAgent(agent: string): Exclude<TrafficClass, 'verified_bot'> {
  if (
    /bot\b|crawler|spider|slurp|facebookexternalhit|GPTBot|ClaudeBot|PerplexityBot|ChatGPT-User/i.test(
      agent
    )
  )
    return 'declared_bot';
  if (
    /curl\/|wget\/|python-requests|python-httpx|HeadlessChrome|Go-http-client|node-fetch|undici/i.test(
      agent
    )
  )
    return 'automation';
  return 'unknown';
}

export interface TrafficSummary {
  verified_bot: number;
  declared_bot: number;
  automation: number;
  unknown: number;
  requests: number;
  window_ms: number;
}

/**
 * At most one summary per minute per active isolate; no storage or idle timer.
 * The first request is reported immediately; later requests flush accumulated
 * counts once a minute. Idle/terminated isolates may lose a partial window: these are observed
 * traffic samples, not exact site totals. Raw user agents and IPs are not kept.
 */
export function createTrafficSummary(now: () => number = Date.now) {
  let started: number | null = null;
  let counts = { verified_bot: 0, declared_bot: 0, automation: 0, unknown: 0, requests: 0 };
  return (request: Request): TrafficSummary | null => {
    const time = now();
    const first = started === null;
    started ??= time;
    counts[classifyTraffic(request)] += 1;
    counts.requests += 1;
    if (!first && time - started < 60_000) return null;
    const summary = { ...counts, window_ms: time - started };
    started = time;
    counts = { verified_bot: 0, declared_bot: 0, automation: 0, unknown: 0, requests: 0 };
    return summary;
  };
}
