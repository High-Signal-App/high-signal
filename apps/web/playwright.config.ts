import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env['PLAYWRIGHT_PORT'] ?? 3000);
const host = process.env['PLAYWRIGHT_HOST'] ?? 'localhost';
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  reporter: 'list',
  use: { baseURL },
  webServer: {
    command: `pnpm dev --port ${port}`,
    url: `http://${host}:${port}/privacy`,
    reuseExistingServer: !process.env.CI,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
