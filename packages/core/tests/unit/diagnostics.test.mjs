// @vitest-environment jsdom
import { expect, test, vi } from 'vitest';
import { fixture } from './helpers.mjs';
import { networkTimingPlugin } from '../../src/replay-network.ts';
import { startWebVitals } from '../../src/web-vitals.ts';
import { startErrorCapture } from '../../src/errors.ts';

const metrics = vi.hoisted(() => ({ onCLS: vi.fn(), onFCP: vi.fn(), onINP: vi.fn(), onLCP: vi.fn() }));
vi.mock('web-vitals', () => ({ onCLS: metrics.onCLS, onFCP: metrics.onFCP }));
vi.mock('web-vitals/attribution', () => ({ onINP: metrics.onINP, onLCP: metrics.onLCP }));

test('web vitals preserve scalar attribution, filter metrics and stop on teardown or opt-out', (t) => {
  const { client, events } = fixture(t);
  const stop = startWebVitals(client);
  const report = metrics.onLCP.mock.calls.at(-1)[0];
  const metric = {
    name: 'LCP',
    value: 12,
    delta: 1,
    id: 'metric',
    rating: 'good',
    navigationType: 'navigate',
    attribution: { target: '#image', elementRenderDelay: 2, url: {}, privateValue: 'secret' }
  };
  report(metric);
  expect(events[0].properties.$web_vitals_LCP_event.attribution).toEqual({ target: '#image', elementRenderDelay: 2 });
  report({ ...metric, name: 'TTFB' });
  expect(events).toHaveLength(1);
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  report({ ...metric, attribution: undefined });
  expect(events).toHaveLength(2);
  client.optOut();
  report(metric);
  client.optIn();
  stop();
  report(metric);
  expect(events).toHaveLength(2);
  startWebVitals(client, []);
  expect(metrics.onLCP).toHaveBeenCalledTimes(1);
});

test('network diagnostics filter ingestion, invalid URLs and unrelated performance entries', () => {
  let callback;
  const observe = vi.fn();
  const disconnect = vi.fn();
  class Observer {
    static supportedEntryTypes = ['navigation', 'resource', 'paint'];
    constructor(fn) {
      callback = fn;
    }
    observe = observe;
    disconnect = disconnect;
  }
  vi.stubGlobal('PerformanceObserver', Observer);
  const entry = (name, entryType = 'resource') => ({
    name,
    entryType,
    startTime: 1.2,
    duration: 10.7,
    toJSON: () => ({ name, entryType, duration: 10.7 })
  });
  const entries = [
    entry('http://localhost:3000/api/_ph/batch/'),
    entry('http://['),
    entry('/paint', 'paint'),
    entry('/image.jpg'),
    entry('https://other.test/data')
  ];
  const win = {
    location: { href: 'http://localhost:3000/' },
    performance: { timeOrigin: 1000, getEntries: () => entries }
  };
  const report = vi.fn();
  const stop = networkTimingPlugin('/api/_ph').observer(report, win);
  expect(report.mock.calls[0][0].requests).toHaveLength(2);
  expect(report.mock.calls[0][0].requests[0]).toMatchObject({
    timestamp: 1001,
    startTime: 1,
    endTime: 12,
    isInitial: true
  });
  callback({ getEntries: () => [entry('/next', 'navigation')] });
  expect(report.mock.calls[1][0].isInitial).toBe(false);
  callback({ getEntries: () => [] });
  expect(report).toHaveBeenCalledTimes(2);
  stop();
  expect(disconnect).toHaveBeenCalled();
  Observer.supportedEntryTypes = [];
  networkTimingPlugin('/api/_ph').observer(report, {
    ...win,
    performance: { ...win.performance, getEntries: () => [] }
  })();
  expect(observe).toHaveBeenCalledTimes(1);
  vi.stubGlobal('PerformanceObserver', undefined);
  networkTimingPlugin('/api/_ph').observer(report, win)();
});

test('global error capture ignores resource errors and removes every listener', (t) => {
  const { client, events } = fixture(t);
  const stop = startErrorCapture(client);
  window.dispatchEvent(new ErrorEvent('error', { error: new TypeError('broken') }));
  window.dispatchEvent(new ErrorEvent('error'));
  const rejection = new Event('unhandledrejection');
  Object.defineProperty(rejection, 'reason', { value: 'rejected' });
  window.dispatchEvent(rejection);
  expect(events).toHaveLength(2);
  expect(events[0].properties.$exception_list[0].mechanism.handled).toBe(false);
  stop();
  window.dispatchEvent(rejection);
  expect(events).toHaveLength(2);
});
