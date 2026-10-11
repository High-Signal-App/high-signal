import type { NextConfig } from 'next';

const config: NextConfig = {
  output: 'standalone',
  typedRoutes: true,
  transpilePackages: ['@high-signal/shared', '@saas-maker/ui'],
  images: { unoptimized: true },
  typescript: { ignoreBuildErrors: true },
};

export default config;
