import { test } from 'node:test';
import assert from 'node:assert/strict';
import { researchCommunityBrief } from './research-community-brief.mjs';

test('research uses bounded round-robin retained leads through the protected operator API', async () => {
  const attempts = [];
  const communities = ['a', 'b', 'c', 'd'].map((id) => ({
    id,
    leads: [0, 1, 2].map((i) => ({ id: `${id}${i}` })),
  }));
  const counts = await researchCommunityBrief({
    api: 'https://api.example.org/',
    token: 'test-only',
    fetchImpl: async (url, init) => {
      assert.equal(init.headers.Authorization, 'Bearer test-only');
      if (url.endsWith('/initialize')) return Response.json({ ok: true });
      if (init.method === 'GET') return Response.json({ communities });
      attempts.push(JSON.parse(init.body));
      return Response.json({ status: attempts.length === 1 ? 'published' : 'withheld' });
    },
  });
  assert.deepEqual(counts, { published: 1, already_published: 0, withheld: 5 });
  assert.deepEqual(
    attempts.map((row) => row.leadId),
    ['a0', 'b0', 'c0', 'd0', 'a1', 'b1']
  );
});

test('empty evidence is quiet; transport/model failure remains an explicit failed operation', async () => {
  assert.deepEqual(
    await researchCommunityBrief({
      api: 'https://api.example.org',
      token: 'test-only',
      fetchImpl: async () => Response.json({ communities: [] }),
    }),
    { published: 0, already_published: 0, withheld: 0 }
  );
  await assert.rejects(
    () =>
      researchCommunityBrief({
        api: 'https://api.example.org',
        token: 'test-only',
        fetchImpl: async () => new Response('{}', { status: 503 }),
      }),
    /unavailable/
  );
  let calls = 0;
  await assert.rejects(
    () =>
      researchCommunityBrief({
        api: 'https://api.example.org',
        token: 'test-only',
        fetchImpl: async () => {
          calls++;
          if (calls === 1) return Response.json({ ok: true });
          if (calls === 2)
            return Response.json({ communities: [{ id: 'a', leads: [{ id: 'a0' }] }] });
          return Response.json({ status: 'unavailable', reason: 'invalid_model_response' });
        },
      }),
    /invalid_model_response/
  );
});

test('one unavailable lead does not starve the other bounded research attempts', async () => {
  let attempts = 0;
  await assert.rejects(
    () =>
      researchCommunityBrief({
        api: 'https://api.example.org',
        token: 'test-only',
        fetchImpl: async (url, init) => {
          if (url.endsWith('/initialize')) return Response.json({ ok: true });
          if (init.method === 'GET')
            return Response.json({
              communities: [
                { id: 'a', leads: [{ id: 'a0' }] },
                { id: 'b', leads: [{ id: 'b0' }] },
              ],
            });
          attempts++;
          return attempts === 1
            ? Response.json(
                { status: 'unavailable', reason: 'invalid_model_response' },
                { status: 503 }
              )
            : Response.json({ status: 'published' });
        },
      }),
    /invalid_model_response.*"published":1/
  );
  assert.equal(attempts, 2);
});
