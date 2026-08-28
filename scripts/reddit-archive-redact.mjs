#!/usr/bin/env node

import { resolve } from 'node:path';
import { redactArchive } from './reddit-archive-maintenance.mjs';

const allowedReasons = new Set(['reddit_user_deletion', 'reddit_protected', 'legal']);
const outputDir = resolve(process.env.REDDIT_ARCHIVE_DIR || 'artifacts/reddit-archive-redaction');
const postIds = new Set((process.env.REDDIT_REDACT_POST_IDS || '').split(',').filter(Boolean));
const commentIds = new Set(
  (process.env.REDDIT_REDACT_COMMENT_IDS || '').split(',').filter(Boolean)
);
const reasonCode = process.env.REDDIT_REDACT_REASON_CODE || '';

if (postIds.size + commentIds.size === 0) throw new Error('redaction_ids_required');
if (!allowedReasons.has(reasonCode)) throw new Error('invalid_redaction_reason_code');

redactArchive(outputDir, { postIds, commentIds, reasonCode })
  .then((receipt) =>
    console.log(
      JSON.stringify({
        event: 'reddit_archive_redacted',
        redactedPosts: receipt.redactedPosts,
        redactedComments: receipt.redactedComments,
        removedEvents: receipt.removedEvents,
      })
    )
  )
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
