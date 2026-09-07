import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { calendarDate } from './verify-daily-brief-lib.mjs';

const API = 'https://api.highsignal.app';
const MCP = 'https://mcp.highsignal.app/high-signal/mcp';
const INSTALLED_TOOLS = ['get_daily_brief', 'search_signals', 'get_signal', 'get_track_record'];

/** Public consumer contract, independent of the server's current advertised catalog. */
export async function verifyMcpConsumer({ fetchImpl = fetch, now = new Date() } = {}) {
  let id = 0;
  async function read(url, init = {}) {
    const response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(20_000) });
    assert.equal(response.status, 200, `consumer HTTP failure: ${new URL(url).pathname}`);
    const raw = await response.text();
    assert.ok(raw.length < 2_000_000, 'consumer response exceeded bound');
    const data = raw.split(/\r?\n/).find((line) => line.startsWith('data: '));
    return JSON.parse(data ? data.slice(6) : raw);
  }
  async function rpc(method, params) {
    const payload = await read(MCP, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
    });
    assert.ok(!payload.error, `consumer RPC failure: ${method}`);
    assert.ok(payload.result, 'consumer RPC result missing');
    return payload.result;
  }
  async function call(name, args = {}) {
    const result = await rpc('tools/call', { name, arguments: args });
    assert.ok(
      !result.isError && result.structuredContent?.ok === true,
      `consumer tool failed: ${name}`
    );
    assert.equal(result.structuredContent.tool, name);
    return result.structuredContent;
  }
  const catalog = await rpc('tools/list', {});
  for (const name of INSTALLED_TOOLS) {
    assert.ok(
      catalog.tools?.some((tool) => tool.name === name),
      `installed tool missing: ${name}`
    );
  }
  const today = calendarDate(now);
  const days = [today, calendarDate(new Date(now.getTime() - 86_400_000))];
  const receipts = [];
  const slugs = (items) => items.map((item) => item.signalSlug ?? item.slug).sort();
  for (const date of days) {
    const [brief, feed] = await Promise.all([
      read(`${API}/brief/daily?date=${date}`),
      read(`${API}/signals?date=${date}&limit=200`),
    ]);
    assert.equal(brief.editionDate, date, 'brief edition date mismatch');
    assert.notEqual(
      brief.categoryStates?.stocks?.status,
      'unavailable',
      'brief signals unavailable'
    );
    assert.ok(
      Array.isArray(brief.stocks) && Array.isArray(feed.signals),
      'signal collection missing'
    );
    for (const stock of brief.stocks)
      assert.equal(calendarDate(stock.publishedAt), date, 'old signal relabeled');
    assert.deepEqual(
      slugs(brief.stocks),
      slugs(feed.signals),
      `brief/feed membership mismatch: ${date}`
    );
    if (date === today) {
      const consumer = await call('get_daily_brief');
      assert.equal(consumer.item?.editionDate, date, 'MCP edition date mismatch');
      assert.deepEqual(
        slugs(consumer.item.stocks),
        slugs(brief.stocks),
        'MCP/brief membership mismatch'
      );
    }
    receipts.push({ date, signals: feed.signals.length });
  }
  const search = await call('search_signals', { limit: 1, offset: 0 });
  assert.ok(Array.isArray(search.items) && search.items.length <= 1, 'search bound violated');
  if (search.items.length) {
    const signal = await call('get_signal', { slug: search.items[0].slug });
    assert.equal(signal.item?.slug, search.items[0].slug, 'exact signal lookup mismatch');
  }
  const ledger = await call('get_track_record', { limit: 1, offset: 0 });
  assert.ok(Array.isArray(ledger.items) && ledger.items.length <= 1, 'ledger bound violated');
  return {
    ok: true,
    checkedAt: now.toISOString(),
    tools: INSTALLED_TOOLS,
    editions: receipts,
    signalLookup: search.items.length ? 'passed' : 'no_recent_signal',
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(await verifyMcpConsumer()));
}
