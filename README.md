# MiniHog

Modular PostHog analytics for modern browsers. Import the features you use: events, pageviews, autocapture, heatmaps, feature flags, surveys, errors, web vitals, or session replay.

The core has no runtime dependencies. Optional features use separate ESM entry points and support tree-shaking. MiniHog adds no polyfills and never downloads executable code from PostHog.

| Package                                    | Purpose                                                |
| ------------------------------------------ | ------------------------------------------------------ |
| [`@minihog/core`](packages/core/README.md) | Framework-independent TypeScript client                |
| [`@minihog/nuxt`](packages/nuxt/README.md) | Nuxt 4 module, same-origin proxy, and deferred startup |

## Browser

```sh
pnpm add @minihog/core
```

```ts
import { createMiniHog } from '@minihog/core';
import { startBrowserCapture } from '@minihog/core/browser';

const analytics = createMiniHog('phc_public_project_token', {
  apiHost: 'https://eu.i.posthog.com'
});

startBrowserCapture(analytics);
analytics.capture('project_opened', { slug: 'example' });
```

## Nuxt

```sh
pnpm add @minihog/nuxt
```

```ts
export default defineNuxtConfig({
  modules: ['@minihog/nuxt'],
  minihog: {
    host: 'https://eu.i.posthog.com',
    start: 'manual'
  }
});
```

Set `NUXT_PUBLIC_MINIHOG_KEY` to your public project token. Call `await useMiniHog().start()` when the application is ready to collect analytics. An empty key makes no analytics requests and leaves the implementation unloaded.

The module proxies supported ingestion endpoints through `/api/_ph`. See the [Nuxt guide](packages/nuxt/README.md) for automatic startup, consent, and optional diagnostics.

## Features and compatibility

MiniHog supports event batching, identity and group helpers, session persistence, consent, SPA pageviews, pageleaves, scroll depth, click capture, heatmaps, remote feature flags, headless surveys, and error capture. Replay uses a bundled rrweb recorder, with optional console and network-timing plugins. Web vitals use Google's metric algorithms.

The API uses explicit imports and camelCase methods. It does not provide the full `posthog-js` method surface, survey rendering, toolbar, product tours, conversations, or advanced replay targeting. The [core guide](packages/core/README.md) documents persistence migration, delivery guarantees, browser requirements, and replay protocol boundaries.

Tree-shaking removes unused features. Enabled replay still requires recorder code and runtime work. Performance depends on the enabled features and the host application; measure the production build with those features active.

MiniHog is an independent project and is not affiliated with PostHog.

## Development

```sh
pnpm install
pnpm build
pnpm dev:demo
# In a separate terminal, run the checks:
pnpm exec playwright install chromium
pnpm check:release
```

Checks include ESLint, Prettier, TypeScript, peer dependencies, production dependency auditing, publint, Are the Types Wrong, bundle budgets, tree-shaking, Vitest/V8 coverage, and Playwright tests against packed packages. Coverage must meet 95% for statements, branches, functions, and lines in each package. All runtime source files are included.

See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), and the [demo site](demo).

## License

The packages are MIT licensed. See [third-party notices](THIRD_PARTY_NOTICES.md) for the rrweb recorder and the demo's Vue Bits background.
