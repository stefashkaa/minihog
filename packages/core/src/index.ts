import { browserStorage, contexts, legacyState, object, read, uuid, validSession } from './internal/state.js';
import type { State } from './internal/state.js';
import { createTransport } from './internal/transport.js';
import type { SerializedProperty } from './internal/transport.js';
import { VERSION } from './internal/version.js';
import type { CaptureEvent, CaptureOptions, Cleanup, MiniHog, MiniHogOptions, Properties } from './types.js';

export type {
  CaptureEvent,
  CaptureOptions,
  Cleanup,
  MiniHog,
  MiniHogOptions,
  Properties,
  StorageLike
} from './types.js';

/** No global singleton, DOM instrumentation, remote scripts, or requests at import time. */
export function createMiniHog(token: string, options: MiniHogOptions = {}): MiniHog {
  if (!token.trim()) throw new Error('MiniHog requires a public PostHog project token.');
  const apiHost = (options.apiHost ?? 'https://us.i.posthog.com').replace(/\/+$/, '');
  const storage = options.persistence === 'memory' ? undefined : (options.storage ?? browserStorage());
  const key = options.persistenceKey ?? `minihog_${token}`;
  const consentKey = `${key}_consent`;
  const consent =
    read(storage, consentKey) ??
    (options.migratePostHog !== false ? read(storage, `__ph_opt_in_out_${token}`) : undefined);
  let optedOut = consent === false || consent === 0 || (consent == null && !!options.optOutByDefault);
  const dnt = !!options.respectDnt && typeof navigator !== 'undefined' && navigator.doNotTrack === '1';
  let destroyed = false;
  const stored = read(storage, key);
  const legacy = options.migratePostHog !== false ? legacyState(storage, token) : undefined;
  const initial = object(stored) ? stored : undefined;
  const deviceId =
    typeof initial?.deviceId === 'string'
      ? initial.deviceId
      : typeof legacy?.$device_id === 'string'
        ? legacy.$device_id
        : uuid();
  const now = Date.now();
  const state: State = {
    distinctId:
      typeof initial?.distinctId === 'string'
        ? initial.distinctId
        : typeof legacy?.distinct_id === 'string'
          ? legacy.distinct_id
          : deviceId,
    deviceId,
    identified: initial ? initial.identified === true : legacy?.$user_state === 'identified',
    personProcessing: initial ? initial.personProcessing === true : legacy?.$epp === true,
    properties: object(initial?.properties) ? initial.properties : {},
    session: validSession(initial?.session)
      ? initial.session
      : validSession(legacy?.$sesid)
        ? legacy.$sesid
        : [now, uuid(), now]
  };
  const windowId = uuid();
  const cleanups = new Set<Cleanup>();
  const consentListeners = new Set<(enabled: boolean) => void>();
  const sessionListeners = new Set<(id: string) => void>();
  const identityListeners = new Set<() => void>();
  const timeout = Math.max(60000, options.sessionTimeoutMs ?? 30 * 60 * 1000);
  const error = (cause: unknown) => {
    try {
      options.onError?.(cause instanceof Error ? cause : new Error(String(cause)));
    } catch {
      /* User callbacks cannot break analytics. */
    }
  };
  const notify = <T>(listeners: Set<(value: T) => void>, value: T) => {
    for (const listener of listeners) {
      try {
        listener(value);
      } catch (cause) {
        error(cause);
      }
    }
  };
  const identityChanged = () => notify(identityListeners, undefined);
  const hasOptedOut = () => optedOut || dnt || destroyed;
  const save = () => {
    if (hasOptedOut()) return;
    try {
      storage?.setItem(key, JSON.stringify(state));
    } catch {
      /* Private browsing and quota failures use memory. */
    }
  };
  const transport = createTransport(token, apiHost, options, error);

  function session(active = false) {
    const current = Date.now();
    const persisted = read(storage, key);
    const previous = state.session[1];
    if (object(persisted) && validSession(persisted.session) && persisted.session[0] > state.session[0])
      state.session = persisted.session;
    if (active && (current - state.session[0] > timeout || current - state.session[2] > 86400000))
      state.session = [current, uuid(), current];
    if (active) {
      state.session[0] = current;
      save();
    }
    if (previous !== state.session[1]) notify(sessionListeners, state.session[1]);
    return state.session[1];
  }

  function setConsent(enabled: boolean) {
    if (destroyed) return;
    optedOut = !enabled;
    try {
      storage?.setItem(consentKey, JSON.stringify(enabled));
    } catch {
      /* Consent still applies in memory. */
    }
    if (!enabled) {
      transport.clear();
      try {
        storage?.removeItem(key);
      } catch {
        /* Best effort removal. */
      }
    } else save();
    notify(consentListeners, !hasOptedOut());
  }

  function capture(
    name: string,
    properties: Properties = {},
    captureOptions: CaptureOptions = {},
    serialized?: SerializedProperty
  ): CaptureEvent | undefined {
    if (hasOptedOut() || !name) return;
    try {
      const sessionId = session(!captureOptions.passive);
      let event: CaptureEvent | null = {
        event: name,
        uuid: uuid(),
        timestamp: (captureOptions.timestamp ?? new Date()).toISOString(),
        properties: {
          ...state.properties,
          $lib: 'minihog',
          $lib_version: VERSION,
          $device_id: state.deviceId,
          $session_id: sessionId,
          $window_id: windowId,
          $configured_session_timeout_ms: timeout,
          $is_identified: state.identified,
          $process_person_profile:
            options.personProfiles === 'always' ||
            (options.personProfiles !== 'never' && (state.identified || state.personProcessing)),
          ...properties,
          distinct_id: state.distinctId
        }
      };
      if (options.beforeSend) {
        // Redaction hooks always receive ordinary data and may replace or drop it.
        if (serialized) event.properties[serialized.key] = JSON.parse(serialized.json);
        serialized = undefined;
        event = options.beforeSend(event);
      }
      if (!event) return;
      transport.enqueue(event, captureOptions.endpoint ?? '/batch/', serialized);
      return event;
    } catch (cause) {
      error(cause);
      return;
    }
  }

  const client: MiniHog = {
    token,
    apiHost,
    capture,
    flush: (flushOptions) => transport.flush(flushOptions?.beacon),
    register(properties) {
      Object.assign(state.properties, properties);
      save();
    },
    registerOnce(properties) {
      for (const [name, value] of Object.entries(properties))
        if (!Object.hasOwn(state.properties, name)) state.properties[name] = value;
      save();
    },
    unregister(name) {
      delete state.properties[name];
      save();
    },
    getProperty: (name) => state.properties[name],
    getDistinctId: () => state.distinctId,
    getSessionId: () => session(),
    touchSession: () => session(true),
    getWindowId: () => windowId,
    reset(resetDeviceId = true) {
      if (destroyed) return;
      if (resetDeviceId) state.deviceId = uuid();
      state.distinctId = state.deviceId;
      state.identified = false;
      state.personProcessing = false;
      state.properties = {};
      state.session = [Date.now(), uuid(), Date.now()];
      save();
      identityChanged();
      notify(sessionListeners, state.session[1]);
    },
    optIn: () => setConsent(true),
    optOut: () => setConsent(false),
    hasOptedOut,
    onConsentChange(listener) {
      consentListeners.add(listener);
      return () => consentListeners.delete(listener);
    },
    onSessionChange(listener) {
      sessionListeners.add(listener);
      return () => sessionListeners.delete(listener);
    },
    onIdentityChange(listener) {
      identityListeners.add(listener);
      return () => identityListeners.delete(listener);
    },
    addCleanup(cleanup) {
      cleanups.add(cleanup);
      return () => cleanups.delete(cleanup);
    },
    async destroy() {
      if (destroyed) return;
      for (const cleanup of cleanups) {
        try {
          cleanup();
        } catch (cause) {
          error(cause);
        }
      }
      cleanups.clear();
      destroyed = true;
      await transport.flush();
      transport.stop();
      consentListeners.clear();
      sessionListeners.clear();
      identityListeners.clear();
      contexts.delete(client);
    }
  };
  contexts.set(client, {
    state,
    options,
    storage,
    save,
    error,
    identityChanged,
    cleanups,
    captureSerialized: (name, properties, serialized, captureOptions) => {
      capture(name, properties, captureOptions, serialized);
    }
  });
  save();
  if (typeof window !== 'undefined') {
    const flush = () => void client.flush({ beacon: true });
    const hidden = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    const online = () => void client.flush();
    const changed = (event: StorageEvent) => {
      if (event.key === consentKey) {
        optedOut = event.newValue === 'false';
        if (optedOut) transport.clear();
        notify(consentListeners, !hasOptedOut());
      } else if (event.key === key && event.newValue && !hasOptedOut()) {
        const next = read(storage, key);
        if (
          !object(next) ||
          typeof next.distinctId !== 'string' ||
          typeof next.deviceId !== 'string' ||
          !validSession(next.session) ||
          !object(next.properties)
        )
          return;
        const identityChangedElsewhere = next.distinctId !== state.distinctId;
        const sessionChangedElsewhere = next.session[1] !== state.session[1];
        state.distinctId = next.distinctId;
        state.deviceId = next.deviceId;
        state.identified = next.identified === true;
        state.personProcessing = next.personProcessing === true;
        state.properties = next.properties;
        state.session = next.session;
        if (identityChangedElsewhere) identityChanged();
        if (sessionChangedElsewhere) notify(sessionListeners, state.session[1]);
      }
    };
    window.addEventListener('pagehide', flush);
    window.addEventListener('online', online);
    window.addEventListener('storage', changed);
    document.addEventListener('visibilitychange', hidden);
    cleanups.add(() => {
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('online', online);
      window.removeEventListener('storage', changed);
      document.removeEventListener('visibilitychange', hidden);
    });
  }
  return client;
}
