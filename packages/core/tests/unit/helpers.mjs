import { createMiniHog } from '../../src/index.ts';
import { onTestFinished } from 'vitest';

export function fixture(_t, options = {}) {
  const events = [];
  const errors = [];
  const requests = [];
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

export function memory(entries = {}) {
  const values = new Map(Object.entries(entries));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key)
  };
}
