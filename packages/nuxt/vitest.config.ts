import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '#app': fileURLToPath(new URL('./tests/mocks/app.ts', import.meta.url)),
      '#imports': fileURLToPath(new URL('./tests/mocks/imports.ts', import.meta.url)),
      '#minihog-init': fileURLToPath(new URL('./tests/mocks/init.ts', import.meta.url))
    }
  },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
    restoreMocks: true,
    unstubGlobals: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts'],
      reporter: ['text', 'json', 'json-summary', 'lcov', 'html'],
      thresholds: { lines: 95, statements: 95, functions: 95, branches: 95 }
    }
  }
});
