// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { fixture } from './helpers.mjs';
import { startHeatmaps } from '../../src/heatmaps.ts';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1000000);
  history.replaceState({}, '', '/heatmap');
  document.body.innerHTML =
    '<button>Action</button><div style="position:fixed"><span>Fixed</span></div><a href="#">Native</a><input><div data-private><button>Private</button></div>';
});
afterEach(() => vi.useRealTimers());
const mouse = (type, target = document.querySelector('button'), options = {}) =>
  target.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: 10, clientY: 20, ...options }));
const points = (events) => events.flatMap((e) => Object.values(e.properties.$heatmap_data).flat());

test('heatmaps track fixed and document coordinates, rage clicks, movement and dead clicks', async (t) => {
  const { client, events } = fixture(t);
  startHeatmaps(client);
  vi.stubGlobal('scrollX', 100);
  vi.stubGlobal('scrollY', 200);
  mouse('click');
  mouse('click');
  mouse('click');
  mouse('mousemove', document.querySelector('span'));
  await vi.advanceTimersByTimeAsync(500);
  mouse('mousemove', document);
  await vi.advanceTimersByTimeAsync(5000);
  expect(points(events)).toEqual(
    expect.arrayContaining([
      { x: 110, y: 220, type: 'click', target_fixed: false },
      { x: 10, y: 20, type: 'mousemove', target_fixed: true },
      { x: 110, y: 220, type: 'mousemove', target_fixed: false },
      { x: 110, y: 220, type: 'rageclick', target_fixed: false },
      { x: 110, y: 220, type: 'deadclick', target_fixed: false }
    ])
  );
});

test('mutations before the deadline indicate a response; late mutations retain dead clicks', async (t) => {
  const { client, events } = fixture(t);
  const stop = startHeatmaps(client);
  mouse('click');
  document.querySelector('button').title = 'responded';
  await Promise.resolve();
  await vi.advanceTimersByTimeAsync(3000);
  stop();
  expect(points(events).map((p) => p.type)).toEqual(['click']);
  const next = startHeatmaps(client);
  mouse('click');
  await vi.advanceTimersByTimeAsync(2550);
  document.querySelector('button').title = 'late';
  await Promise.resolve();
  next();
  expect(points(events).filter((p) => p.type === 'deadclick')).toHaveLength(1);
});

test('scroll and selection distinguish prompt feedback from late responses', async (t) => {
  const { client, events } = fixture(t);
  const stop = startHeatmaps(client);
  mouse('click');
  document.dispatchEvent(new Event('scroll'));
  await vi.advanceTimersByTimeAsync(1001);
  mouse('click');
  await vi.advanceTimersByTimeAsync(101);
  document.dispatchEvent(new Event('selectionchange'));
  mouse('click');
  await vi.advanceTimersByTimeAsync(3000);
  mouse('mousedown');
  mouse('click');
  await vi.advanceTimersByTimeAsync(2751);
  stop();
  expect(points(events).filter((p) => p.type === 'deadclick')).toHaveLength(2);
});

test('private elements, modifiers, native controls, focus and selected text suppress dead clicks', async (t) => {
  const { client, events } = fixture(t);
  const stop = startHeatmaps(client);
  mouse('click', document);
  mouse('click', document.querySelector('[data-private] button'));
  for (const modifier of ['metaKey', 'ctrlKey', 'shiftKey', 'altKey'])
    mouse('click', undefined, { [modifier]: true, clientX: 100 });
  for (let i = 0; i < 3; i++) mouse('click', document.querySelector('input'), { clientX: 200 });
  mouse('click', document.querySelector('a'));
  window.dispatchEvent(new Event('focus'));
  mouse('click');
  window.dispatchEvent(new Event('blur'));
  await vi.advanceTimersByTimeAsync(1100);
  vi.spyOn(window, 'getSelection').mockReturnValue({ toString: () => 'selected' });
  for (let i = 0; i < 3; i++) mouse('click', document.querySelector('a'), { clientX: 300 });
  await vi.advanceTimersByTimeAsync(3000);
  stop();
  expect(points(events).some((p) => p.type === 'deadclick')).toBe(false);
  expect(points(events).filter((p) => p.x === 300 && p.type === 'rageclick')).toHaveLength(0);
});

test('consent clears unsent points and pending movement; URL changes discard stale movement', async (t) => {
  const { client, events } = fixture(t);
  const stop = startHeatmaps(client);
  mouse('click');
  mouse('mousemove');
  client.optOut();
  mouse('click');
  await vi.advanceTimersByTimeAsync(6000);
  expect(events).toHaveLength(0);
  client.optIn();
  mouse('mousemove');
  history.pushState({}, '', '/next');
  await vi.advanceTimersByTimeAsync(500);
  stop();
  expect(events).toHaveLength(0);
  const next = startHeatmaps(client);
  mouse('mousemove');
  client.optOut();
  await vi.advanceTimersByTimeAsync(500);
  next();
  expect(events).toHaveLength(0);
});

test('visibility and pagehide flush, teardown removes listeners and disconnected targets are ignored', async (t) => {
  const { client, events } = fixture(t);
  const stop = startHeatmaps(client);
  mouse('click');
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  document.dispatchEvent(new Event('visibilitychange'));
  expect(events).toHaveLength(0);
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  document.dispatchEvent(new Event('visibilitychange'));
  expect(events).toHaveLength(1);
  mouse('click');
  window.dispatchEvent(new Event('pagehide'));
  expect(events).toHaveLength(2);
  await vi.advanceTimersByTimeAsync(1001);
  mouse('click');
  // A removed target must not produce a dead-click diagnostic, even without mutation delivery.
  vi.spyOn(document.querySelector('button'), 'isConnected', 'get').mockReturnValue(false);
  await vi.advanceTimersByTimeAsync(2751);
  stop();
  expect(points(events).some((p) => p.type === 'deadclick')).toBe(false);
  mouse('click');
  await vi.advanceTimersByTimeAsync(6000);
  expect(events).toHaveLength(3);
});

test('bounds both candidate retention and batches during dense input', async (t) => {
  document.body.innerHTML = '<a>Link</a>' + '<button>Button</button>'.repeat(51);
  const { client, events } = fixture(t);
  const stop = startHeatmaps(client);
  for (const [i, button] of [...document.querySelectorAll('button')].entries())
    mouse('click', button, { clientX: i * 100 });
  await vi.advanceTimersByTimeAsync(2800);
  stop();
  expect(points(events).filter((p) => p.type === 'deadclick')).toHaveLength(50);
  const next = startHeatmaps(client);
  for (let i = 0; i < 501; i++) mouse('click', document.querySelector('a'), { clientX: i * 100 });
  next();
  expect(points(events).filter((p) => p.type === 'click')).toHaveLength(552);
});
