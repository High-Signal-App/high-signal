import { createAppHealthClient, type AppHealthClient, type LogInput } from '@saas-maker/app-health';

type PingLevel = 'debug' | 'info' | 'warn' | 'error';
type PingScalar = string | number | boolean | null | undefined;
interface PingOptions extends Omit<LogInput, 'level' | 'props'> {
  level?: PingLevel;
  props?: Record<string, PingScalar>;
}
export interface PingConfig {
  key?: string;
  environment?: string;
  endpoint?: string;
  release?: string;
}
export interface PingFn {
  (event: string, options?: PingOptions): Promise<boolean>;
  debug: (event: string, options?: Omit<PingOptions, 'level'>) => Promise<boolean>;
  info: (event: string, options?: Omit<PingOptions, 'level'>) => Promise<boolean>;
  warn: (event: string, options?: Omit<PingOptions, 'level'>) => Promise<boolean>;
  error: (event: string, options?: Omit<PingOptions, 'level'>) => Promise<boolean>;
}

const DEFAULT_ENDPOINT = 'https://ingest.sassmaker.com/v1/ingest';

function readEnv(name: string): string | undefined {
  return (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.[
    name
  ];
}

function clientFor(config: PingConfig): AppHealthClient | null {
  const key = config.key ?? readEnv('APP_HEALTH_INGEST_KEY');
  if (!key) return null;
  const endpoint = config.endpoint ?? readEnv('APP_HEALTH_INGEST_URL') ?? DEFAULT_ENDPOINT;
  const environment = config.environment ?? readEnv('APP_HEALTH_ENVIRONMENT') ?? 'production';
  const release = config.release ?? readEnv('APP_HEALTH_RELEASE');
  try {
    return createAppHealthClient({
      key,
      endpoint,
      environment,
      release,
      runtime: 'worker',
      disableTimer: true,
      maxBatchSize: 2,
      maxQueueSize: 2,
      maxRetries: 0,
      requestTimeoutMs: 1_000,
    });
  } catch {
    return null;
  }
}

export function createPing(config: PingConfig = {}): PingFn {
  const send = async (event: string, options: PingOptions = {}): Promise<boolean> => {
    const client = clientFor(config);
    if (!client) return false;
    try {
      client.log(event, options as LogInput);
      await client.flush();
      return true;
    } catch {
      return false;
    }
  };
  const withLevel =
    (level: PingLevel) =>
    (event: string, options: Omit<PingOptions, 'level'> = {}) =>
      send(event, { ...options, level });
  return Object.assign(send, {
    debug: withLevel('debug'),
    info: withLevel('info'),
    warn: withLevel('warn'),
    error: withLevel('error'),
  });
}

export const ping: PingFn = createPing();
