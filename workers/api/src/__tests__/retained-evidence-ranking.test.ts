import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { retainedEvidenceCandidates } from '../lib/attention-admin';

function binding(database: DatabaseSync) {
  return {
    prepare(sql: string) {
      return {
        bind(...args: Array<string | number>) {
          return {
            async all() {
              return { results: database.prepare(sql).all(...args) };
            },
          };
        },
      };
    },
  } as unknown as D1Database;
}

describe('retained evidence ranking against SQLite', () => {
  it('keeps an older multi-token report ahead of more than 50 fresh broad matches', async () => {
    const database = new DatabaseSync(':memory:');
    try {
      database.exec(
        'CREATE TABLE events (source_url TEXT, title TEXT, content TEXT, published_at INTEGER, source TEXT)'
      );
      const insert = database.prepare('INSERT INTO events VALUES (?, ?, ?, ?, ?)');
      const now = Math.floor(Date.now() / 1000);
      const text = 'Retained article body. '.repeat(40);
      for (let i = 0; i < 60; i++) {
        insert.run(
          `https://noise.example/${i}`,
          'Markets hit a new high',
          text,
          now - i,
          'news:noise'
        );
      }
      const title =
        'Intel surpasses one million High-NA EUV wafers, outpaces the rest of the industry';
      insert.run('https://reporter.example/milestone', title, text, now - 86400, 'news:reporter');
      const query =
        'Intel Foundry and ASML Collaborate to Accelerate Industry Readiness for High-NA EUV';
      for (const [url, timestamp, source, content] of [
        ['old', now - 4 * 86400, 'news:reporter', text],
        ['future', now + 86400, 'news:reporter', text],
        ['excluded', now - 100, 'market:prediction', text],
        ['thin', now - 100, 'news:reporter', 'short'],
      ] as const) {
        insert.run(`https://invalid.example/${url}`, query, content, timestamp, source);
      }
      const rows = await retainedEvidenceCandidates(binding(database), query, now, ['market:%']);
      expect(rows).toHaveLength(50);
      expect(rows[0]).toMatchObject({
        url: 'https://reporter.example/milestone',
        title,
        retainedContent: text,
        retainedSource: 'news:reporter',
      });
      expect(rows.some((row) => row.url.includes('invalid.example'))).toBe(false);
    } finally {
      database.close();
    }
  });
});
