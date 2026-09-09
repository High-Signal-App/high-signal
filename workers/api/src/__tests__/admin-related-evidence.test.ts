import { beforeEach, expect, it, vi } from 'vitest';
import { adminRoute } from '../routes/admin';
import { retainedEvidenceCandidates } from '../lib/attention-admin';

vi.mock('../lib/attention-admin', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/attention-admin')>()),
  retainedEvidenceCandidates: vi.fn(),
}));
const lookup = vi.mocked(retainedEvidenceCandidates);
const env = { DB: {} as D1Database, ADMIN_TOKEN: 'test-token' };
const title = 'Issuer and partner announce a new semiconductor manufacturing collaboration';
const request = (body: unknown, authorized = true) =>
  adminRoute.request(
    '/evidence/related',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authorized ? { Authorization: 'Bearer test-token' } : {}),
      },
      body: JSON.stringify(body),
    },
    env
  );
beforeEach(() => vi.clearAllMocks());
it('keeps the corpus lookup behind admin authentication', async () => {
  expect((await request({ title }, false)).status).toBe(401);
  expect(lookup).not.toHaveBeenCalled();
});
it('rejects malformed titles before querying', async () => {
  for (const value of ['', 'short', 23, 'x'.repeat(401)])
    expect((await request({ title: value })).status).toBe(400);
  expect(lookup).not.toHaveBeenCalled();
});
it('preserves retained source and dates without publication credit', async () => {
  const evidence = [
    {
      url: 'https://source.example/report',
      title,
      retainedContent: 'Source text',
      retainedSource: 'news:publisher',
      seendate: '2026-09-08T12:00:00Z',
    },
  ];
  lookup.mockResolvedValue(evidence);
  const response = await request({ title });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ evidence });
  expect(lookup.mock.calls[0][3]).toContain('market:%');
});
it('reports lookup outages separately from a successful empty result', async () => {
  lookup.mockRejectedValueOnce(new Error('database unavailable'));
  expect((await request({ title })).status).toBe(503);
  lookup.mockResolvedValueOnce([]);
  expect(await (await request({ title })).json()).toEqual({ evidence: [] });
});
