import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import type { BriefSnapshot } from '@high-signal/shared';
import type { ReaderBriefInput } from '../src/input';

// The existing shared/Web packages are CommonJS; use their native build-time boundary.
const require = createRequire(import.meta.url);
const { REGIONS, istDay } = require('@high-signal/shared') as typeof import('@high-signal/shared');
const { resolveCurrentBrief } =
  require('../../web/src/lib/current-brief') as typeof import('../../web/src/lib/current-brief');

export async function captureBrief(apiBase: string, now = new Date()): Promise<ReaderBriefInput> {
  async function read<T>(path: string): Promise<T> {
    const response = await fetch(new URL(path, apiBase), {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'HighSignal-reader-publisher/1 (undici)',
      },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok)
      throw Object.assign(new Error(`Reader source returned ${response.status}`), {
        status: response.status,
      });
    return response.json() as Promise<T>;
  }
  let dateIndex: Promise<{ dates: Array<{ date: string }> }> | undefined;
  const reader = {
    brief: ({ region, date }: { region: string; date: string }) =>
      // Current editions use the existing shared API/KV path, as MCP does.
      // Only yesterday and archive fallback reads need an explicit date.
      read<BriefSnapshot>(
        `/brief/daily?${new URLSearchParams({ region, ...(date === istDay(now) ? {} : { date }) })}`
      ),
    briefDates: () => (dateIndex ??= read('/brief/dates')),
  };
  const entries: ReaderBriefInput['entries'] = [];
  // Keep public reads bounded; preserve the same qualification and fallback rules.
  for (const region of REGIONS) {
    for (const day of ['today', 'yesterday'] as const) {
      const brief = await resolveCurrentBrief(reader, region, day, now);
      if (brief.editionDate !== istDay(now) && brief.editionDate !== istDay(now, -1)) {
        throw new Error('Protected history cannot enter a reader publication');
      }
      entries.push({ day, brief });
    }
  }
  return { capturedAt: now.toISOString(), editionDay: istDay(now), entries };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const directory = fileURLToPath(new URL('../.generated/', import.meta.url));
  await mkdir(directory, { recursive: true });
  const input = await captureBrief(process.env['READER_API_URL'] ?? 'https://api.highsignal.app');
  if (
    input.entries.some(
      ({ day, brief }) =>
        day === 'today' &&
        brief.region === 'global' &&
        brief.categoryStates?.stocks.status === 'unavailable'
    )
  )
    throw new Error(
      'Current brief source is unavailable; keep the previous publication and renderer fallback'
    );
  await writeFile(`${directory}/brief-input.json`, `${JSON.stringify(input)}\n`);
  console.log(`Captured ${input.entries.length} public reader variants for ${input.editionDay}.`);
}
