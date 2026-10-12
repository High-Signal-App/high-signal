import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://highsignal.app',
  output: 'static',
  publicDir: '../web/public',
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
        '@': fileURLToPath(new URL('../web/src', import.meta.url)),
        '@web-root': fileURLToPath(new URL('../web', import.meta.url)),
      },
    },
  },
});
