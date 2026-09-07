import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyMcpConsumer } from './verify-mcp-consumer.mjs';

const now = new Date('2026-09-07T06:00:00Z');
const names = ['get_daily_brief', 'search_signals', 'get_signal', 'get_track_record'];
function fixture({
  missingTool = false,
  mismatch = false,
  unavailable = false,
  brokenTool = false,
} = {}) {
  return async (input, init) => {
    const url = new URL(input);
    const date = url.searchParams.get('date') ?? '2026-09-07';
    const brief = {
      editionDate: date,
      stocks: [{ signalSlug: date, publishedAt: `${date}T03:30:00Z` }],
      categoryStates: { stocks: { status: unavailable ? 'unavailable' : 'ready' } },
    };
    if (url.pathname === '/brief/daily') return Response.json(brief);
    if (url.pathname === '/signals')
      return Response.json({ signals: mismatch ? [] : [{ slug: date }] });
    const request = JSON.parse(init.body);
    if (request.method === 'tools/list')
      return Response.json({
        result: { tools: (missingTool ? names.slice(1) : names).map((name) => ({ name })) },
      });
    const name = request.params.name;
    const data =
      name === 'get_daily_brief'
        ? { item: brief }
        : name === 'get_signal'
          ? { item: { slug: request.params.arguments.slug } }
          : name === 'search_signals'
            ? { items: [{ slug: '2026-09-07' }] }
            : { items: [{ hit: 2, miss: 1 }] };
    return Response.json({
      result: { isError: brokenTool, structuredContent: { ok: !brokenTool, tool: name, ...data } },
    });
  };
}

test('checks both IST days and all installed methods', async () => {
  const result = await verifyMcpConsumer({ fetchImpl: fixture(), now });
  assert.deepEqual(result.editions, [
    { date: '2026-09-07', signals: 1 },
    { date: '2026-09-06', signals: 1 },
  ]);
  assert.equal(result.signalLookup, 'passed');
});
for (const [option, message] of [
  ['missingTool', /installed tool missing/],
  ['mismatch', /membership mismatch/],
  ['unavailable', /signals unavailable/],
  ['brokenTool', /consumer tool failed/],
]) {
  test(`rejects ${option}`, async () => {
    await assert.rejects(
      verifyMcpConsumer({ fetchImpl: fixture({ [option]: true }), now }),
      message
    );
  });
}
