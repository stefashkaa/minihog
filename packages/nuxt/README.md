# @minihog/nuxt

Nuxt 4 integration for `minihog`. It installs a typed controller, a `useMiniHog()` composable, and an allowlisted same-origin proxy. Feature imports are generated at build time, so disabled features produce no chunks. Enabled replay and web-vitals chunks load only when remote settings allow them.

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

Set `NUXT_PUBLIC_MINIHOG_KEY` to the public project token at runtime. `key` in the module options provides a build-time default. An empty key prevents importing the analytics implementation and makes no analytics requests.

The default host is US Cloud. EU Cloud automatically uses `eu-assets.i.posthog.com` for JSON configuration. Self-hosted installations can specify `assetsHost` separately. Host values must be HTTP(S) origins; the proxy does not accept a target supplied by a request.

## Module options

| Option                              | Default                                       | Purpose                                                                                 |
| ----------------------------------- | --------------------------------------------- | --------------------------------------------------------------------------------------- |
| `key`                               | Empty                                         | Public project token, overridable with `NUXT_PUBLIC_MINIHOG_KEY`                        |
| `host`                              | `https://us.i.posthog.com`                    | Ingestion origin                                                                        |
| `assetsHost`                        | Matching Cloud asset origin, otherwise `host` | JSON project configuration                                                              |
| `proxyPath`                         | `/api/_ph`                                    | Local server route prefix                                                               |
| `start`                             | `ready`                                       | Choose `ready`, `idle`, or `manual`                                                     |
| `browser`                           | `{}`                                          | Pageviews, autocapture, rage clicks, and text capture; `false` disables browser capture |
| `webVitals`, `heatmaps`, `replay`   | `false`                                       | Enable independent feature imports                                                      |
| `consoleRecording`, `networkTiming` | `false`                                       | Add diagnostics to enabled replay                                                       |
| `errorCapture`                      | `false`                                       | Capture browser errors and unhandled rejections                                         |
| `client`                            | `{}`                                          | Serializable persistence, consent, profile, session-timeout, and flush options          |

The module exports `ModuleOptions` and `MiniHogController` types. Callback functions and custom storage/transports belong in a direct core integration rather than serializable Nuxt runtime configuration.

## Delay initialization

Set `start: 'manual'` to keep the analytics implementation unloaded until the application calls `start()`:

```ts
export default defineNuxtPlugin({
  name: 'analytics-after-content',
  dependsOn: ['minihog'],
  setup() {
    const analytics = useMiniHog();
    const contentReady = useState<boolean>('content-ready');

    onNuxtReady(() => {
      const stop = watch(contentReady, (ready) => {
        if (ready) {
          stop();
          void analytics.start();
        }
      });
      if (contentReady.value) {
        stop();
        void analytics.start();
      }
    });
  }
});
```

Start analytics when your application's readiness condition is satisfied. Handle failed initialization of the deferred feature as well, so analytics can still start. Visits and interactions before `start()` are not collected.

`start: 'ready'` starts on Nuxt readiness. `start: 'idle'` schedules another browser idle callback with a two-second timeout after Nuxt readiness. Neither mode runs the analytics client during SSR. For a consent-based start, call `start()` after obtaining consent or use `client.optOutByDefault` and explicitly opt in.

Use `manual` when expensive rendering has an explicit completion signal; the `idle` timeout can start analytics while the page is busy.

```ts
const analytics = useMiniHog();
await analytics.start();
analytics.getClient()?.capture('project_opened', { slug: 'example' });
await analytics.stop();
```

Concurrent starts share one promise. Stop cancels a pending initialization, cleans up a late client, and permits a later restart. Initialization failure returns `undefined` and logs a warning without preventing page rendering.

## Optional features

Enable features through module options. Package managers with automatic peer installation resolve the [core package's required peers](https://github.com/stefashkaa/minihog/tree/main/packages/core#install-and-capture); otherwise, add them explicitly.

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

For feature flags, identity helpers, or headless surveys, add `minihog` as a direct dependency and import the corresponding entry point.

Remote settings can only enable locally selected features. Unsupported replay targeting/payload rules and enforced heatmap URL rules disable those features and produce a warning.

## Proxy behavior

The module installs these paths beneath `proxyPath`:

| Method | Path                    | Purpose                                         |
| ------ | ----------------------- | ----------------------------------------------- |
| POST   | `/batch/`, `/i/v0/e/`   | Event ingestion                                 |
| POST   | `/s/`                   | Replay snapshots                                |
| POST   | `/flags/`               | Flag evaluation; query parameters are preserved |
| GET    | `/array/<token>/config` | JSON configuration from the asset host          |
| GET    | `/api/surveys/`         | Public survey definitions                       |

Other paths and methods return 404. Cookies and authorization headers are not forwarded. Responses use `no-store`. Requests have a ten-second upstream timeout and a 2 MiB body limit. Apply deployment-specific rate limits at your hosting layer if needed.

The module requires Nuxt 4 and a Node-based Nitro server or serverless deployment. A static-only Nuxt export cannot serve the proxy routes.

## Contributing

See [CONTRIBUTING.md](https://github.com/stefashkaa/minihog/blob/main/CONTRIBUTING.md) for development setup and tests. A complete example is in [`demo`](https://github.com/stefashkaa/minihog/tree/main/demo).
