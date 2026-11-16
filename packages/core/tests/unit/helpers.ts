import { createMiniHog } from '../../src/index.ts';
import { onTestFinished } from 'vitest';
import type { CaptureEvent, MiniHogOptions, StorageLike } from '../../src/types.js';

export interface IngestionBatch {
  api_key: string;
  batch: CaptureEvent[];
}

export function fixture(options: MiniHogOptions = {}) {
  const events: CaptureEvent[] = [];
  const errors: Error[] = [];
  const requests: (RequestInit & { url: Parameters<typeof fetch>[0] })[] = [];
  const client = createMiniHog('test', {
    persistence: 'memory',
    flushIntervalMs: 60000,
    onError: (error) => errors.push(error),
    beforeSend: (event) => {
      events.push(event);
      return event;
    },
    fetch: async (url, init) => {
      requests.push({ url, ...init });
      return new Response('{}');
    },
    ...options
  });
  onTestFinished(() => client.destroy());
  return { client, events, errors, requests };
}

export function memory(entries: Record<string, string> = {}): StorageLike {
  const values = new Map(Object.entries(entries));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key)
  };
}
