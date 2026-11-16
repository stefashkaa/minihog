import type { ModuleOptions } from './types.js';

/** Generates imports at build time so disabled features have no output chunks. */
export function initializerSource(options: ModuleOptions): string {
  const imports = [
    "import { createMiniHog } from 'minihog';",
    "import { getRemoteConfig } from 'minihog/remote-config';"
  ];
  const setup: string[] = [];
  if (options.browser !== false) {
    imports.push("import { startBrowserCapture } from 'minihog/browser';");
    setup.push(
      `cleanups.push(startBrowserCapture(client, { ...${JSON.stringify(options.browser ?? {})}, autocapture: remote ? !remote.autocapture_opt_out && ${options.browser?.autocapture !== false} : false }));`
    );
  }
  if (options.webVitals) {
    setup.push(`if (remote?.capturePerformance?.web_vitals) {
      const { startWebVitals } = await import('minihog/web-vitals');
      if (!valid()) return;
      cleanups.push(startWebVitals(client, remote.capturePerformance.web_vitals_allowed_metrics ?? undefined));
    }`);
  }
  if (options.heatmaps) {
    setup.push(`if (remote?.heatmaps) {
      const rules = remote.heatmaps;
      if (typeof rules === 'object' && rules.urlAllowlistEnforced) {
        console.warn('[minihog] Heatmaps disabled: enforced URL targeting requires an explicit integration.');
      } else {
        const { startHeatmaps } = await import('minihog/heatmaps');
        if (!valid()) return;
        cleanups.push(startHeatmaps(client));
      }
    }`);
  }
  if (options.replay) {
    setup.push(`
      const recording = remote?.sessionRecording;
      if (recording) {
        // Unknown eligibility rules must never broaden who is recorded.
        const unsupported = recording.urlTriggers?.length || recording.urlBlocklist?.length || recording.eventTriggers?.length || recording.linkedFlag || recording.networkPayloadCapture;
        if (unsupported) {
          console.warn('[minihog] Replay disabled: remote targeting or payload rules require an explicit integration.');
        } else {
          const { startSessionReplay } = await import('minihog/replay');
          if (!valid()) return;
          const plugins = [];
          ${options.consoleRecording ? "if (recording.consoleLogRecordingEnabled) { const { consoleRecordingPlugin } = await import('minihog/replay-console'); if (!valid()) return; plugins.push(consoleRecordingPlugin()); }" : ''}
          ${options.networkTiming ? "if (remote.capturePerformance?.network_timing) { const { networkTimingPlugin } = await import('minihog/replay-network'); if (!valid()) return; plugins.push(networkTimingPlugin(client.apiHost)); }" : ''}
          cleanups.push(startSessionReplay(client, {
            plugins,
            sampleRate: recording.sampleRate == null ? 1 : Number(recording.sampleRate),
            minimumDurationMs: recording.minimumDurationMilliseconds ?? 0,
            recordCanvas: recording.recordCanvas ?? false,
            ...recording.masking
          }).stop);
        }
      }
    `);
  }
  if (options.errorCapture) {
    imports.push("import { startErrorCapture } from 'minihog/errors';");
    setup.push('cleanups.push(startErrorCapture(client));');
  }
  return `${imports.join('\n')}
export async function initialize(config, isActive = () => true) {
  const client = createMiniHog(config.key, { ...config.client, apiHost: config.proxyPath });
  const cleanups = [];
  let generation = 0;
  let disposed = false;
  const clear = () => { for (const cleanup of cleanups.splice(0)) cleanup(); };
  async function activate() {
    const version = ++generation;
    clear();
    const valid = () => !disposed && version === generation && isActive() && !client.hasOptedOut();
    if (!valid()) return;
    const remote = await getRemoteConfig(client);
    if (!valid()) return;
    ${setup.join('\n')}
  }
  const unsubscribe = client.onConsentChange(() => { void activate().catch(error => console.warn('[minihog] Analytics could not restart.', error)); });
  client.addCleanup(() => { disposed = true; generation++; unsubscribe(); clear(); });
  try {
    await activate();
    return client;
  } catch (error) {
    await client.destroy();
    throw error;
  }
}
`;
}
