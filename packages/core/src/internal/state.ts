import type { CaptureOptions, Cleanup, MiniHog, MiniHogOptions, Properties, StorageLike } from '../types.js';
import type { SerializedProperty } from './transport.js';

export interface State {
  distinctId: string;
  deviceId: string;
  identified: boolean;
  personProcessing: boolean;
  properties: Properties;
  session: [lastActivity: number, id: string, started: number];
}

export interface Context {
  state: State;
  options: MiniHogOptions;
  storage?: StorageLike;
  save(): void;
  error(error: unknown): void;
  identityChanged(): void;
  captureSerialized(
    name: string,
    properties: Properties,
    serialized: SerializedProperty,
    options: CaptureOptions
  ): void;
  cleanups: Set<Cleanup>;
}

export const contexts = new WeakMap<MiniHog, Context>();

export function context(client: MiniHog): Context {
  const value = contexts.get(client);
  if (!value) throw new Error('This MiniHog client has been destroyed.');
  return value;
}

/** UUIDv7 keeps PostHog session timestamps compatible with its replay ingestion. */
export function uuid(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let time = Date.now();
  for (let i = 5; i >= 0; i--) {
    bytes[i] = time % 256;
    time = Math.floor(time / 256);
  }
  bytes[6] = (bytes[6]! & 15) | 112;
  bytes[8] = (bytes[8]! & 63) | 128;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function read(storage: StorageLike | undefined, key: string): unknown {
  try {
    const value = storage?.getItem(key);
    return value ? JSON.parse(value) : undefined;
  } catch {
    return undefined;
  }
}

export function object(value: unknown): value is Properties {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function browserStorage(): StorageLike | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

export function legacyState(storage: StorageLike | undefined, token: string): Properties | undefined {
  const key = `ph_${token}_posthog`;
  let value = read(storage, key);
  if (!object(value) && typeof document !== 'undefined') {
    try {
      const cookie = document.cookie.split('; ').find((part) => part.startsWith(`${key}=`));
      if (cookie) value = JSON.parse(decodeURIComponent(cookie.slice(key.length + 1)));
    } catch {
      // Malformed or unavailable cookies must not prevent application startup.
    }
  }
  return object(value) ? value : undefined;
}

export function validSession(value: unknown): value is State['session'] {
  return (
    Array.isArray(value) && typeof value[0] === 'number' && typeof value[1] === 'string' && typeof value[2] === 'number'
  );
}
