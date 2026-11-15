# @minihog/nuxt

Nuxt 4 integration for `@minihog/core`. It installs a typed controller, a `useMiniHog()` composable, and an allowlisted same-origin proxy. Feature imports are generated at build time, so disabled features produce no chunks. Enabled replay and web-vitals chunks load only when remote settings allow them.

## Install

```sh
pnpm add @minihog/nuxt
```

```ts
export default defineNuxtConfig({
  modules: ['@minihog/nuxt'],
  minihog: {
    host: 'https://eu.i.posthog.com',
    proxyPath: '/api/_ph',
    start: 'ready',
    browser: { pageviews: true, autocapture: true }
  }
});
```

Set `NUXT_PUBLIC_MINIHOG_KEY` to the public project token at runtime. `key` in the module options provides a build-time default. An empty key prevents importing the analytics implementation and makes no analytics requests. The small controller remains part of the Nuxt application.

The default host is US Cloud. EU Cloud automatically uses `eu-assets.i.posthog.com` for JSON configuration. Self-hosted installations can specify `assetsHost` separately. Host values must be HTTP(S) origins; the proxy does not accept a target supplied by a request.

## Delay initialization

Set `start: 'manual'` to keep the analytics implementation unloaded until the application calls `start()`:

```ts
export default defineNuxtPlugin({
  name: 'analytics-after-gallery',
  dependsOn: ['minihog'],
  setup() {
    const analytics = useMiniHog();
    const galleryReady = useState<boolean>('gallery-ready');

    onNuxtReady(() => {
      const stop = watch(galleryReady, (ready) => {
        if (ready) {
          stop();
          void analytics.start();
        }
      });
      if (galleryReady.value) {
        stop();
        void analytics.start();
      }
    });
  }
});
```

Start analytics when your application's readiness condition is satisfied. Handle failed initialization of the deferred feature as well, so analytics can still start. Visits and interactions before `start()` are not collected.

`start: 'ready'` starts on Nuxt readiness. `start: 'idle'` schedules another browser idle callback with a two-second timeout after Nuxt readiness. Neither mode runs the analytics client during SSR. For a consent-based start, call `start()` after obtaining consent or use `client.optOutByDefault` and explicitly opt in.

```ts
const analytics = useMiniHog();
await analytics.start();
analytics.getClient()?.capture('project_opened', { slug: 'example' });
await analytics.stop();
```

Concurrent starts share one promise. Stop cancels a pending initialization, cleans up a late client, and permits a later restart. Initialization failure returns `undefined` and logs a warning without preventing page rendering.

## Optional features

```sh
pnpm add web-vitals @rrweb/record @rrweb/rrweb-plugin-console-record
```

```ts
export default defineNuxtConfig({
  modules: ['@minihog/nuxt'],
  minihog: {
    webVitals: true,
    heatmaps: true,
    replay: true,
    consoleRecording: true,
    networkTiming: true,
    errorCapture: false,
    client: { personProfiles: 'identified_only', migratePostHog: true }
  }
});
```

All options in this example except browser capture default to `false`. `browser: false` disables pageviews and DOM capture. For feature flags, identity helpers, or headless surveys, add `@minihog/core` as a direct dependency and import the corresponding entry point.

Local feature selection limits what remote settings can enable. Remote configuration cannot download extra scripts. Unknown replay targeting/payload rules and enforced heatmap URL rules stop those features and produce a warning; they never broaden collection silently.

## Proxy behavior

The module installs these paths beneath `proxyPath`:

| Method | Path                    | Purpose                                         |
| ------ | ----------------------- | ----------------------------------------------- |
| POST   | `/batch/`, `/i/v0/e/`   | Event ingestion                                 |
| POST   | `/s/`                   | Replay snapshots                                |
| POST   | `/flags/`               | Flag evaluation; query parameters are preserved |
| GET    | `/array/<token>/config` | JSON configuration from the asset host          |
| GET    | `/api/surveys/`         | Public survey definitions                       |

Other paths and methods return 404. Cookies and authorization headers are not forwarded. Upstream responses use `no-store`; compressed content length/encoding headers are not copied onto decoded responses. Requests have a ten-second upstream timeout and a 2 MiB streaming body limit. Place deployment-specific rate limits at your hosting layer if needed.

The proxy requires a Node-based Nitro server or serverless deployment. A static-only Nuxt export cannot serve these routes. The module currently targets Nuxt 4; Nuxt 3 and edge-runtime compatibility are not claimed.

## Contributing

See [CONTRIBUTING.md](../../CONTRIBUTING.md) for development setup and tests. A complete example is in [`demo`](../../demo).
