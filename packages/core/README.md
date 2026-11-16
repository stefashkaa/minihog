# minihog

A modular TypeScript client for PostHog's browser ingestion APIs. The event core imports no external runtime modules. Browser analytics, feature flags, surveys, errors, web vitals, heatmaps, and session replay have separate ESM entry points.

## Install and capture

```sh
pnpm add minihog
```

```ts
import { createMiniHog } from 'minihog';
import { startBrowserCapture } from 'minihog/browser';

const analytics = createMiniHog('phc_public_project_token', {
  apiHost: '/api/_ph',
  personProfiles: 'identified_only'
});

startBrowserCapture(analytics);
analytics.capture('project_opened', { slug: 'example' });
```

Use a public project token. A relative host requires a server proxy; direct EU and US ingestion origins also work. Imports and construction do not send requests. Browser capture starts when its function is called.

The package ships ESM and TypeScript declarations. It declares `@rrweb/record`, `@rrweb/rrweb-plugin-console-record`, and `web-vitals` as required peers. If your package manager does not install peers automatically, add them explicitly. Only imported features enter your browser bundle.

## Client options

| Option                          | Default                            | Purpose                                                    |
| ------------------------------- | ---------------------------------- | ---------------------------------------------------------- |
| `apiHost`                       | `https://us.i.posthog.com`         | Ingestion origin or same-origin proxy path                 |
| `persistence`                   | `localStorage`                     | Use `memory` for ephemeral identity and consent            |
| `storage`, `persistenceKey`     | Browser storage, `minihog_<token>` | Supply a storage adapter or isolate clients                |
| `migratePostHog`                | `true`                             | Read standard existing PostHog identity and consent        |
| `personProfiles`                | `identified_only`                  | Choose `always`, `identified_only`, or `never`             |
| `optOutByDefault`, `respectDnt` | `false`                            | Start opted out or honor Do Not Track                      |
| `sessionTimeoutMs`              | `1800000`                          | Idle-session timeout, with a one-minute minimum            |
| `flushIntervalMs`               | `3000`                             | Time before a queued batch is sent                         |
| `maxQueueBytes`                 | `2097152`                          | Maximum in-memory queue size; also limited to 1,000 events |
| `maxRetries`                    | `3`                                | Retry count for transient failures                         |
| `requestTimeoutMs`              | `10000`                            | Timeout for ingestion, configuration, flags, and surveys   |
| `fetch`                         | Global Fetch                       | Replace transport, including unload delivery               |
| `beforeSend`                    | None                               | Return a redacted event or `null` to discard it            |
| `onError`                       | None                               | Receive delivery and extension errors                      |

Options and events are typed through `MiniHogOptions`, `CaptureOptions`, and `CaptureEvent`. `capture` returns the accepted event or `undefined` when capture is suppressed. `flush` waits for the current delivery attempt; retryable failures remain queued.

## Entry points

| Import            | Functions                                                          | Included when used                                                                         |
| ----------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `minihog`         | `createMiniHog`                                                    | Events, queue, identity storage, sessions, consent                                         |
| `/browser`        | `startBrowserCapture`                                              | Pageviews, pageleaves, SPA navigation, attribution, scroll depth, autocapture, rage clicks |
| `/identity`       | `identify`, `setPersonProperties`, `alias`, `group`, `resetGroups` | Person and group event helpers                                                             |
| `/flags`          | `createFeatureFlags`                                               | Remote v2 evaluations, variants, payloads, exposure events                                 |
| `/surveys`        | `getSurveys`, `surveyShown`, `surveySent`, `surveyDismissed`       | Headless definitions and response events                                                   |
| `/errors`         | `captureException`, `startErrorCapture`                            | Manual errors and browser error listeners                                                  |
| `/heatmaps`       | `startHeatmaps`                                                    | Click/movement points, rage clicks, dead clicks                                            |
| `/web-vitals`     | `startWebVitals`                                                   | Google's CLS/FCP/INP/LCP algorithms and INP/LCP attribution                                |
| `/replay`         | `startSessionReplay`                                               | DOM recordings with rrweb                                                                  |
| `/replay-console` | `consoleRecordingPlugin`                                           | rrweb console serialization                                                                |
| `/replay-network` | `networkTimingPlugin`                                              | Resource/navigation timing observations                                                    |
| `/remote-config`  | `getRemoteConfig`                                                  | JSON configuration retrieval                                                               |

`getRemoteConfig(client, assetsHost?)` reads JSON project settings. US and EU Cloud ingestion origins use their matching asset origins automatically. Custom and relative proxy hosts are preserved; self-hosted installations can pass a separate asset origin.

## Identity and groups

```ts
import { identify, group, setPersonProperties } from 'minihog/identity';

identify(analytics, 'account-123', { plan: 'pro' }, { signup_source: 'docs' });
group(analytics, 'organization', 'team-456', { name: 'Example' });
setPersonProperties(analytics, { locale: 'en' });

// On logout, clear identity, super properties, groups, and session state.
analytics.reset();
```

`identify` links the previous anonymous ID using `$anon_distinct_id`. Calling it again for an identified person does not merge two identified accounts. `personProfiles: 'never'` disables person updates.

By default, the client reads the standard `posthog-js` localStorage/cookie identity and its default localStorage consent key on first use. It carries over the distinct ID, device ID, identified state, and active session. Subsequent state uses `minihog_<token>`. Set `migratePostHog: false` to start fresh. Custom PostHog storage names, cookie-based consent, and custom consent prefixes need an application migration.

MiniHog persists to localStorage, with memory fallback when storage is blocked. It does not create cross-subdomain cookies. `persistence: 'memory'` avoids durable MiniHog state.

## Consent, delivery, and teardown

```ts
const analytics = createMiniHog('phc_public_project_token', {
  apiHost: '/api/_ph',
  optOutByDefault: true,
  respectDnt: true
});

analytics.optIn();
analytics.optOut();
await analytics.flush();
await analytics.destroy();
```

Opt-out suppresses capture and clears queued events and durable MiniHog identity. Extensions check consent; replay stops recording. Opt-out changes propagate between tabs. An already delivered request cannot be recalled.

Events are serialized when captured and sent in batches. Failed network requests, HTTP 408, 429, and 5xx responses are retried up to `maxRetries`; other HTTP errors are dropped. Request IDs remain unchanged across retries. Queue overflow drops the oldest event and calls `onError` when supplied.

`visibilitychange` and `pagehide` flush pending events. Small requests use `sendBeacon`; other requests use Fetch. When a custom `fetch` is supplied, all delivery uses that function, including unload flushes. Delivery during tab/process termination remains best effort, especially for a full replay snapshot larger than the browser's keepalive limit. The queue is in memory, so it does not provide durable offline delivery.

Sessions expire after 30 minutes without activity and rotate after 24 hours. Replay and web-vitals events are passive and do not extend an idle session. `getSessionId()` reads the session; `touchSession()` marks user activity.

`register`, `registerOnce`, `unregister`, and `getProperty` manage super properties. `destroy()` removes listeners, stops replay, flushes pending events, and releases timers. Google's web-vitals observers have no unsubscribe API; their callbacks become inert after teardown.

## Feature flags and experiments

```ts
import { createFeatureFlags } from 'minihog/flags';

const flags = createFeatureFlags(analytics, {
  personProperties: { plan: 'pro' },
  evaluationContexts: ['production']
});
await flags.reload();

const variant = flags.getFeatureFlag('new-checkout');
const payload = flags.getFeatureFlagPayload('new-checkout');
analytics.capture('checkout_completed');
```

Unknown flags return `undefined`. Flag access records a deduplicated `$feature_flag_called` event. Evaluation results are attached to subsequent events using `$feature/<key>` and `$active_feature_flags`. Identity and group changes invalidate evaluations and trigger a reload; stale responses cannot overwrite newer results. Bootstrap values and `onFeatureFlags` subscriptions are supported. This client does not evaluate flag rules locally.

## Web vitals and replay

```ts
import { startWebVitals } from 'minihog/web-vitals';
import { startSessionReplay } from 'minihog/replay';
import { consoleRecordingPlugin } from 'minihog/replay-console';
import { networkTimingPlugin } from 'minihog/replay-network';

startWebVitals(analytics);
const replay = startSessionReplay(analytics, {
  maskAllInputs: true,
  plugins: [consoleRecordingPlugin(), networkTimingPlugin(analytics.apiHost)]
});

replay.stop();
```

Only one recorder can run in a document. Inputs are masked by default; `.ph-no-capture`, `.ph-sensitive`, and `[data-private]` elements are blocked. `maskTextSelector` can mask displayed text. Console output can contain application data and needs its own review. The network plugin records timings and URLs, never headers or bodies.

Snapshots omit scripts, script preload links, comments, and whitespace inside `<head>` by default, while retaining styles and visible content. Pass `slimDOMOptions: {}` to retain those nodes. Use recorder masking options for DOM privacy rules; `beforeSend` can also redact, replace, or drop replay events.

Canvas pixels are excluded by default; set `recordCanvas: true` when they are needed. Full DOM snapshots run synchronously, so larger documents and frequent mutations cost more to record. Replay supports per-session sampling, minimum duration, and idle suspension. Sampling reduces recorded sessions; a minimum duration reduces uploads but still records events while waiting.

### Delay loading replay

Use dynamic imports to defer downloading and evaluating the recorder until your application's critical content is ready:

```ts
async function startReplay(analytics: import('minihog').MiniHog) {
  const [{ startSessionReplay }, { consoleRecordingPlugin }, { networkTimingPlugin }] = await Promise.all([
    import('minihog/replay'),
    import('minihog/replay-console'),
    import('minihog/replay-network')
  ]);

  return startSessionReplay(analytics, {
    plugins: [consoleRecordingPlugin(), networkTimingPlugin(analytics.apiHost)]
  });
}
```

Call `await startReplay(analytics)` once the application is ready and any required consent is granted. Replay starts at that point; earlier interactions are not recorded. Keep the returned controller and call `stop()` when recording is no longer needed. Nuxt applications can use the module's [manual startup](https://github.com/stefashkaa/minihog/tree/main/packages/nuxt#delay-initialization).

## Compatibility

MiniHog requires ES2022, Web Crypto, Fetch, and native DOM APIs. It adds no polyfills or remotely downloaded scripts. Its API uses separate imports and camelCase methods. Automatic survey rendering, product tours, conversations, the toolbar, and advanced remote recording triggers are not supported.

Replay uses PostHog's SDK snapshot ingestion format, which has a weaker compatibility guarantee than the documented capture and flags APIs. MiniHog supports DOM recording and console/network-timing diagnostics; it does not capture network payloads or implement every `posthog-js` replay control.

## Contributing

See [CONTRIBUTING.md](https://github.com/stefashkaa/minihog/blob/main/CONTRIBUTING.md) for development setup and checks. The Nuxt companion is [`@minihog/nuxt`](https://github.com/stefashkaa/minihog/tree/main/packages/nuxt#readme).

Protocol references: [capture and batch](https://posthog.com/docs/api/capture), [flags v2](https://posthog.com/docs/api/flags), [sessions](https://posthog.com/docs/data/sessions), [custom surveys](https://posthog.com/docs/surveys/implementing-custom-surveys), [web-vitals](https://github.com/GoogleChrome/web-vitals), [rrweb](https://github.com/rrweb-io/rrweb).
