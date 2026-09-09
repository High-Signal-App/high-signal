// @ts-check
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://highsignal.app',
  output: 'static',
  // Preserve the existing whitespace semantics across the Astro 7 compiler.
  compressHTML: true,
  trailingSlash: 'never',
  build: {
    format: 'file',
    inlineStylesheets: 'always',
  },
  vite: {
    plugins: [tailwindcss()],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    build: { cssMinify: 'lightningcss' },
  },
});
