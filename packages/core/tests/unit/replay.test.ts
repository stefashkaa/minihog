// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { fixture } from './helpers.ts';
import { startSessionReplay } from '../../src/replay.ts';
import type { CaptureEvent } from '../../src/types.js';

const recorder = vi.hoisted(() => ({ record: vi.fn(), stop: vi.fn() }));
vi.mock('@rrweb/record', () => ({ record: recorder.record }));
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1000000);
  recorder.record.mockReset().mockReturnValue(recorder.stop);
  recorder.stop.mockReset();
});
afterEach(() => vi.useRealTimers());
const snapshot = (data = {}) => ({ type: 2, data, timestamp: Date.now() });

test('replay serializes captured snapshots once and preserves Unicode and JSON escaping on the wire', async () => {
  const { client, requests } = fixture({ beforeSend: undefined });
  const replay = startSessionReplay(client);
  const text = 'Grüße 💛 \\"},"token":"not-a-token"';
  let reads = 0;
  const data = {
    get text() {
      reads++;
      return text;
    }
  };
  recorder.record.mock.calls[0]![0].emit(snapshot(data));
  expect(reads).toBe(1);
  replay.flush();
  await client.flush();
  expect(reads).toBe(1);
  const body = JSON.parse(requests[0]!.body as string);
  expect(body[0].properties.$snapshot_data).toEqual([snapshot({ text })]);
  expect(body[0].properties.token).toBe('test');
  expect(body[0].properties.$snapshot_bytes).toBe(new TextEncoder().encode(JSON.stringify(snapshot({ text }))).length);
});

test('beforeSend can inspect, redact, replace and drop buffered replay data', async () => {
  const beforeSend = vi.fn((event: CaptureEvent) => {
    if (beforeSend.mock.calls.length === 2) return null;
    expect(Array.isArray(event.properties.$snapshot_data)).toBe(true);
    return { ...event, properties: { ...event.properties, $snapshot_data: [snapshot({ redacted: true })] } };
  });
  const { client, requests } = fixture({ beforeSend });
  const replay = startSessionReplay(client);
  const emit = recorder.record.mock.calls[0]![0].emit;
  emit(snapshot({ private: 'PRIVATE_VALUE' }));
  replay.flush();
  emit(snapshot({ private: 'DROP_ME' }));
  replay.flush();
  await client.flush();
  expect(beforeSend).toHaveBeenCalledTimes(2);
  expect(requests).toHaveLength(1);
  const body = requests[0]!.body as string;
  expect(body).not.toMatch(/PRIVATE_VALUE|DROP_ME/);
  expect(JSON.parse(body)[0].properties.$snapshot_data).toEqual([snapshot({ redacted: true })]);
});

test('replay masks inputs, uses separate ingestion and preserves snapshot session metadata', () => {
  const { client, events } = fixture();
  const controller = startSessionReplay(client, {
    plugins: [{ name: 'test', options: {} }],
    maskTextSelector: '.private'
  });
  expect(controller.isRecording()).toBe(true);
  const options = recorder.record.mock.calls[0]![0];
  expect(options).toMatchObject({
    maskAllInputs: true,
    blockClass: 'ph-no-capture',
    blockSelector: '.ph-sensitive,[data-private]',
    maskTextSelector: '.private',
    recordCanvas: false,
    slimDOMOptions: { script: true, comment: true, headWhitespace: true }
  });
  options.emit(snapshot({ node: 'safe' }));
  controller.flush();
  expect(events[0]!).toMatchObject({
    event: '$snapshot',
    properties: {
      $lib: 'web',
      $session_id: client.getSessionId(),
      $window_id: client.getWindowId(),
      $snapshot_data: [{ type: 2, data: { node: 'safe' } }]
    }
  });
  expect(events[0]!.properties.$snapshot_bytes).toBeGreaterThan(0);
  controller.stop();
  controller.stop();
  options.emit(snapshot());
  controller.flush();
  expect(events).toHaveLength(1);
  expect(recorder.stop).toHaveBeenCalledTimes(1);
});

test('idle recordings pause and resume only after activity, with throttled session touches', async () => {
  const { client } = fixture();
  const touch = vi.spyOn(client, 'touchSession');
  const controller = startSessionReplay(client, { idleTimeoutMs: 1000 });
  await vi.advanceTimersByTimeAsync(1001);
  expect(controller.isRecording()).toBe(false);
  window.dispatchEvent(new Event('pointermove'));
  window.dispatchEvent(new Event('pointerdown'));
  expect(controller.isRecording()).toBe(true);
  expect(touch).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1001);
  expect(controller.isRecording()).toBe(false);
  client.reset();
  expect(controller.isRecording()).toBe(false);
  window.dispatchEvent(new Event('keydown'));
  expect(controller.isRecording()).toBe(true);
  await vi.advanceTimersByTimeAsync(1000);
  window.dispatchEvent(new Event('scroll'));
  expect(recorder.record).toHaveBeenCalledTimes(4);
});

test('consent removes pending snapshots and restarting refreshes recorder ownership', () => {
  const { client, events } = fixture();
  const replay = startSessionReplay(client);
  const emit = recorder.record.mock.calls[0]![0].emit;
  emit(snapshot());
  client.optOut();
  emit(snapshot());
  window.dispatchEvent(new Event('pointerdown'));
  replay.flush();
  expect(events).toHaveLength(0);
  expect(replay.isRecording()).toBe(false);
  client.optIn();
  expect(replay.isRecording()).toBe(true);
  recorder.record.mock.calls.at(-1)![0].emit(snapshot());
  client.reset();
  expect(events[0]!.properties.$session_id).not.toBe(client.getSessionId());
  replay.stop();
  client.optOut();
  client.optIn();
  expect(replay.isRecording()).toBe(false);
});

test('minimum duration buffers snapshots, size limits flush, and excess buffering stops recording', async () => {
  const { client, events, errors } = fixture();
  const replay = startSessionReplay(client, { minimumDurationMs: 2000 });
  const emit = recorder.record.mock.calls[0]![0].emit;
  emit(snapshot());
  await vi.advanceTimersByTimeAsync(1000);
  expect(events).toHaveLength(0);
  await vi.advanceTimersByTimeAsync(1001);
  replay.flush();
  expect(events).toHaveLength(1);
  emit(snapshot('x'.repeat(30000)));
  emit(snapshot('x'.repeat(30000)));
  expect(events).toHaveLength(2);
  replay.stop();
  const huge = startSessionReplay(client, { minimumDurationMs: 999999 });
  recorder.record.mock.calls.at(-1)![0].emit(snapshot('x'.repeat(1024 * 1024)));
  await vi.advanceTimersByTimeAsync(0);
  expect(huge.isRecording()).toBe(false);
  expect(errors[0]!.message).toContain('1 MiB');
});

test('hidden and pagehide flush snapshots; visible transitions do not flush', async () => {
  const { client, events } = fixture();
  startSessionReplay(client, {
    maskAllInputs: false,
    blockSelector: '.custom',
    recordCanvas: true,
    slimDOMOptions: {}
  });
  expect(recorder.record.mock.calls[0]![0].slimDOMOptions).toEqual({});
  const emit = recorder.record.mock.calls[0]![0].emit;
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  emit(snapshot());
  document.dispatchEvent(new Event('visibilitychange'));
  expect(events).toHaveLength(0);
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  document.dispatchEvent(new Event('visibilitychange'));
  expect(events).toHaveLength(1);
  emit(snapshot());
  window.dispatchEvent(new Event('pagehide'));
  expect(events).toHaveLength(2);
  emit(snapshot());
  await vi.advanceTimersByTimeAsync(1000);
  expect(events).toHaveLength(3);
});

test('sampling, unsupported startup and recorder exceptions leave no active owner', () => {
  const { client, errors } = fixture();
  for (const rate of [-1, 2, NaN, Infinity])
    expect(() => startSessionReplay(client, { sampleRate: rate })).toThrow('sampleRate');
  const excluded = startSessionReplay(client, { sampleRate: 0 });
  expect(excluded.isRecording()).toBe(false);
  excluded.stop();
  recorder.record.mockReturnValueOnce(undefined);
  const missing = startSessionReplay(client);
  expect(missing.isRecording()).toBe(false);
  missing.stop();
  recorder.record.mockImplementationOnce(() => {
    throw Error('recorder failed');
  });
  const failed = startSessionReplay(client);
  expect(failed.isRecording()).toBe(false);
  failed.stop();
  const active = startSessionReplay(client);
  expect(recorder.record.mock.calls.at(-1)![0].errorHandler(Error('observer failed'))).toBe(true);
  const other = fixture();
  const duplicate = startSessionReplay(other.client);
  expect(duplicate.isRecording()).toBe(false);
  expect(other.errors[0]!.message).toContain('Only one');
  duplicate.stop();
  expect(active.isRecording()).toBe(true);
  active.stop();
  expect(errors.map((e) => e.message)).toEqual(['recorder failed', 'observer failed']);
});
