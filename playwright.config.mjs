import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  use: { baseURL: 'http://127.0.0.1:4317', headless: true, trace: 'retain-on-failure' },
  webServer: [
    {
      command: 'node scripts/serve-packed-fixture.mjs',
      url: 'http://127.0.0.1:4317',
      timeout: 180000,
      stdout: 'pipe',
      reuseExistingServer: false
    },
    {
      command: 'node demo/.output/server/index.mjs',
      url: 'http://127.0.0.1:4319',
      env: { PORT: '4319', HOST: '127.0.0.1' },
      reuseExistingServer: false
    }
  ]
});
