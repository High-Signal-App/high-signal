import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function validateArchivePointer(pointer, now = Date.now()) {
  if (pointer.status !== 'complete') throw new Error('reddit_archive_not_complete');
  const end = typeof pointer.windowEnd === 'string' ? Date.parse(pointer.windowEnd) : NaN;
  if (!Number.isFinite(end)) throw new Error('reddit_archive_invalid_window_end');
  const age = now - end;
  if (!Number.isFinite(age) || age < 0 || age > 8 * 60 * 60 * 1000) {
    throw new Error(`reddit_archive_stale:${pointer.windowEnd}`);
  }
}

export function publicationPrefix(manifest, runId, attempt, configured) {
  if (!/^[1-9][0-9]*$/.test(runId) || !/^[1-9][0-9]*$/.test(attempt)) {
    throw new Error('invalid_archive_run_identity');
  }
  if (typeof manifest.windowEnd !== 'string' || !Number.isFinite(Date.parse(manifest.windowEnd))) {
    throw new Error('reddit_archive_invalid_window_end');
  }
  if (!Number.isInteger(configured) || configured < 1) throw new Error('invalid_community_count');
  const cohort = manifest.requestedCommunities === configured ? '' : 'canary/';
  return `reddit/v2/${cohort}run=${runId}/attempt=${attempt}/date=${manifest.windowEnd.slice(0, 10)}`;
}

export function redactionPrefix(date, prefix = '') {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(Date.parse(date)) ||
    new Date(date).toISOString().slice(0, 10) !== date
  ) {
    throw new Error('invalid_archive_date');
  }
  const selected = prefix || `reddit/v2/date=${date}`;
  if (
    !/^reddit\/v2\/(?:(?:canary\/)?run=[1-9][0-9]*\/(?:attempt=[1-9][0-9]*\/)?)?date=\d{4}-\d{2}-\d{2}$/.test(
      selected
    ) ||
    !selected.endsWith(`date=${date}`)
  ) {
    throw new Error('invalid_archive_prefix');
  }
  return selected;
}

export function archiveIsLatest(manifest, latest) {
  const prefix = manifest.objectPrefix || `reddit/v2/date=${manifest.windowEnd.slice(0, 10)}`;
  return latest.objects?.manifest === `${prefix}/manifest.json`;
}

export async function preparePublication(directory, runId, attempt, configured) {
  const manifestPath = resolve(directory, 'manifest.json');
  const latestPath = resolve(directory, 'latest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const latest = JSON.parse(await readFile(latestPath, 'utf8'));
  const prefix = publicationPrefix(manifest, runId, attempt, configured);
  manifest.objectPrefix = prefix;
  latest.objects = {
    events: `${prefix}/events.jsonl.zst`,
    index: `${prefix}/subreddits.index.json`,
    manifest: `${prefix}/manifest.json`,
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(latestPath, `${JSON.stringify(latest, null, 2)}\n`);
  return prefix;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [command, path, ...args] = process.argv.slice(2);
  if (command === 'validate') {
    validateArchivePointer(JSON.parse(await readFile(path, 'utf8')));
  } else if (command === 'redaction-prefix') {
    console.log(redactionPrefix(path, args[0]));
  } else if (command === 'verify-target') {
    const manifest = JSON.parse(await readFile(resolve(path, 'manifest.json'), 'utf8'));
    if (
      (manifest.objectPrefix || `reddit/v2/date=${manifest.windowEnd.slice(0, 10)}`) !== args[0]
    ) {
      throw new Error('archive_target_mismatch');
    }
  } else if (command === 'is-latest') {
    const manifest = JSON.parse(await readFile(resolve(path, 'manifest.json'), 'utf8'));
    const latest = JSON.parse(await readFile(resolve(path, 'latest.json'), 'utf8'));
    console.log(archiveIsLatest(manifest, latest));
  } else if (command === 'prepare') {
    console.log(await preparePublication(path, args[0], args[1], Number(args[2])));
  } else {
    throw new Error('unknown_archive_publication_command');
  }
}
