import { onCLS, onFCP } from 'web-vitals';
import { onINP, onLCP } from 'web-vitals/attribution';
import type { Metric } from 'web-vitals';
import type { Cleanup, MiniHog, Properties } from './types.js';

const allowedAttribution = [
  'interactionTarget',
  'interactionType',
  'inputDelay',
  'processingDuration',
  'presentationDelay',
  'loadState',
  'target',
  'url',
  'timeToFirstByte',
  'resourceLoadDelay',
  'resourceLoadDuration',
  'elementRenderDelay'
];

/** Uses Google's metric algorithms, with PostHog's INP/LCP attribution fields. */
export function startWebVitals(client: MiniHog, allowed = ['CLS', 'FCP', 'INP', 'LCP']): Cleanup {
  if (typeof window === 'undefined') return () => {};
  let active = true;
  const report = (metric: Metric & { attribution?: object }) => {
    if (!active || client.hasOptedOut() || !allowed.includes(metric.name)) return;
    const attribution: Properties = {};
    for (const [name, value] of Object.entries(metric.attribution ?? {})) {
      if (allowedAttribution.includes(name) && (typeof value === 'string' || typeof value === 'number'))
        attribution[name] = value;
    }
    client.capture(
      '$web_vitals',
      {
        [`$web_vitals_${metric.name}_value`]: metric.value,
        [`$web_vitals_${metric.name}_event`]: {
          name: metric.name,
          value: metric.value,
          delta: metric.delta,
          id: metric.id,
          rating: metric.rating,
          navigationType: metric.navigationType,
          attribution,
          $current_url: location.href,
          timestamp: Date.now(),
          $session_id: client.getSessionId(),
          $window_id: client.getWindowId()
        }
      },
      { passive: true }
    );
    if (document.visibilityState === 'hidden') void client.flush({ beacon: true });
  };
  if (allowed.includes('CLS')) onCLS(report);
  if (allowed.includes('FCP')) onFCP(report);
  if (allowed.includes('INP')) onINP(report);
  if (allowed.includes('LCP')) onLCP(report);
  // web-vitals has no unsubscribe API; callbacks become inert on teardown.
  const stop = () => {
    active = false;
    unregister();
  };
  const unregister = client.addCleanup(stop);
  return stop;
}
