import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: '../../test-results/nuxt',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  timeout: 30000,
  use: { baseURL: 'http://127.0.0.1:4317', headless: true, trace: 'retain-on-failure' },
  webServer: {
    command: 'node scripts/serve-packed-fixture.mts',
    cwd: fileURLToPath(new URL('../../', import.meta.url)),
    url: 'http://127.0.0.1:4317',
    timeout: 180000,
    stdout: 'pipe',
    reuseExistingServer: false
  }
});
