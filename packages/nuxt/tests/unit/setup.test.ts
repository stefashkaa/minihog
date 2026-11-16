import { beforeEach, expect, test, vi } from 'vitest';
import definition from '../../src/module.ts';
import { initializerSource } from '../../src/templates.ts';
import type { ModuleOptions, ProxyOptions, PublicOptions } from '../../src/types.js';

const kit = vi.hoisted(() => ({
  defineNuxtModule: <T>(definition: T) => definition,
  createResolver: () => ({ resolve: (path: string) => '/module/' + path }),
  addImports: vi.fn<(value: { name: string; from: string }) => void>(),
  addPlugin: vi.fn<(value: { src: string; order: number }) => void>(),
  addServerHandler: vi.fn<(value: { route: string; handler: string }) => void>(),
  addTemplate: vi.fn((template: { filename: string; getContents: () => string }) => ({
    ...template,
    dst: '/build/' + template.filename
  }))
}));
vi.mock('@nuxt/kit', () => kit);
beforeEach(() => vi.clearAllMocks());
const nuxt = () => ({
  options: {
    runtimeConfig: { public: {} } as { minihog?: ProxyOptions; public: { minihog?: PublicOptions } },
    alias: {} as Record<string, string>
  },
  hook: vi.fn<(name: string, callback: (manifest: Record<string, { prefetch?: boolean }>) => void) => void>()
});
// The kit mock returns the definition directly instead of Nuxt's module installer.
const module = definition as unknown as {
  defaults: ModuleOptions;
  setup(options: ModuleOptions, app: ReturnType<typeof nuxt>): void;
};
const options = (extra: ModuleOptions = {}) => ({ ...module.defaults, ...extra });

test.each([
  ['https://eu.i.posthog.com', 'https://eu-assets.i.posthog.com'],
  ['https://us.i.posthog.com', 'https://us-assets.i.posthog.com'],
  ['https://self.test', 'https://self.test']
])('module configures proxy, imports, deferred plugin and assets for %s', (host, assetsHost) => {
  const app = nuxt();
  module.setup(options({ host }), app);
  expect(app.options.runtimeConfig.minihog).toEqual({ host, assetsHost, path: '/api/_ph' });
  expect(app.options.runtimeConfig.public.minihog).toEqual({
    key: '',
    proxyPath: '/api/_ph',
    start: 'ready',
    client: {}
  });
  expect(kit.addPlugin.mock.calls[0]![0].order).toBe(-20);
  expect(kit.addImports.mock.calls[0]![0].name).toBe('useMiniHog');
  expect(kit.addServerHandler.mock.calls[0]![0].route).toBe('/api/_ph/**');
  expect(kit.addTemplate.mock.calls[0]![0].getContents()).toContain('createMiniHog');
  expect(app.options.alias['@minihog/core/replay']).toMatch(/\/dist\/replay\.js$/);
  expect(app.options.alias['@minihog/core/identity']).toMatch(/\/dist\/identity\.js$/);
  expect(app.options.alias['@minihog/core/flags']).toMatch(/\/dist\/flags\.js$/);
  const manifest = {
    'minihog.js': { prefetch: true },
    'rrweb.js': {},
    'web-vitals.js': {},
    'app.js': { prefetch: true }
  };
  app.hook.mock.calls[0]![1](manifest);
  expect(manifest['minihog.js'].prefetch).toBe(false);
  expect(manifest['app.js'].prefetch).toBe(true);
});

test.each(['ftp://test', 'https://user:pass@test', 'https://test/path', 'https://test?query', 'https://test#hash'])(
  'rejects unsafe ingestion or assets host %s',
  (host) => {
    expect(() => module.setup(options({ host }), nuxt())).toThrow('HTTP(S) origin');
    expect(() => module.setup(options({ assetsHost: host }), nuxt())).toThrow('HTTP(S) origin');
  }
);

test('validates proxy paths and handles explicit assets origin and optional settings', () => {
  for (const proxyPath of ['relative', '//host', '/bad?query', '/', '/a/../b'])
    expect(() => module.setup(options({ proxyPath }), nuxt())).toThrow('absolute local path');
  const app = nuxt();
  module.setup(
    options({ proxyPath: '/tracking///', assetsHost: 'https://cdn.test', key: undefined, client: undefined }),
    app
  );
  expect(app.options.runtimeConfig.minihog).toMatchObject({ path: '/tracking', assetsHost: 'https://cdn.test' });
  expect(app.options.runtimeConfig.public.minihog!.client).toEqual({});
});

test('template includes exactly the enabled features and gates remote restrictions', () => {
  const source = initializerSource({
    browser: { autocapture: false },
    webVitals: true,
    heatmaps: true,
    replay: true,
    errorCapture: true,
    consoleRecording: true,
    networkTiming: true
  });
  for (const feature of ['browser', 'web-vitals', 'heatmaps', 'replay', 'replay-console', 'replay-network', 'errors'])
    expect(source).toContain(`@minihog/core/${feature}`);
  expect(source).toContain('urlAllowlistEnforced');
  expect(source).toContain('networkPayloadCapture');
  expect(source).toContain('autocapture: remote ? !remote.autocapture_opt_out && false');
});
