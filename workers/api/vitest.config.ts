import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/__tests__/**/*.test.ts"],
    alias: {
      // `cloudflare:email` is a workerd-only virtual module; stub it so suites
      // that transitively import the email/delivery route can load under node.
      "cloudflare:email": resolve(__dirname, "test/stubs/cloudflare-email.ts"),
    },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/**/*.d.ts',
        'src/**/types.ts',
        'src/**/index.ts',
        'src/**/*.config.{ts,js}',
        'src/**/__tests__/**',
      ],
      thresholds: {
        lines: 34,
        functions: 30,
      },
    },
  },
});
