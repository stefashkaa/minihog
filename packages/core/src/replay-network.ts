import type { record } from '@rrweb/record';

type RecorderOptions = NonNullable<Parameters<typeof record>[0]>;
type RecorderPlugin = NonNullable<RecorderOptions['plugins']>[number];

/** Resource timings only; never wraps fetch/XHR or reads request/response bodies. */
export function networkTimingPlugin(ingestionHost: string): RecorderPlugin {
  return {
    name: 'rrweb/network@1',
    options: {},
    observer(callback, win) {
      if (typeof PerformanceObserver === 'undefined') return () => {};
      const host = new URL(ingestionHost, win.location.href);
      const emit = (entries: PerformanceEntry[], isInitial = false) => {
        const requests = entries
          .filter((entry) => {
            if (entry.entryType !== 'resource' && entry.entryType !== 'navigation') return false;
            try {
              const url = new URL(entry.name, win.location.href);
              return !(url.origin === host.origin && url.pathname.startsWith(`${host.pathname.replace(/\/$/, '')}/`));
            } catch {
              return false;
            }
          })
          .map((entry) => ({
            ...entry.toJSON(),
            timeOrigin: win.performance.timeOrigin,
            timestamp: Math.round(win.performance.timeOrigin + entry.startTime),
            startTime: Math.round(entry.startTime),
            endTime: Math.round(entry.startTime + entry.duration),
            isInitial
          }));
        if (requests.length) callback({ requests, isInitial });
      };
      emit(win.performance.getEntries(), true);
      const observer = new PerformanceObserver((list) => emit(list.getEntries()));
      const entryTypes = PerformanceObserver.supportedEntryTypes.filter(
        (type) => type === 'resource' || type === 'navigation'
      );
      if (entryTypes.length) observer.observe({ entryTypes });
      return () => observer.disconnect();
    }
  };
}
