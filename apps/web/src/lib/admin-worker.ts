/**
 * Server-side forwarder to the API worker's /admin/* routes.
 *
 * Callers must have already verified the operator session. This is the only
 * place ADMIN_TOKEN is read, and it never leaves the server: both the
 * /api/admin/[...path] proxy (for browser fetches) and server actions
 * (for form posts) go through here.
 */

async function cloudflareBindings() {
  const mod = await import('@opennextjs/cloudflare');
  const cfctx = (
    mod as unknown as {
      getCloudflareContext?: (...args: unknown[]) => { env?: Record<string, unknown> };
    }
  ).getCloudflareContext?.();
  return {
    api: cfctx?.env?.['API'] as { fetch?: typeof fetch } | undefined,
    token: (cfctx?.env?.['ADMIN_TOKEN'] as string | undefined) ?? '',
  };
}

export interface AdminWorkerResult {
  ok: boolean;
  status: number;
  contentType: string;
  body: ReadableStream<Uint8Array> | null;
}

/**
 * Forward a request to `/admin/<path>` on the service-bound worker with the
 * bearer token attached. `path` must NOT include the leading `/admin`.
 */
export async function forwardToAdminWorker(
  path: string,
  init: { method: string; contentType?: string | null; body?: BodyInit | null } = {
    method: 'GET',
  }
): Promise<AdminWorkerResult> {
  const { api, token } = await cloudflareBindings();
  if (!api?.fetch || !token) {
    return { ok: false, status: 500, contentType: 'application/json', body: null };
  }

  const headers = new Headers();
  headers.set('Authorization', `Bearer ${token}`);
  if (init.contentType) headers.set('Content-Type', init.contentType);
  // Trace actor. There is exactly one operator, and the browser cannot spoof
  // this because callers set it only after verifying the session cookie.
  headers.set('X-Admin-Email', 'operator');

  const response = await api.fetch(`https://api/admin/${path.replace(/^\/+/, '')}`, {
    method: init.method,
    headers,
    body: init.body ?? undefined,
  });

  return {
    ok: response.ok,
    status: response.status,
    contentType: response.headers.get('content-type') ?? 'application/json',
    body: response.body,
  };
}

/** JSON convenience wrapper for server actions. Throws on a non-2xx response. */
export async function adminWorkerJson<T>(
  path: string,
  init: { method?: string; json?: unknown } = {}
): Promise<T> {
  const method = init.method ?? 'GET';
  const hasBody = init.json !== undefined && method !== 'GET' && method !== 'HEAD';
  const { api, token } = await cloudflareBindings();
  if (!api?.fetch || !token) throw new Error('admin_worker_unavailable');

  const headers = new Headers({ Authorization: `Bearer ${token}`, 'X-Admin-Email': 'operator' });
  if (hasBody) headers.set('Content-Type', 'application/json');

  const response = await api.fetch(`https://api/admin/${path.replace(/^\/+/, '')}`, {
    method,
    headers,
    body: hasBody ? JSON.stringify(init.json) : undefined,
  });
  if (!response.ok) throw new Error(`admin_worker_${response.status}`);
  return (await response.json()) as T;
}
