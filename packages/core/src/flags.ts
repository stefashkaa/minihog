import { context } from './internal/state.js';
import type { MiniHog, Properties } from './types.js';

export type FlagValue = boolean | string;
interface Flag {
  enabled: boolean;
  variant?: string | null;
  metadata?: { id?: number; version?: number; payload?: unknown };
}
interface FlagsResponse {
  flags?: Record<string, Flag>;
  requestId?: string;
  errorsWhileComputingFlags?: boolean;
  quotaLimited?: string[];
}
export interface FeatureFlagOptions {
  bootstrap?: Record<string, FlagValue>;
  personProperties?: Properties;
  groupProperties?: Record<string, Properties>;
  evaluationContexts?: string[];
}

export function createFeatureFlags(client: MiniHog, options: FeatureFlagOptions = {}) {
  const current = context(client);
  let values: Record<string, FlagValue> = { ...options.bootstrap };
  let response: FlagsResponse = {};
  let generation = 0;
  let stopped = false;
  let request: AbortController | undefined;
  const called = new Set<string>();
  const registered = new Set<string>();
  function registerFlags() {
    for (const key of registered) client.unregister(key);
    registered.clear();
    const properties: Properties = {
      $active_feature_flags: Object.keys(values).filter((key) => values[key] !== false)
    };
    for (const [key, value] of Object.entries(values)) {
      properties[`$feature/${key}`] = value;
      registered.add(`$feature/${key}`);
    }
    client.register(properties);
  }
  const listeners = new Set<(flags: Readonly<Record<string, FlagValue>>) => void>();
  const notify = () => {
    for (const listener of listeners) {
      try {
        listener({ ...values });
      } catch (error) {
        current.error(error);
      }
    }
  };

  async function reload(): Promise<Readonly<Record<string, FlagValue>>> {
    request?.abort();
    const version = ++generation;
    if (client.hasOptedOut() || stopped) return {};
    const controller = new AbortController();
    request = controller;
    const timer = setTimeout(() => controller.abort(), current.options.requestTimeoutMs ?? 10000);
    try {
      const result = await (current.options.fetch ?? fetch)(`${client.apiHost}/flags/?v=2`, {
        method: 'POST',
        credentials: 'omit',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: client.token,
          distinct_id: client.getDistinctId(),
          groups: client.getProperty('$groups') ?? {},
          person_properties: options.personProperties,
          group_properties: options.groupProperties,
          evaluation_contexts: options.evaluationContexts
        })
      });
      if (!result.ok) throw new Error(`MiniHog flags request failed: HTTP ${result.status}.`);
      const data = (await result.json()) as FlagsResponse;
      if (version !== generation || stopped || client.hasOptedOut()) return { ...values };
      if (data.errorsWhileComputingFlags || data.quotaLimited?.includes('feature_flags'))
        throw new Error('PostHog could not evaluate all requested feature flags.');
      response = data;
      values = {};
      for (const [key, flag] of Object.entries(data.flags ?? {}))
        values[key] = flag.enabled ? (flag.variant ?? true) : false;
      registerFlags();
      notify();
    } catch (error) {
      if (version === generation && !stopped) current.error(error);
    } finally {
      clearTimeout(timer);
    }
    return { ...values };
  }

  function getFeatureFlag(key: string, sendEvent = true): FlagValue | undefined {
    if (client.hasOptedOut() || stopped) return;
    const value = Object.hasOwn(values, key) ? values[key] : undefined;
    const dedup = JSON.stringify([client.getDistinctId(), client.getSessionId(), key, value]);
    if (sendEvent && value !== undefined && !called.has(dedup)) {
      called.add(dedup);
      client.capture('$feature_flag_called', {
        $feature_flag: key,
        $feature_flag_response: value,
        $feature_flag_id: response.flags?.[key]?.metadata?.id,
        $feature_flag_version: response.flags?.[key]?.metadata?.version,
        $feature_flag_request_id: response.requestId
      });
    }
    return value;
  }

  function invalidate() {
    generation++;
    request?.abort();
    values = {};
    registerFlags();
    response = {};
    called.clear();
    notify();
  }
  const identity = client.onIdentityChange(() => {
    invalidate();
    void reload();
  });
  const consent = client.onConsentChange((enabled) => {
    invalidate();
    if (enabled) void reload();
  });
  const destroy = () => {
    stopped = true;
    invalidate();
    identity();
    consent();
    listeners.clear();
    unregister();
  };
  const unregister = client.addCleanup(destroy);
  registerFlags();
  return {
    reload,
    getFeatureFlag,
    isFeatureEnabled: (key: string) => {
      const value = getFeatureFlag(key);
      return value === undefined ? undefined : value !== false;
    },
    getFeatureFlagPayload(key: string): unknown {
      if (getFeatureFlag(key) === undefined) return;
      const payload = response.flags?.[key]?.metadata?.payload;
      if (typeof payload !== 'string') return payload;
      try {
        return JSON.parse(payload);
      } catch {
        return payload;
      }
    },
    onFeatureFlags(listener: (flags: Readonly<Record<string, FlagValue>>) => void) {
      listeners.add(listener);
      listener({ ...values });
      return () => {
        listeners.delete(listener);
      };
    },
    destroy
  };
}
