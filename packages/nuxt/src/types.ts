import type { MiniHog, MiniHogOptions } from '@minihog/core';
import type { BrowserOptions } from '@minihog/core/browser';

export interface ModuleOptions {
  key?: string;
  host?: string;
  assetsHost?: string;
  proxyPath?: string;
  start?: 'ready' | 'idle' | 'manual';
  browser?: false | BrowserOptions;
  webVitals?: boolean;
  heatmaps?: boolean;
  replay?: boolean;
  consoleRecording?: boolean;
  networkTiming?: boolean;
  errorCapture?: boolean;
  /** Only serializable client options belong in runtime configuration. */
  client?: Pick<
    MiniHogOptions,
    | 'personProfiles'
    | 'persistence'
    | 'migratePostHog'
    | 'optOutByDefault'
    | 'respectDnt'
    | 'sessionTimeoutMs'
    | 'flushIntervalMs'
  >;
}

export interface PublicOptions {
  key: string;
  proxyPath: string;
  start: 'ready' | 'idle' | 'manual';
  client: NonNullable<ModuleOptions['client']>;
}

export interface ProxyOptions {
  host: string;
  assetsHost: string;
  path: string;
}

export interface MiniHogController {
  /** Concurrent calls share one initialization. An empty key performs no imports. */
  start(): Promise<MiniHog | undefined>;
  getClient(): MiniHog | undefined;
  stop(): Promise<void>;
}

declare module '#app' {
  interface NuxtApp {
    $minihog: MiniHogController;
  }
}
declare module 'vue' {
  interface ComponentCustomProperties {
    $minihog: MiniHogController;
  }
}
