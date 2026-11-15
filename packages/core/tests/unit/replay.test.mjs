// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { fixture } from './helpers.mjs';
import { startSessionReplay } from '../../src/replay.ts';

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

test('replay masks inputs, uses separate ingestion and preserves snapshot session metadata', (t) => {
  const { client, events } = fixture(t);
  const controller = startSessionReplay(client, { plugins: [{ name: 'test' }], maskTextSelector: '.private' });
  expect(controller.isRecording()).toBe(true);
  const options = recorder.record.mock.calls[0][0];
  expect(options).toMatchObject({
    maskAllInputs: true,
    blockClass: 'ph-no-capture',
    blockSelector: '.ph-sensitive,[data-private]',
    maskTextSelector: '.private',
    recordCanvas: false
  });
  options.emit(snapshot({ node: 'safe' }));
  controller.flush();
  expect(events[0]).toMatchObject({
    event: '$snapshot',
    properties: {
      $lib: 'web',
      $session_id: client.getSessionId(),
      $window_id: client.getWindowId(),
      $snapshot_data: [{ type: 2, data: { node: 'safe' } }]
    }
  });
  expect(events[0].properties.$snapshot_bytes).toBeGreaterThan(0);
  controller.stop();
  controller.stop();
  options.emit(snapshot());
  controller.flush();
  expect(events).toHaveLength(1);
  expect(recorder.stop).toHaveBeenCalledTimes(1);
});

test('idle recordings pause and resume only after activity, with throttled session touches', async (t) => {
  const { client } = fixture(t);
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

test('consent removes pending snapshots and restarting refreshes recorder ownership', (t) => {
  const { client, events } = fixture(t);
  const replay = startSessionReplay(client);
  const emit = recorder.record.mock.calls[0][0].emit;
  emit(snapshot());
  client.optOut();
  emit(snapshot());
  window.dispatchEvent(new Event('pointerdown'));
  replay.flush();
  expect(events).toHaveLength(0);
  expect(replay.isRecording()).toBe(false);
  client.optIn();
  expect(replay.isRecording()).toBe(true);
  recorder.record.mock.calls.at(-1)[0].emit(snapshot());
  client.reset();
  expect(events[0].properties.$session_id).not.toBe(client.getSessionId());
  replay.stop();
  client.optOut();
  client.optIn();
  expect(replay.isRecording()).toBe(false);
});

test('minimum duration buffers snapshots, size limits flush, and excess buffering stops recording', async (t) => {
  const { client, events, errors } = fixture(t);
  const replay = startSessionReplay(client, { minimumDurationMs: 2000 });
  const emit = recorder.record.mock.calls[0][0].emit;
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
  recorder.record.mock.calls.at(-1)[0].emit(snapshot('x'.repeat(1024 * 1024)));
  await vi.advanceTimersByTimeAsync(0);
  expect(huge.isRecording()).toBe(false);
  expect(errors[0].message).toContain('1 MiB');
});

test('hidden and pagehide flush snapshots; visible transitions do not flush', async (t) => {
  const { client, events } = fixture(t);
  startSessionReplay(client, { maskAllInputs: false, blockSelector: '.custom', recordCanvas: true });
  const emit = recorder.record.mock.calls[0][0].emit;
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

test('sampling, unsupported startup and recorder exceptions leave no active owner', (t) => {
  const { client, errors } = fixture(t);
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
  expect(recorder.record.mock.calls.at(-1)[0].errorHandler(Error('observer failed'))).toBe(true);
  const other = fixture(t);
  const duplicate = startSessionReplay(other.client);
  expect(duplicate.isRecording()).toBe(false);
  expect(other.errors[0].message).toContain('Only one');
  duplicate.stop();
  expect(active.isRecording()).toBe(true);
  active.stop();
  expect(errors.map((e) => e.message)).toEqual(['recorder failed', 'observer failed']);
});
