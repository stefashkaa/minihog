export type Properties = Record<string, unknown>;
export type Cleanup = () => void;

export interface CaptureEvent {
  event: string;
  uuid: string;
  timestamp: string;
  properties: Properties & { distinct_id: string };
}

export interface CaptureOptions {
  timestamp?: Date;
  /** Passive diagnostics must not keep an idle session alive. */
  passive?: boolean;
  endpoint?: '/batch/' | '/s/';
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface MiniHogOptions {
  apiHost?: string;
  persistence?: 'localStorage' | 'memory';
  storage?: StorageLike;
  persistenceKey?: string;
  /** Imports identity and consent from the default posthog-js storage keys. */
  migratePostHog?: boolean;
  personProfiles?: 'identified_only' | 'always' | 'never';
  optOutByDefault?: boolean;
  respectDnt?: boolean;
  sessionTimeoutMs?: number;
  flushIntervalMs?: number;
  maxQueueBytes?: number;
  maxRetries?: number;
  requestTimeoutMs?: number;
  fetch?: typeof globalThis.fetch;
  beforeSend?: (event: CaptureEvent) => CaptureEvent | null;
  onError?: (error: Error) => void;
}

export interface MiniHog {
  readonly token: string;
  readonly apiHost: string;
  capture(event: string, properties?: Properties, options?: CaptureOptions): CaptureEvent | undefined;
  flush(options?: { beacon?: boolean }): Promise<void>;
  register(properties: Properties): void;
  registerOnce(properties: Properties): void;
  unregister(key: string): void;
  getProperty(key: string): unknown;
  getDistinctId(): string;
  getSessionId(): string;
  touchSession(): string;
  getWindowId(): string;
  reset(resetDeviceId?: boolean): void;
  optIn(): void;
  optOut(): void;
  hasOptedOut(): boolean;
  onConsentChange(listener: (enabled: boolean) => void): Cleanup;
  onSessionChange(listener: (sessionId: string) => void): Cleanup;
  onIdentityChange(listener: () => void): Cleanup;
  addCleanup(cleanup: Cleanup): Cleanup;
  destroy(): Promise<void>;
}
