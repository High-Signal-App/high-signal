#!/usr/bin/env node

import { resolve } from 'node:path';
import { verifyArchive } from './reddit-archive-maintenance.mjs';

const args = process.argv.slice(2);
const outputDir = resolve(
  args.find((argument) => !argument.startsWith('--')) || 'artifacts/reddit-archive'
);
verifyArchive(outputDir, { verifyLatest: !args.includes('--no-latest') })
  .then((health) => console.log(JSON.stringify({ event: 'reddit_archive_health', ...health })))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
