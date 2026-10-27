import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const WEB_ROOT = fileURLToPath(new URL('..', import.meta.url));

/** Real deploy bundle, workerd, Static Assets and local R2. No remote resources. */
export async function createReaderRuntime(webRoot = WEB_ROOT, storage = undefined) {
  const directory = mkdtempSync(join(tmpdir(), 'high-signal-reader-bundle-'));
  execFileSync('pnpm', ['exec', 'wrangler', 'deploy', '--dry-run', '--outdir', directory], {
    cwd: webRoot,
    env: { ...process.env, OPEN_NEXT_DEPLOY: 'true' },
    stdio: 'pipe',
  });
  const require = createRequire(resolve(webRoot, 'package.json'));
  const { Miniflare, convertV4MiniflareOptions, kCurrentWorker } = createRequire(
    require.resolve('wrangler')
  )('miniflare');
  // The entry must precede binary modules in Miniflare's module manifest.
  const files = [
    'worker.js',
    ...readdirSync(directory).filter((name) => /\.(wasm|bin)$/.test(name)),
  ];
  const modules = files.map((name) => ({
    type: name.endsWith('.wasm') ? 'CompiledWasm' : name.endsWith('.bin') ? 'Data' : 'ESModule',
    path: join(directory, name),
    contents: readFileSync(join(directory, name)),
  }));
  return new Miniflare(
    convertV4MiniflareOptions({
      name: 'reader',
      modules,
      modulesRoot: directory,
      compatibilityDate: '2024-09-23',
      compatibilityFlags: ['nodejs_compat'],
      assets: {
        directory: resolve(webRoot, '.open-next/assets'),
        binding: 'ASSETS',
        run_worker_first: ['/*', '!/_astro/*', '!/_next/static/*', '!/favicon.svg'],
        routerConfig: { has_user_worker: true },
      },
      r2Buckets: ['NEXT_INC_CACHE_R2_BUCKET'],
      resourcePersistencePath: storage,
      isolatedResourcePersistencePath: storage,
      durableObjects: {
        NEXT_CACHE_DO_QUEUE: { className: 'DOQueueHandler', useSQLite: true },
        NEXT_TAG_CACHE_DO_SHARDED: { className: 'DOShardedTagCache', useSQLite: true },
      },
      // Local fallback checks deliberately simulate unavailable public API data.
      // Known artifact profiles and published brief checks use real compiled bytes.
      serviceBindings: {
        WORKER_SELF_REFERENCE: kCurrentWorker,
        API: async (request) =>
          new Response('unavailable', {
            status: new URL(request.url).pathname.startsWith('/case-studies/') ? 404 : 503,
          }),
      },
      outboundService: () =>
        new Response('External services disabled in runtime checks', { status: 503 }),
      bindings: { NODE_ENV: 'production', NEXT_PUBLIC_API_BASE: 'https://api.highsignal.app' },
    })
  );
}

export async function seedReaderBrief(mf, directory) {
  const manifest = JSON.parse(readFileSync(resolve(directory, 'reader-manifest.json'), 'utf8'));
  if (manifest.briefs.length !== 20) throw new Error('Compile all twenty brief variants first');
  const bucket = await mf.getR2Bucket('NEXT_INC_CACHE_R2_BUCKET');
  const briefs = [];
  for (const { day, region, html, markdown } of manifest.briefs) {
    const key = `reader/v1/slots/0/${day}/${region}.html`;
    await bucket.put(key, readFileSync(resolve(directory, 'reader-artifacts', html.path)));
    const markdownKey = `reader/v1/slots/0/${day}/${region}.md`;
    await bucket.put(
      markdownKey,
      readFileSync(resolve(directory, 'reader-artifacts', markdown.path))
    );
    briefs.push({
      day,
      region,
      html: { ...html, key },
      markdown: { ...markdown, key: markdownKey },
    });
  }
  // Test fixture freshness is measured at local publication, not compiler start.
  const pointer = {
    schema: 1,
    source: manifest.source,
    slot: 0,
    capturedAt: new Date().toISOString(),
    editionDay: manifest.editionDay,
    briefs,
  };
  await bucket.put('reader/v1/current.json', JSON.stringify(pointer));
  return { bucket, pointer };
}
