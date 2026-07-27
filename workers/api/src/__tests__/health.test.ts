import { describe, it, expect } from 'vitest';
import app from '../index';

describe('api', () => {
  it('health returns ok', async () => {
    const res = await (app as unknown as { fetch: typeof fetch }).fetch(
      new Request('http://test/health')
    );
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });
});
