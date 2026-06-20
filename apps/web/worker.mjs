// worker.mjs — wraps OpenNext; anon GET / serves the Astro landing from ASSETS.

import openNext from "./.open-next/worker.js";

export {
  DOQueueHandler,
  DOShardedTagCache,
  BucketCachePurge,
} from "./.open-next/worker.js";

const CACHE_PATH = "/";
const CACHE_CONTROL =
  "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800";

const AUTH_COOKIE_FRAGMENTS = [
  "__session",
  "__client",
  "__clerk",
  "session_token",
  "session-token",
];

function hasAuthCookie(request) {
  const cookie = request.headers.get("cookie");
  if (!cookie) return false;
  return AUTH_COOKIE_FRAGMENTS.some((c) => cookie.includes(c));
}

const worker = {
  async fetch(request, env, ctx) {
    if (request.method !== "GET") {
      return openNext.fetch(request, env, ctx);
    }
    const url = new URL(request.url);
    if (url.pathname !== CACHE_PATH) {
      return openNext.fetch(request, env, ctx);
    }
    if (hasAuthCookie(request)) {
      return openNext.fetch(request, env, ctx);
    }

    if (env.ASSETS) {
      const assetResp = await env.ASSETS.fetch(request);
      if (assetResp.status === 304) {
        const headers = new Headers(assetResp.headers);
        headers.set("Cache-Control", CACHE_CONTROL);
        headers.set("x-edge-cache", "ASSET");
        return new Response(null, { status: 304, headers });
      }
      if (assetResp.ok && assetResp.body) {
        const acceptEnc = request.headers.get("accept-encoding") ?? "";
        const wantsGzip = acceptEnc.includes("gzip");
        const headers = new Headers(assetResp.headers);
        headers.set("Cache-Control", CACHE_CONTROL);
        headers.set("x-edge-cache", "ASSET");

        if (wantsGzip && !headers.has("content-encoding")) {
          headers.set("content-encoding", "gzip");
          headers.delete("content-length");
          const vary = headers.get("vary");
          headers.set(
            "vary",
            vary ? `${vary}, Accept-Encoding` : "Accept-Encoding",
          );
          return new Response(
            assetResp.body.pipeThrough(new CompressionStream("gzip")),
            {
              status: assetResp.status,
              statusText: assetResp.statusText,
              headers,
              encodeBody: "manual",
            },
          );
        }

        return new Response(assetResp.body, {
          status: assetResp.status,
          statusText: assetResp.statusText,
          headers,
        });
      }
    }

    const cache = caches.default;
    const cached = await cache.match(request);
    if (cached) {
      const hit = new Response(cached.body, cached);
      hit.headers.set("x-edge-cache", "HIT");
      return hit;
    }

    const response = await openNext.fetch(request, env, ctx);
    const contentType = response.headers.get("content-type") ?? "";
    if (response.status !== 200 || !contentType.includes("text/html")) {
      return response;
    }

    const body = await response.arrayBuffer();
    const headers = new Headers(response.headers);
    headers.set("Cache-Control", CACHE_CONTROL);

    const cacheable = new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
    ctx.waitUntil(cache.put(request, cacheable.clone()));

    const clientResponse = new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
    clientResponse.headers.set("x-edge-cache", "MISS");
    return clientResponse;
  },
};

export default worker;