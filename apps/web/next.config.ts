import type { NextConfig } from 'next';

const config: NextConfig = {
  output: 'standalone',
  typedRoutes: true,
  transpilePackages: ['@high-signal/shared'],
  images: { unoptimized: true },
  typescript: { ignoreBuildErrors: true },
};

export default config;
