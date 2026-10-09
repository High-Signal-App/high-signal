interface HealthClient<Event, Log> {
  record(event: Event): void;
  log(event: string, input?: Log): void;
  flush(): Promise<void>;
}
export function createWorkerHealthBuffer<Options, Event extends { timestamp?: unknown }, Log>(
  createClient: (options: Options) => HealthClient<Event, Log>,
  settings?: { delayMs?: number; batchSize?: number }
): { client(env: object, options: Options): HealthClient<Event, Log> };
