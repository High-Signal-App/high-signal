/**
 * Minimal ambient declarations for the Node built-ins the SQLite-backed test
 * harness uses.
 *
 * `workers/api/tsconfig.json` deliberately loads only `@cloudflare/workers-types`
 * so that Node-only globals cannot leak into Worker source and typecheck by
 * accident. Pulling in `@types/node` to satisfy one test helper would give that
 * protection up for the whole package, so the handful of APIs the helper needs
 * are declared here instead, and referenced only from `test/sqlite-d1.ts`.
 */

declare module 'node:sqlite' {
  export class StatementSync {
    all(...params: unknown[]): unknown[];
    run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  }
  export class DatabaseSync {
    constructor(path: string);
    prepare(sql: string): StatementSync;
    exec(sql: string): void;
    close(): void;
  }
}

declare module 'node:fs' {
  export function readdirSync(path: string): string[];
  export function readFileSync(path: string, encoding: 'utf8'): string;
}

declare module 'node:path' {
  export function dirname(path: string): string;
  export function join(...segments: string[]): string;
}

declare module 'node:url' {
  export function fileURLToPath(url: string): string;
}
