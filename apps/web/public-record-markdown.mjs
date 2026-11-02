import { handleCachedRenderedMarkdown, resolvePublicMarkdownTarget } from './agent-edge.mjs';
import { publicRecordDocument, publicRecordId } from './public-record-document.mjs';
import { hasAuthCookie } from './worker-cache-policy.mjs';

export async function handlePublicRecordMarkdown(request, env, ctx, { cache, cacheBuildId } = {}) {
  const target = resolvePublicMarkdownTarget(request);
  if (!target || !/^\/data\/records\/[^/]+$/.test(target.publicPath)) return null;
  return handleCachedRenderedMarkdown(
    request,
    async () => {
      const id = publicRecordId(target.publicPath);
      if (!id) return Response.json({ error: 'not_found' }, { status: 404 });
      if (!env?.API) return Response.json({ error: 'source_unavailable' }, { status: 503 });
      const response = await env.API.fetch(
        new Request(`https://api/data/records/${encodeURIComponent(id)}`, {
          headers: { Accept: 'application/json' },
        })
      );
      if (response.status === 404) return Response.json({ error: 'not_found' }, { status: 404 });
      if (
        !response.ok ||
        !(response.headers.get('content-type') ?? '').includes('application/json')
      )
        return Response.json({ error: 'source_unavailable' }, { status: 503 });
      return Response.json(await publicRecordDocument(target.publicPath, await response.json()));
    },
    {
      cache,
      cacheBuildId,
      cacheEnabled:
        !request.headers.has('authorization') &&
        !request.headers.has('cf-access-jwt-assertion') &&
        !hasAuthCookie(request),
      waitUntil: (promise) => ctx.waitUntil(promise),
    }
  );
}
