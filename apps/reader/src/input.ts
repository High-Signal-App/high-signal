import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { BriefSnapshot } from '@high-signal/shared';

export interface ReaderBriefInput {
  capturedAt: string;
  editionDay: string;
  entries: Array<{ day: 'today' | 'yesterday'; brief: BriefSnapshot }>;
}
// Build chunks have a different import.meta.url; source inputs belong to the project root.
const filename = process.env['READER_BRIEF_INPUT'] ?? resolve('.generated/brief-input.json');
export const briefInput: ReaderBriefInput | null =
  process.env['READER_BUILD_MODE'] !== 'profiles' && existsSync(filename)
    ? JSON.parse(readFileSync(filename, 'utf8'))
    : null;
