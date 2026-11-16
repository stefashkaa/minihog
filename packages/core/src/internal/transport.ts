import type { CaptureEvent, MiniHogOptions, Properties } from '../types.js';

interface Pending {
  json: string;
  bytes: number;
  endpoint: '/batch/' | '/s/';
  attempts: number;
}

/** Internal JSON fragment produced by the recorder, never an untrusted string. */
export interface SerializedProperty {
  key: string;
  json: string;
  bytes: number;
}

const encoder = new TextEncoder();
const BEACON_LIMIT = 48 * 1024;

export function createTransport(token: string, host: string, options: MiniHogOptions, error: (error: unknown) => void) {
  let queue: Pending[] = [];
  let queuedBytes = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: Promise<void> | undefined;
  let stopped = false;
  let generation = 0;
  const controllers = new Set<AbortController>();
  const request = options.fetch ?? globalThis.fetch.bind(globalThis);
  const queueLimit = options.maxQueueBytes ?? 2 * 1024 * 1024;
  const batchPrefix = `{"api_key":${JSON.stringify(token)},"batch":`;
  const batchOverhead = encoder.encode(batchPrefix).byteLength + 1;

  function schedule(delay = options.flushIntervalMs ?? 3000) {
    if (!timer && !stopped && queue.length) timer = setTimeout(() => void flush(), delay);
  }

  function clear() {
    generation++;
    queue = [];
    queuedBytes = 0;
    clearTimeout(timer);
    timer = undefined;
    for (const controller of controllers) controller.abort();
  }

  function enqueue(event: CaptureEvent, endpoint: Pending['endpoint'], serialized?: SerializedProperty) {
    if (stopped) return;
    try {
      // Serialize at capture time: callers cannot mutate queued data afterward.
      const { properties: eventProperties, ...envelope } = event;
      const properties: Properties = { ...eventProperties, token };
      if (serialized && typeof properties.toJSON === 'function') {
        // Custom JSON serialization must see the complete properties object.
        properties[serialized.key] = JSON.parse(serialized.json);
        serialized = undefined;
      }
      if (serialized) delete properties[serialized.key];
      let json = JSON.stringify({ ...envelope, properties });
      let bytes = encoder.encode(json).byteLength;
      if (serialized) {
        // properties is last in this envelope. Insert the already serialized value
        // before its closing brace, without traversing the snapshot a second time.
        const field = `,${JSON.stringify(serialized.key)}:`;
        bytes += encoder.encode(field).byteLength + serialized.bytes;
        json = `${json.slice(0, -2)}${field}${serialized.json}}}`;
      }
      if (bytes > queueLimit) throw new Error('MiniHog event exceeds the queue byte limit.');
      while (queue.length && (queuedBytes + bytes > queueLimit || queue.length >= 1000)) {
        queuedBytes -= queue.shift()!.bytes;
        error(new Error('MiniHog queue is full; dropped the oldest event.'));
      }
      queue.push({ json, bytes, endpoint, attempts: 0 });
      queuedBytes += bytes;
      schedule();
    } catch (cause) {
      error(cause);
    }
  }

  async function send(beacon: boolean) {
    const currentGeneration = generation;
    let remaining = queue.length;
    let beaconBytes = 0;
    while (remaining > 0 && queue.length && !stopped && generation === currentGeneration) {
      const endpoint = queue[0]!.endpoint;
      const batch: Pending[] = [];
      let bytes = 0;
      while (remaining > 0 && queue[0]?.endpoint === endpoint) {
        const item = queue[0]!;
        if (batch.length && bytes + item.bytes > BEACON_LIMIT) break;
        batch.push(queue.shift()!);
        queuedBytes -= item.bytes;
        bytes += item.bytes;
        remaining--;
      }
      const events = `[${batch.map((item) => item.json).join(',')}]`;
      const body = endpoint === '/s/' ? events : `${batchPrefix}${events}}`;
      // Reuse UTF-8 sizes measured at capture time; brackets and commas are ASCII.
      const bodyBytes = bytes + batch.length + 1 + (endpoint === '/s/' ? 0 : batchOverhead);
      const url = `${host}${endpoint}`;
      try {
        if (
          beacon &&
          !options.fetch &&
          beaconBytes + bodyBytes < 60 * 1024 &&
          typeof navigator !== 'undefined' &&
          navigator.sendBeacon
        ) {
          if (navigator.sendBeacon(url, new Blob([body], { type: 'text/plain' }))) {
            beaconBytes += bodyBytes;
            continue;
          }
        }
        const controller = new AbortController();
        controllers.add(controller);
        const timeout = setTimeout(() => controller.abort(), options.requestTimeoutMs ?? 10000);
        let response: Response;
        try {
          response = await request(url, {
            method: 'POST',
            body,
            // A CORS-safelisted body also works with the public ingestion endpoints.
            headers: { 'Content-Type': 'text/plain' },
            credentials: 'omit',
            keepalive: beacon && bodyBytes < BEACON_LIMIT,
            signal: controller.signal
          });
        } finally {
          clearTimeout(timeout);
          controllers.delete(controller);
        }
        if (!response.ok) {
          const retryable = response.status === 429 || response.status === 408 || response.status >= 500;
          if (!retryable) {
            error(new Error(`MiniHog ingestion rejected events: HTTP ${response.status}.`));
            continue;
          }
          throw new Error(`MiniHog ingestion temporarily unavailable: HTTP ${response.status}.`);
        }
      } catch (cause) {
        if (generation !== currentGeneration || stopped) return;
        error(cause);
        const retry = batch.filter((item) => ++item.attempts <= (options.maxRetries ?? 3));
        for (const item of retry) {
          if (queuedBytes + item.bytes <= queueLimit) {
            queue.push(item);
            queuedBytes += item.bytes;
          }
        }
        schedule(Math.min(30000, 1000 * 2 ** (batch[0]?.attempts ?? 1)));
        break;
      }
    }
  }

  function flush(beacon = false): Promise<void> {
    clearTimeout(timer);
    timer = undefined;
    if (pending)
      return beacon
        ? send(true)
        : pending.then(() => {
            if (queue.length) return flush();
          });
    pending = send(beacon).finally(() => {
      pending = undefined;
      schedule();
    });
    return pending;
  }

  return {
    enqueue,
    flush,
    clear,
    stop: () => {
      stopped = true;
      clear();
    }
  };
}
