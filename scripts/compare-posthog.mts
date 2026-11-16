import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { arch, cpus, platform } from 'node:os';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';

const root = fileURLToPath(new URL('../', import.meta.url));
const posthogDirectory = dirname(fileURLToPath(import.meta.resolve('posthog-js/package.json')));
const metadata = JSON.parse(await readFile(resolve(posthogDirectory, 'package.json'), 'utf8')) as { version: string };
const remote = JSON.parse(await readFile(resolve(root, 'packages/nuxt/tests/fixtures/recording-enabled.json'), 'utf8'));
const scripts = new Map<string, Uint8Array>();
const modes = ['events', 'events-slim', 'browser', 'diagnostics'] as const;
const clients = ['minihog', 'posthog'] as const;
const samples: Record<string, { gzipBytes: number; scriptMs: number; captureMs: number; scripts: string[] }[]> = {};

for (const mode of modes) {
  const browser = !mode.startsWith('events');
  const diagnostics = mode === 'diagnostics';
  const minihog = `
    import { createMiniHog } from 'minihog';
    ${browser ? "import { startBrowserCapture } from 'minihog/browser';" : ''}
    ${
      diagnostics
        ? `import { startSessionReplay } from 'minihog/replay';
      import { startHeatmaps } from 'minihog/heatmaps';
      import { startWebVitals } from 'minihog/web-vitals';
      import { consoleRecordingPlugin } from 'minihog/replay-console';
      import { networkTimingPlugin } from 'minihog/replay-network';`
        : ''
    }
    window.acceptedBenchmarkEvents = 0;
    const client = createMiniHog('phc_benchmark', {apiHost: '/ingest', persistence: 'memory', migratePostHog: false, personProfiles: 'identified_only', flushIntervalMs: 60000,
      beforeSend: event => { if (event.event === 'benchmark_action') window.acceptedBenchmarkEvents++; return event; }});
    ${browser ? 'startBrowserCapture(client);' : ''}
    ${
      diagnostics
        ? `startHeatmaps(client); startWebVitals(client);
      const replay = startSessionReplay(client, {plugins: [consoleRecordingPlugin(), networkTimingPlugin('/ingest')]});`
        : ''
    }
    window.captureBenchmark = (index) => client.capture('benchmark_action', {index, component: 'comparison', active: true});
    window.benchmarkReady = () => ${diagnostics ? 'replay.isRecording()' : 'true'};
  `;
  const posthog = `
    import posthog from '${diagnostics ? 'posthog-js' : mode === 'events-slim' ? 'posthog-js/dist/module.slim.no-external.js' : 'posthog-js/dist/module.no-external.js'}';
    window.acceptedBenchmarkEvents = 0;
    posthog.init('phc_benchmark', {
      api_host: location.origin + '/ingest', defaults: '2026-05-30', persistence: 'memory', person_profiles: 'identified_only', opt_out_useragent_filter: true,
      capture_pageview: ${browser ? "'history_change'" : 'false'}, capture_pageleave: ${browser}, autocapture: ${browser},
      disable_session_recording: ${!diagnostics}, disable_surveys: true,
      capture_performance: ${diagnostics}, disable_compression: true,
      advanced_disable_flags: ${!diagnostics}, disable_external_dependency_loading: ${!diagnostics},
      rate_limiting: {events_per_second: 100000, events_burst_limit: 100000},
      before_send: event => { if (event.event === 'benchmark_action') window.acceptedBenchmarkEvents++; return event; },
      request_batching: true, request_queue_config: {flush_interval_ms: 60000}
    });
    window.captureBenchmark = (index) => posthog.capture('benchmark_action', {index, component: 'comparison', active: true});
    window.benchmarkReady = () => ${diagnostics ? 'posthog.sessionRecordingStarted()' : 'true'};
  `;
  for (const [client, source] of [
    ['minihog', minihog],
    ['posthog', posthog]
  ] as const) {
    const result = await build({
      stdin: { contents: source, resolveDir: resolve(root, 'packages/core') },
      nodePaths: [resolve(root, 'node_modules')],
      bundle: true,
      minify: true,
      target: 'es2022',
      format: 'esm',
      write: false,
      logLevel: 'silent'
    });
    scripts.set(`/${client}-${mode}.js`, result.outputFiles[0]!.contents);
    samples[`${client}-${mode}`] = [];
  }
}

let downloaded = new Set<string>();
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url!, 'http://localhost');
    if (url.pathname.endsWith('/config.js'))
      scripts.set(
        url.pathname,
        new TextEncoder().encode(
          `window._POSTHOG_REMOTE_CONFIG = { phc_benchmark: { config: ${JSON.stringify(remote)} } };`
        )
      );
    if (url.pathname.endsWith('/config') || url.pathname.startsWith('/ingest/flags')) {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify(remote));
      return;
    }
    if (url.pathname.includes('/static/') && url.pathname.endsWith('.js')) {
      const file = basename(url.pathname);
      if (!/^[\w.-]+\.js$/.test(file)) throw new Error('Invalid asset');
      scripts.set(url.pathname, await readFile(resolve(posthogDirectory, 'dist', file)));
    }
    const source = scripts.get(url.pathname);
    if (source) {
      downloaded.add(url.pathname);
      const compressed = gzipSync(source);
      response.writeHead(200, {
        'Content-Type': 'text/javascript',
        'Content-Encoding': 'gzip',
        'Cache-Control': 'no-store',
        'Content-Length': compressed.length
      });
      response.end(compressed);
      return;
    }
    if (url.pathname.startsWith('/ingest/')) {
      request.resume();
      response.setHeader('Content-Type', 'application/json');
      response.end('{"status":1}');
      return;
    }
    const entry = url.searchParams.get('entry');
    assert.ok(entry && scripts.has(`/${entry}.js`));
    response.setHeader('Content-Type', 'text/html');
    response.end(
      `<!doctype html><html lang="en"><head><title>Analytics benchmark</title></head><body><main><h1>Analytics benchmark</h1>${Array.from({ length: 250 }, (_, i) => `<button>Action ${i}</button>`).join('')}<input value="MASKED_VALUE"></main><script type="module" src="/${entry}.js"></script></body></html>`
    );
  } catch (error) {
    response.writeHead(404);
    response.end(String(error));
  }
});
await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
const address = server.address();
assert.ok(address && typeof address !== 'string');
const origin = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch().catch((error: unknown) => {
  server.close();
  throw error;
});
try {
  for (let round = 0; round < 7; round++) {
    for (const mode of modes) {
      for (const client of round % 2 ? [...clients].reverse() : clients) {
        downloaded = new Set();
        const context = await browser.newContext({
          userAgent: `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${browser.version()} Safari/537.36`
        });
        const page = await context.newPage();
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await page.route('**/*', (route) => {
          if (new URL(route.request().url()).origin === origin) return route.continue();
          errors.push(`Unexpected external request: ${route.request().url()}`);
          return route.abort();
        });
        const session = await context.newCDPSession(page);
        await session.send('Performance.enable');
        await page.goto(`${origin}/?entry=${client}-${mode}`);
        await page.waitForFunction(() => (window as unknown as { benchmarkReady?: () => boolean }).benchmarkReady?.());
        // Give both clients the same settling interval; diagnostics includes lazy CDN assets served locally.
        await page.waitForTimeout(mode === 'diagnostics' ? 1200 : 50);
        const metrics = await session.send('Performance.getMetrics');
        const captureMs = await page.evaluate(() => {
          const capture = (window as unknown as { captureBenchmark: (index: number) => void }).captureBenchmark;
          for (let index = 0; index < 50; index++) capture(index);
          const start = performance.now();
          for (let index = 0; index < 500; index++) capture(index);
          return performance.now() - start;
        });
        const accepted = await page.evaluate(
          () => (window as unknown as { acceptedBenchmarkEvents: number }).acceptedBenchmarkEvents
        );
        assert.equal(accepted, 550, `${client}-${mode}: both clients must accept every benchmark event`);
        assert.deepEqual(errors, [], 'The benchmark must be local and error-free');
        if (client === 'posthog' && mode === 'diagnostics') {
          assert.ok([...downloaded].some((path) => path.includes('posthog-recorder')));
          assert.ok([...downloaded].some((path) => path.includes('web-vitals')));
        }
        const gzipBytes = [...downloaded].reduce((sum, path) => sum + gzipSync(scripts.get(path)!).length, 0);
        samples[`${client}-${mode}`]!.push({
          gzipBytes,
          scriptMs: (metrics.metrics.find((metric) => metric.name === 'ScriptDuration')?.value ?? 0) * 1000,
          captureMs,
          scripts: [...downloaded].sort()
        });
        await context.close();
      }
    }
  }
  const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
  const results = Object.fromEntries(
    Object.entries(samples).map(([name, runs]) => [
      name,
      {
        gzipBytes: median(runs.map((r) => r.gzipBytes)),
        startupScriptMs: median(runs.map((r) => r.scriptMs)),
        capture500Ms: median(runs.map((r) => r.captureMs)),
        scripts: runs[0]!.scripts,
        samples: runs
      }
    ])
  );
  const report = {
    recordedAt: new Date().toISOString(),
    node: process.version,
    platform: `${platform()} ${arch()}`,
    cpu: cpus()[0]?.model,
    chromium: browser.version(),
    posthog: metadata.version,
    rounds: 7,
    results
  };
  await mkdir('output', { recursive: true });
  await writeFile('output/comparison.json', JSON.stringify(report, null, 2) + '\n');
  const labels = {
    events: 'Events (standard)',
    'events-slim': 'Events (slim)',
    browser: 'Pageviews and clicks',
    diagnostics: 'Browser, heatmaps, replay, console/network, vitals'
  };
  const rows = modes
    .flatMap((mode) =>
      clients.map((client) => {
        const row = results[`${client}-${mode}`]!;
        return `| ${labels[mode]} | ${client === 'minihog' ? 'MiniHog' : 'posthog-js'} | ${(row.gzipBytes / 1024).toFixed(2)} | ${row.startupScriptMs.toFixed(2)} | ${row.capture500Ms.toFixed(2)} |`;
      })
    )
    .join('\n');
  const markdown = [
    '# Comparison with posthog-js',
    '',
    '<!-- Generated by pnpm comparison:update. -->',
    '',
    `Measured ${report.recordedAt.slice(0, 10)} against posthog-js ${report.posthog}.`,
    '',
    '| Workload | Client | JavaScript gzip (KiB) | Startup script CPU (ms) | Capture 500 events (ms) |',
    '| --- | --- | ---: | ---: | ---: |',
    rows,
    '',
    '## Method',
    '',
    "Seven fresh Chromium contexts per workload, alternating client order. Both clients use memory persistence, identified-only profiles, the same 250-button document, and the same event properties. Each run warms up with 50 captures, then times 500. The benchmark verifies that all events reach the before-send hook; PostHog's bot filter is disabled and its capture rate limit raised to prevent dropped events.",
    '',
    "Bundles use esbuild with ES2022 ESM, minification, and tree-shaking. Gzip totals include all requested JavaScript, including dynamically loaded PostHog assets and configuration. Events and browser workloads use PostHog's no-external entry; slim uses `module.slim.no-external.js`; diagnostics use the standard entry. Assets and API responses are served locally. Surveys are disabled.",
    '',
    "Times are medians. Startup CPU uses Chromium's `ScriptDuration` after initialization and an equal settling interval. Capture timing covers synchronous work only, excluding deferred work and delivery. Raw samples and script paths are saved to `output/comparison.json`.",
    '',
    'Results apply to these workloads. MiniHog targets ES2022 and a smaller API surface; matching feature categories does not imply identical event properties or heuristics. These tests do not measure long-session memory use or cloud replay playback.',
    '',
    '## Reproduce',
    '',
    '```sh',
    'pnpm install --frozen-lockfile',
    'pnpm exec playwright install chromium',
    'pnpm benchmark',
    '```',
    '',
    'Use `pnpm comparison:update` to regenerate this document. The PostHog version is pinned in the workspace lockfile. Results vary by browser, machine, application, and feature selection.',
    '',
    'Implementation: [comparison script](scripts/compare-posthog.mts). API reference: [core documentation](packages/core/README.md). PostHog reference: [JavaScript SDK documentation](https://posthog.com/docs/libraries/js).',
    ''
  ].join('\n');
  await writeFile('output/comparison.md', markdown);
  if (process.argv.includes('--update-docs')) await writeFile('COMPARISON.md', markdown);
  console.table(
    Object.fromEntries(
      Object.entries(results).map(([name, result]) => [
        name,
        {
          gzipBytes: result.gzipBytes,
          startupScriptMs: result.startupScriptMs,
          capture500Ms: result.capture500Ms
        }
      ])
    )
  );
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise<void>((done, reject) => server.close((error) => (error ? reject(error) : done())));
}
