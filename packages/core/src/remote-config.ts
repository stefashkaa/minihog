import { context } from './internal/state.js';
import type { MiniHog } from './types.js';

export interface ReplayRemoteConfig {
  sampleRate?: number | string | null;
  consoleLogRecordingEnabled?: boolean;
  minimumDurationMilliseconds?: number | null;
  recordCanvas?: boolean;
  masking?: { maskAllInputs?: boolean; maskTextSelector?: string; blockSelector?: string } | null;
  urlTriggers?: unknown[];
  urlBlocklist?: unknown[];
  eventTriggers?: unknown[];
  linkedFlag?: unknown;
  networkPayloadCapture?: unknown;
}

export interface RemoteConfig {
  heatmaps?: boolean | { captureMode?: string; urlAllowlist?: unknown[]; urlAllowlistEnforced?: boolean };
  autocapture_opt_out?: boolean;
  capturePerformance?: { network_timing?: boolean; web_vitals?: boolean; web_vitals_allowed_metrics?: string[] | null };
  sessionRecording?: false | ReplayRemoteConfig;
  surveys?: boolean | unknown[];
  hasFeatureFlags?: boolean;
}

/** Reads data only. Unlike posthog-js, this never executes remote configuration scripts. */
export async function getRemoteConfig(client: MiniHog, assetsHost?: string): Promise<RemoteConfig | undefined> {
  if (client.hasOptedOut()) return;
  const current = context(client);
  const host = (
    assetsHost ?? client.apiHost.replace(/^https:\/\/(us|eu)\.i\.posthog\.com$/, 'https://$1-assets.i.posthog.com')
  ).replace(/\/+$/, '');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), current.options.requestTimeoutMs ?? 10000);
  const unsubscribe = client.onConsentChange((enabled) => {
    if (!enabled) controller.abort();
  });
  try {
    const response = await (current.options.fetch ?? fetch)(
      `${host}/array/${encodeURIComponent(client.token)}/config`,
      {
        credentials: 'omit',
        signal: controller.signal
      }
    );
    if (!response.ok) throw new Error(`MiniHog configuration request failed: HTTP ${response.status}.`);
    const config = (await response.json()) as RemoteConfig;
    return client.hasOptedOut() ? undefined : config;
  } catch (cause) {
    current.error(cause);
    return undefined;
  } finally {
    clearTimeout(timer);
    unsubscribe();
  }
}
