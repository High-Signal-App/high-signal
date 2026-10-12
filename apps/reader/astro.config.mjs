import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';
import webPackage from '@high-signal/web/package.json' with { type: 'json' };

const webRoot = dirname(createRequire(import.meta.url).resolve('@high-signal/web/package.json'));

export default defineConfig({
  site: webPackage.homepage,
  output: 'static',
  publicDir: resolve(webRoot, 'public'),
  integrations: [react()],
  build: { format: 'file', inlineStylesheets: 'never' },
  vite: {
    define: {
      'process.env.NEXT_PUBLIC_POSTHOG_KEY': JSON.stringify(
        process.env['NEXT_PUBLIC_POSTHOG_KEY'] ?? 'phc_qgiAarw4Co4pw9fz3Fxj4UJaHmqzFetqs4JrXhGc35Nd'
      ),
    },
    plugins: [tailwindcss()],
    resolve: {
      alias: {
        '@': resolve(webRoot, 'src'),
        '@web-root': webRoot,
      },
    },
  },
});
