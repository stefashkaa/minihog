// @vitest-environment jsdom
import { expect, test, vi } from 'vitest';
import { fixture } from './helpers.ts';
import { networkTimingPlugin } from '../../src/replay-network.ts';
import { startWebVitals } from '../../src/web-vitals.ts';
import { startErrorCapture } from '../../src/errors.ts';

const metrics = vi.hoisted(() => ({ onCLS: vi.fn(), onFCP: vi.fn(), onINP: vi.fn(), onLCP: vi.fn() }));
vi.mock('web-vitals', () => ({ onCLS: metrics.onCLS, onFCP: metrics.onFCP }));
vi.mock('web-vitals/attribution', () => ({ onINP: metrics.onINP, onLCP: metrics.onLCP }));

test('web vitals preserve scalar attribution, filter metrics and stop on teardown or opt-out', () => {
  const { client, events } = fixture();
  const stop = startWebVitals(client);
  const report = metrics.onLCP.mock.calls.at(-1)![0];
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
  expect(events[0]!.properties.$web_vitals_LCP_event).toHaveProperty('attribution', {
    target: '#image',
    elementRenderDelay: 2
  });
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
  let callback!: (list: Pick<PerformanceObserverEntryList, 'getEntries'>) => void;
  const observe = vi.fn();
  const disconnect = vi.fn();
  class Observer {
    static supportedEntryTypes = ['navigation', 'resource', 'paint'];
    constructor(fn: typeof callback) {
      callback = fn;
    }
    observe = observe;
    disconnect = disconnect;
  }
  vi.stubGlobal('PerformanceObserver', Observer);
  const entry = (name: string, entryType = 'resource'): PerformanceEntry => ({
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
  type ObserverWindow = Parameters<NonNullable<ReturnType<typeof networkTimingPlugin>['observer']>>[1];
  const observer = networkTimingPlugin('/api/_ph').observer!;
  const stop = observer(report, win as ObserverWindow, {});
  expect(report.mock.calls[0]![0].requests).toHaveLength(2);
  expect(report.mock.calls[0]![0].requests[0]!).toMatchObject({
    timestamp: 1001,
    startTime: 1,
    endTime: 12,
    isInitial: true
  });
  callback({ getEntries: () => [entry('/next', 'navigation')] });
  expect(report.mock.calls[1]![0].isInitial).toBe(false);
  callback({ getEntries: () => [] });
  expect(report).toHaveBeenCalledTimes(2);
  stop();
  expect(disconnect).toHaveBeenCalled();
  Observer.supportedEntryTypes = [];
  observer(
    report,
    {
      ...win,
      performance: { ...win.performance, getEntries: () => [] }
    } as unknown as ObserverWindow,
    {}
  )();
  expect(observe).toHaveBeenCalledTimes(1);
  vi.stubGlobal('PerformanceObserver', undefined);
  observer(report, win as ObserverWindow, {})();
});

test('global error capture ignores resource errors and removes every listener', () => {
  const { client, events } = fixture();
  const stop = startErrorCapture(client);
  window.dispatchEvent(new ErrorEvent('error', { error: new TypeError('broken') }));
  window.dispatchEvent(new ErrorEvent('error'));
  const rejection = new Event('unhandledrejection');
  Object.defineProperty(rejection, 'reason', { value: 'rejected' });
  window.dispatchEvent(rejection);
  expect(events).toHaveLength(2);
  expect(events[0]!.properties).toHaveProperty('$exception_list.0.mechanism.handled', false);
  stop();
  window.dispatchEvent(rejection);
  expect(events).toHaveLength(2);
});
