#!/usr/bin/env node
import { runOverlay } from './overlay-astro-landing.mjs';

await runOverlay({
  astroDist: 'landing-astro/dist',
  assets: '.open-next/assets',
  strict: process.argv.includes('--strict'),
});
