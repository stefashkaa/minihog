import { addImports, addPlugin, addServerHandler, addTemplate, createResolver, defineNuxtModule } from '@nuxt/kit';
import { initializerSource } from './templates.js';
import type { ModuleOptions } from './types.js';
import { fileURLToPath } from 'node:url';

export type { MiniHogController, ModuleOptions } from './types.js';

export default defineNuxtModule<ModuleOptions>({
  meta: { name: '@minihog/nuxt', configKey: 'minihog', compatibility: { nuxt: '^4.0.0' } },
  defaults: {
    key: '',
    host: 'https://us.i.posthog.com',
    proxyPath: '/api/_ph',
    start: 'ready',
    browser: {},
    webVitals: false,
    heatmaps: false,
    replay: false,
    consoleRecording: false,
    networkTiming: false,
    errorCapture: false,
    client: {}
  },
  setup(options, nuxt) {
    const resolver = createResolver(import.meta.url);
    const host = new URL(options.host!);
    if (
      !['http:', 'https:'].includes(host.protocol) ||
      host.username ||
      host.password ||
      host.search ||
      host.hash ||
      host.pathname !== '/'
    ) {
      throw new Error('minihog.host must be an HTTP(S) origin without credentials, a path, or query parameters.');
    }
    const path = options.proxyPath!.replace(/\/+$/, '');
    if (!/^\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+$/.test(path))
      throw new Error('minihog.proxyPath must be an absolute local path.');
    const assetsHost =
      options.assetsHost ??
      (host.hostname === 'eu.i.posthog.com'
        ? 'https://eu-assets.i.posthog.com'
        : host.hostname === 'us.i.posthog.com'
          ? 'https://us-assets.i.posthog.com'
          : host.origin);
    const assets = new URL(assetsHost);
    if (
      !['http:', 'https:'].includes(assets.protocol) ||
      assets.username ||
      assets.password ||
      assets.search ||
      assets.hash ||
      assets.pathname !== '/'
    )
      throw new Error('minihog.assetsHost must be an HTTP(S) origin.');
    nuxt.options.runtimeConfig.minihog = { host: host.origin, assetsHost: assets.origin, path };
    nuxt.options.runtimeConfig.public.minihog = {
      key: options.key ?? '',
      proxyPath: path,
      start: options.start!,
      client: options.client ?? {}
    };
    const template = addTemplate({
      filename: 'minihog/init.mjs',
      getContents: () => initializerSource(options)
    });
    nuxt.options.alias['#minihog-init'] = template.dst;
    // Resolve from the installed module, including when pnpm keeps core transitive.
    // Specific subpaths precede the root because Vite aliases also match prefixes.
    for (const entry of [
      'identity',
      'flags',
      'surveys',
      'package.json',
      'browser',
      'remote-config',
      'web-vitals',
      'heatmaps',
      'replay-console',
      'replay-network',
      'replay',
      'errors',
      ''
    ]) {
      const specifier = `minihog${entry ? `/${entry}` : ''}`;
      nuxt.options.alias[specifier] = fileURLToPath(import.meta.resolve(specifier));
    }
    addPlugin({ src: resolver.resolve('./runtime/plugin.js'), order: -20 });
    addImports({ name: 'useMiniHog', from: resolver.resolve('./runtime/composable.js') });
    addServerHandler({ route: `${path}/**`, handler: resolver.resolve('./runtime/server/proxy.js') });
    nuxt.hook('build:manifest', (manifest) => {
      // These chunks must follow the application's start() boundary, including replay peers.
      for (const [id, entry] of Object.entries(manifest)) {
        if (/minihog|rrweb|web-vitals/.test(id)) entry.prefetch = false;
      }
    });
  }
});
