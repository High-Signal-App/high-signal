import { createStaticAssetHandler } from './agent-surfaces/adapters/static-assets.mjs';
import { discoveryLinkHeader } from './agent-surfaces/handler.mjs';
import { SITE_IDENTITY, SITE_URL } from './src/lib/site.ts';
const handler = createStaticAssetHandler({
  origin: SITE_URL,
  identity: SITE_IDENTITY,
  catalogPath: '/api/md/_docs',
});
const registries = new WeakMap();
export async function publicDocsRoutes(assets) {
  if (!assets?.fetch) throw new Error('Public docs assets unavailable');
  let value = registries.get(assets);
  if (!value) {
    value = assets
      .fetch(new Request(SITE_URL + '/api/md/_docs'))
      .then(async (response) => {
        const type = response.headers.get('content-type') ?? '';
        if (
          !response.ok ||
          (type && !/^(?:application\/(?:json|octet-stream)|text\/plain)(?:;|$)/i.test(type))
        )
          throw new Error('Public docs registry unavailable');
        const routes = await response.json();
        if (
          !Array.isArray(routes) ||
          routes.some(
            (route) => !/^\/docs(?:\/|$)/.test(route.path) || new URL(route.url).origin !== SITE_URL
          )
        )
          throw new Error('Invalid public docs registry');
        return routes;
      })
      .catch((error) => {
        registries.delete(assets);
        throw error;
      });
    registries.set(assets, value);
  }
  return value;
}
export async function handlePublicDocs(request, assets) {
  const path = new URL(request.url).pathname;
  if (!/^\/(?:docs(?:\/|\.md$|$)|api\/md\/docs(?:\/|$))/.test(path)) return null;
  const markdown = await handler(request, assets);
  if (markdown) return markdown;
  if (!assets?.fetch) return null;
  const response = await assets.fetch(request);
  if (!(response.headers.get('content-type') ?? '').includes('text/html')) return response;
  const headers = new Headers(response.headers);
  headers.append('Link', discoveryLinkHeader(SITE_URL));
  const vary = headers.get('Vary');
  if (vary !== '*' && !vary?.split(',').some((value) => value.trim().toLowerCase() === 'accept'))
    headers.set('Vary', vary ? vary + ', Accept' : 'Accept');
  return new Response(request.method === 'HEAD' ? null : response.body, {
    status: response.status,
    headers,
  });
}
