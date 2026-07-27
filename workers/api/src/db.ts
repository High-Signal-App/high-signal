import { drizzle } from 'drizzle-orm/d1';
import * as schema from '@high-signal/db';

export type DB = ReturnType<typeof drizzle<typeof schema>>;

export function db(d1: D1Database): DB {
  return drizzle(d1, { schema });
}

export { schema };
