import { afterEach, expect, test, vi, type TestContext } from 'vitest';
import { createTransport } from '../../src/internal/transport.ts';
import type { MiniHogOptions } from '../../src/types.js';

afterEach(() => vi.useRealTimers());
function transport(t: TestContext, options: MiniHogOptions = {}, native = false) {
  const errors: unknown[] = [];
  const request = vi.fn().mockResolvedValue(new Response('{}'));
  if (native) vi.stubGlobal('fetch', request);
  const transport = createTransport('test', '/proxy', { fetch: native ? undefined : request, ...options }, (error) =>
    errors.push(error)
  );
  t.onTestFinished(() => transport.stop());
  return { ...transport, request, errors };
}
const event = (n = 1, extra = '') => ({
  event: 'event',
  properties: { distinct_id: 'id', n, extra },
  timestamp: '2026-01-01T00:00:00Z',
  uuid: String(n)
});

test('periodic flushing, queue count bounds, oversized events and stopped transport', async (t) => {
  vi.useFakeTimers();
  const sender = transport(t);
  for (let i = 0; i < 1001; i++) sender.enqueue(event(i), '/batch/');
  expect(sender.errors).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(3000);
  expect(sender.request.mock.calls.flatMap(([, init]) => JSON.parse(init.body).batch)).toHaveLength(1000);
  sender.enqueue(event(1, 'x'.repeat(3 * 1024 * 1024)), '/batch/');
  expect(sender.errors.at(-1)).toHaveProperty('message', expect.stringContaining('byte limit'));
  sender.stop();
  sender.enqueue(event(), '/batch/');
  await sender.flush();
});

test.each([408, 429, 503])('retryable HTTP %s preserves event identity and caps attempts', async (status) => {
  const errors: unknown[] = [];
  const request = vi.fn().mockResolvedValue(new Response('', { status }));
  const sender = createTransport('test', '/proxy', { fetch: request, maxRetries: 1 }, (e) => errors.push(e));
  sender.enqueue(event(), '/batch/');
  await sender.flush();
  await sender.flush();
  await sender.flush();
  sender.stop();
  expect(request).toHaveBeenCalledTimes(2);
  expect(errors).toHaveLength(2);
  expect(request.mock.calls[0]![1].body).toBe(request.mock.calls[1]![1].body);
});

test('pending flush drains new events and beacon flush can run during a pending request', async (t) => {
  const sender = transport(t, {}, true);
  let resolve!: (response: Response) => void;
  sender.request.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      })
  );
  sender.enqueue(event(1), '/batch/');
  const first = sender.flush();
  sender.enqueue(event(2), '/s/');
  const second = sender.flush();
  const beacon = vi.fn().mockReturnValue(true);
  vi.stubGlobal('navigator', { sendBeacon: beacon });
  await sender.flush(true);
  expect(beacon).toHaveBeenCalledTimes(1);
  resolve(new Response('{}'));
  await Promise.all([first, second]);
  sender.enqueue(event(3), '/batch/');
  const third = sender.flush();
  sender.enqueue(event(4), '/batch/');
  await sender.flush();
  await third;
  expect(sender.request).toHaveBeenCalledTimes(3);
});

test('beacon budget and rejected beacons fall back to fetch without oversized keepalive', async (t) => {
  const sender = transport(t, {}, true);
  const beacon = vi.fn().mockReturnValueOnce(true).mockReturnValue(false);
  vi.stubGlobal('navigator', { sendBeacon: beacon });
  sender.enqueue(event(1, 'x'.repeat(40000)), '/batch/');
  sender.enqueue(event(2, 'x'.repeat(40000)), '/batch/');
  await sender.flush(true);
  expect(beacon).toHaveBeenCalledTimes(1);
  expect(sender.request.mock.calls[0]![1].keepalive).toBe(true);
  sender.enqueue(event(3), '/s/');
  await sender.flush(true);
  expect(beacon).toHaveBeenCalledTimes(2);
  sender.enqueue(event(4, 'x'.repeat(70000)), '/batch/');
  await sender.flush(true);
  expect(sender.request.mock.calls.at(-1)![1].keepalive).toBe(false);
});

test('timeouts abort fetch; retry does not displace new queued events', async (t) => {
  vi.useFakeTimers();
  const sender = transport(t, { maxQueueBytes: 1000, requestTimeoutMs: 10 });
  sender.request.mockImplementationOnce(
    (_url, init) =>
      new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(Error('timeout'))))
  );
  sender.enqueue(event(1, 'x'.repeat(400)), '/batch/');
  const pending = sender.flush();
  sender.enqueue(event(2, 'x'.repeat(700)), '/batch/');
  await vi.advanceTimersByTimeAsync(10);
  await pending;
  expect(sender.errors[0]).toHaveProperty('message', 'timeout');
  await sender.flush();
  expect(JSON.parse(sender.request.mock.calls[1]![1].body).batch[0].properties.n).toBe(2);
});

test('stopping or clearing an in-flight request prevents retries', async (t) => {
  const sender = transport(t);
  let reject!: (error: Error) => void;
  sender.request.mockImplementation(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      })
  );
  sender.enqueue(event(), '/batch/');
  const pending = sender.flush();
  sender.stop();
  reject(Error('offline'));
  await pending;
  expect(sender.errors).toHaveLength(0);
});

test('custom fetch owns unload delivery instead of bypassing its transport', async (t) => {
  const sender = transport(t);
  const beacon = vi.fn();
  vi.stubGlobal('navigator', { sendBeacon: beacon });
  sender.enqueue(event(), '/batch/');
  await sender.flush(true);
  expect(sender.request).toHaveBeenCalledTimes(1);
  expect(beacon).not.toHaveBeenCalled();
});
