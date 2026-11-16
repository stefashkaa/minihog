# Performance

MiniHog keeps features in separate entry points, batches events, and loads no executable code from PostHog. Session replay still needs to read the DOM and observe changes. Its cost depends on the page size, mutation rate, enabled diagnostics, and device.

## Start after critical rendering

In Nuxt, use `start: 'manual'` when the application has a readiness signal for expensive initialization. Call `useMiniHog().start()` once that work finishes. For applications without a readiness signal, `start: 'idle'` schedules initialization after Nuxt readiness with a two-second idle timeout. See the [Nuxt startup guide](packages/nuxt/README.md#delay-initialization).

In other frameworks, use dynamic imports at the same readiness boundary:

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

Call this function after the application's critical content is ready. Dynamic imports defer downloading and evaluating the recorder; a static import still loads it with the importing module. Consent requirements apply before capture starts. Replay cannot reconstruct interactions that happened before recording began.

An idle callback changes when work starts, not how much work it performs. A timeout can run the callback while the page is busy. Neither `requestIdleCallback` nor `scheduler.postTask` interrupts a synchronous DOM snapshot once it starts. Wrapping it in a promise does not split that work either. A chunked snapshot would need recorder support to keep DOM changes and event ordering consistent while yielding. Avoid starting the recorder directly inside a click or drag handler. See [idle callback behavior](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestIdleCallback) and [task scheduling](https://developer.mozilla.org/en-US/docs/Web/API/Prioritized_Task_Scheduling_API).

## Reduce repeated work

MiniHog serializes each replay event once, buffers the resulting JSON, and reuses it when building the ingestion request. The transport also reuses UTF-8 byte counts when deciding whether a request fits the browser's unload budget. It does not traverse the snapshot again merely to construct a batch.

A `beforeSend` hook receives ordinary event objects, including `$snapshot_data`. MiniHog materializes that data before calling the hook and serializes its result so redaction, replacement, and dropping events remain effective. Custom property `toJSON` methods also receive complete properties. These hooks take the normal serialization path; prefer recorder masking options for DOM privacy rules and keep hooks inexpensive.

Snapshots omit scripts, script preload links, comments, and whitespace inside `<head>` by default. Stylesheets, visible content, page titles, input masking, and console/network diagnostics remain available. The core replay option `slimDOMOptions: {}` retains those omitted nodes when an integration needs them. See [rrweb's snapshot options](https://github.com/rrweb-io/rrweb/blob/main/guide.md).

Large DOMs and frequent mutations still require work. Virtualizing long lists can reduce both application rendering and recorder work, but only rendered content appears in replay. Avoid logging large object graphs repeatedly: console recording must serialize them. Network timing records URLs and timings, without capturing request or response bodies. Canvas recording stays off by default and must be considered separately when a replay needs canvas pixels.

## Workers and scheduling

| Technique                                    | What it can improve                                                | Limits                                                                                                        |
| -------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| Separate imports and application readiness   | Startup transfer, evaluation, and contention with rendering        | Delayed capture misses earlier interactions                                                                   |
| Cached JSON and smaller snapshots            | Repeated serialization and snapshot payload size                   | DOM observation still runs on the main thread                                                                 |
| Dedicated worker for encoding or compression | CPU-heavy processing after a snapshot exists                       | Posting objects copies data; worker startup, lifecycle, consent, ordering, and unload delivery need handling  |
| `scheduler.postTask` or idle callbacks       | When background work gets a chance to start                        | Scheduling is not parallel execution; feature detection and fallbacks are required                            |
| Partytown                                    | Moving suitable third-party script computation off the main thread | DOM access is proxied back to the main thread and throttled; it is not a supported MiniHog replay integration |

A worker cannot read the document or install a DOM `MutationObserver`. Moving the recorder wholesale into a worker therefore does not remove snapshot work. A custom worker could process already captured events, but `postMessage` uses structured cloning. Transferable buffers avoid copying an existing buffer; creating that buffer on the main thread still costs time. See [Web Workers](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers).

MiniHog has no built-in worker transport. For a workload dominated by compression or large payload processing, prototype a dedicated worker and measure both the synchronous `postMessage` cost and total processing time. For small events, an extra thread and messaging can cost more than the processing it replaces. Partytown's [documented DOM trade-offs](https://partytown.qwik.dev/trade-offs/) make it a poor default for DOM-heavy replay; compatibility and fidelity would need separate testing.

## Measure with recording active

Use the production build and the same capture settings for both versions. Confirm that a full snapshot, console marker, network timing, and web-vitals events arrive during the measured session. Keep the startup boundary identical.

Run Lighthouse several times and compare medians and ranges. Check analytics-specific legacy and unused JavaScript findings separately from Total Blocking Time and the overall score. Then record a browser performance trace while scrolling, dragging, changing routes, and using forms. Inspect recorder startup, later full snapshots, mutation-heavy updates, JSON serialization, and garbage collection. Check field INP as well; a navigation audit does not represent every later interaction. See [long-task measurement](https://web.dev/articles/optimize-long-tasks).

Sampling fewer sessions reduces aggregate recording cost but does not make a recorded session cheaper. Increasing the minimum duration can reduce uploads without avoiding the recording work already performed. Neither change should be used as evidence of a faster recorder when capture requirements are unchanged.
