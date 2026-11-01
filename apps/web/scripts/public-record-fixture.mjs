export function recordFixture(id) {
  const index = Number(id.match(/\d+$/)?.[0] ?? 0);
  return {
    id,
    source: 'fixture:public-record',
    family: 'fixture',
    url: `https://example.com/evidence/${encodeURIComponent(id)}`,
    canonicalUrl: `https://example.com/canonical/${encodeURIComponent(id)}`,
    title: `Retained evidence ${id}`,
    content: `Original extract for ${id}.`,
    retainedText: (`Retained evidence for ${id}.\n` + 'Source-linked evidence. '.repeat(16))
      .repeat(30)
      .slice(0, 12_000),
    retainedTextTruncated: true,
    entity: 'fixture-entity',
    entityName: 'Fixture Entity',
    publishedAt: 1_793_404_800 + index,
    ingestedAt: 1_793_404_900 + index,
    documentFetchedAt: 1_793_404_950 + index,
    available: true,
  };
}

export function recordFixtureApi(calls) {
  return async (request) => {
    const url = new URL(request.url);
    calls.push({
      method: request.method,
      path: url.pathname,
      search: url.search,
      cookie: request.headers.get('cookie'),
      authorization: request.headers.get('authorization'),
      access: request.headers.get('cf-access-jwt-assertion'),
    });
    const match = url.pathname.match(/^\/data\/records\/([^/]+)$/);
    if (!match) return Response.json({ available: false }, { status: 503 });
    const id = decodeURIComponent(match[1]);
    if (id === 'missing') return Response.json({ error: 'not_found', id }, { status: 404 });
    if (id === 'unavailable') return Response.json({ id, available: false });
    return Response.json(recordFixture(id), {
      headers: { 'Cache-Control': 'public, max-age=60, s-maxage=300' },
    });
  };
}
