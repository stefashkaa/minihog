// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { startBrowserCapture } from '../../src/browser.ts';
import { fixture } from './helpers.ts';
import type { Properties } from '../../src/types.js';

beforeEach(() => {
  history.replaceState({}, '', '/?utm_source=docs&gclid=ad&ignored=private');
  document.body.innerHTML = '';
});
afterEach(() => vi.useRealTimers());
const tick = () => new Promise<void>((resolve) => queueMicrotask(resolve));
const click = (node: EventTarget | null, x = 1) =>
  node!.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x }));

test.each([
  ['Mozilla Windows Edg/130', 'Microsoft Edge', 'Windows', 'Desktop'],
  ['Mozilla Linux Firefox/120', 'Firefox', 'Linux', 'Desktop'],
  ['Mozilla Android Chrome/120 Mobile', 'Chrome', 'Android', 'Mobile'],
  ['Mozilla iPhone Version/18 Safari/', 'Safari', 'iOS', 'Mobile'],
  ['Mozilla iPad Version/18 Safari/', 'Safari', 'iOS', 'Tablet'],
  ['Mozilla Mac Chrome/120', 'Chrome', 'Mac OS X', 'Desktop'],
  ['Custom', 'Other', 'Other', 'Desktop']
])('attributes browser %s without extra requests', (agent, browser, os, device) => {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(agent);
  const { client, events, requests } = fixture();
  startBrowserCapture(client);
  expect(events[0]!.properties).toMatchObject({
    $browser: browser,
    $os: os,
    $device_type: device,
    utm_source: 'docs',
    gclid: 'ad',
    $initial_referrer: '$direct'
  });
  expect(events[0]!.properties.ignored).toBeUndefined();
  expect(requests).toHaveLength(0);
});

test.each(['https://search.example/path', 'not a URL'])(
  'preserves referrer and handles malformed values: %s',
  (referrer) => {
    vi.spyOn(document, 'referrer', 'get').mockReturnValue(referrer);
    const { client } = fixture();
    startBrowserCapture(client);
    expect(client.getProperty('$referring_domain')).toBe(referrer.startsWith('https') ? 'search.example' : '$direct');
  }
);

test('SPA navigation deduplicates history events, tracks scroll and bfcache, and restores hooks', async () => {
  const { client, events } = fixture();
  const original = history.pushState;
  const stop = startBrowserCapture(client);
  vi.stubGlobal('scrollY', 500);
  vi.spyOn(document.documentElement, 'scrollHeight', 'get').mockReturnValue(2000);
  window.dispatchEvent(new Event('scroll'));
  history.pushState({}, '', '/next');
  history.replaceState({}, '', '/next');
  await tick();
  window.dispatchEvent(new Event('hashchange'));
  expect(events.filter((e) => e.event === '$pageview')).toHaveLength(2);
  expect(events[1]!.properties.$prev_pageview_max_scroll).toBe(500);
  window.dispatchEvent(new Event('pagehide'));
  window.dispatchEvent(new Event('pagehide'));
  window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: false }));
  expect(events.filter((e) => e.event === '$pageleave')).toHaveLength(1);
  window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
  expect(events.filter((e) => e.event === '$pageview')).toHaveLength(3);
  vi.stubGlobal('innerWidth', 1234);
  window.dispatchEvent(new Event('resize'));
  expect(client.getProperty('$viewport_width')).toBe(1234);
  history.pushState({}, '', '/queued');
  stop();
  await tick();
  expect(history.pushState).toBe(original);
  expect(events.filter((e) => e.event === '$pageview')).toHaveLength(3);
});

test('leaves a newer history wrapper intact during cleanup', () => {
  const { client } = fixture();
  const original = history.pushState;
  const stop = startBrowserCapture(client);
  const newer = vi.fn();
  history.pushState = newer;
  stop();
  expect(history.pushState).toBe(newer);
  history.pushState = original;
});

test('consent and session changes refresh attribution without duplicate views', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(1000000);
  const { client, events } = fixture();
  startBrowserCapture(client);
  client.optOut();
  history.pushState({}, '', '/blocked');
  await tick();
  window.dispatchEvent(new Event('pagehide'));
  expect(events).toHaveLength(1);
  client.optIn();
  expect(events.filter((e) => e.event === '$pageview')).toHaveLength(2);
  vi.spyOn(Date, 'now').mockReturnValue(10000000);
  history.pushState({}, '', '/session');
  await tick();
  expect(client.getProperty('$session_entry_pathname')).toBe('/session');
  expect(events.at(-1)!.properties.$prev_pageview_id).toBeUndefined();
});

test('autocapture records selectors and safe text, suppresses private content and input values', () => {
  document.body.innerHTML =
    '<div><i></i><button id="first" class="z a">Save</button><button><span>Next</span></button><a href="#">Link</a><button>me@example.com</button><button>123456789</button><label><input value="secret"></label><input type="password"><div contenteditable="true">Private</div><div class="ph-sensitive"><button>Private</button></div><div>Plain</div></div>';
  const { client, events } = fixture();
  startBrowserCapture(client);
  for (const node of document.querySelectorAll('button,span,a,label,input,[contenteditable],div')) click(node);
  document.dispatchEvent(new Event('click'));
  const captured = events.filter((e) => e.event === '$autocapture');
  expect(captured[0]!.properties.$elements_chain).toContain('button.a.z:');
  expect(captured[0]!.properties.$elements).toHaveProperty(
    '0',
    expect.objectContaining({
      nth_child: 2,
      nth_of_type: 1,
      $el_text: 'Save',
      attr__id: 'first'
    })
  );
  expect(captured.some((e) => (e.properties.$elements as Properties[])[0]!.attr__href)).toBe(true);
  expect(JSON.stringify(captured)).not.toMatch(/secret|me@example|123456789|Private/);
  const before = captured.length;
  client.optOut();
  click(document.querySelector('button'));
  expect(events.filter((e) => e.event === '$autocapture')).toHaveLength(before);
});

test.each(['class="ph-sensitive"', 'class="ph-no-capture"', 'class="nocapture"', 'data-private', 'data-ph-no-capture'])(
  'autocapture never includes private descendant text: %s',
  (attribute) => {
    document.body.innerHTML = `<button><span id="public">Continue</span><span ${attribute}>Secret diagnosis</span></button>`;
    const { client, events } = fixture();
    startBrowserCapture(client);
    click(document.querySelector('#public'));
    const captured = events.find((event) => event.event === '$autocapture');
    expect(captured!.properties).toHaveProperty('$elements.0.$el_text', 'Continue');
    expect(JSON.stringify(captured)).not.toContain('Secret diagnosis');
  }
);

test.each(['click', 'capture'])('idle session rollover establishes a pageview before %s', (interaction) => {
  const now = vi.spyOn(Date, 'now').mockReturnValue(1000000);
  document.body.innerHTML = '<button>Continue</button>';
  const { client, events } = fixture();
  startBrowserCapture(client);
  const first = events[0]!;
  now.mockReturnValue(4000000);
  if (interaction === 'click') click(document.querySelector('button'));
  else client.capture('resumed');
  const views = events.filter((event) => event.event === '$pageview');
  expect(views).toHaveLength(2);
  const resumed = views[1]!;
  expect(resumed.properties.$session_id).not.toBe(first.properties.$session_id);
  expect(resumed.properties.$pageview_id).not.toBe(first.properties.$pageview_id);
  expect(resumed.properties.$prev_pageview_id).toBeUndefined();
  expect(events.at(-1)!.properties.$pageview_id).toBe(resumed.properties.$pageview_id);
  window.dispatchEvent(new Event('pagehide'));
  const leave = events.at(-1)!;
  expect(leave.event).toBe('$pageleave');
  expect(leave.properties.$prev_pageview_id).toBe(resumed.properties.$pageview_id);
  expect(leave.properties.$prev_pageview_duration).toBe(0);
});

test('session rollover during navigation creates exactly one new pageview', async () => {
  const now = vi.spyOn(Date, 'now').mockReturnValue(1000000);
  const { client, events } = fixture();
  startBrowserCapture(client);
  now.mockReturnValue(4000000);
  history.pushState({}, '', '/resumed');
  history.replaceState({}, '', '/resumed');
  await tick();
  const views = events.filter((event) => event.event === '$pageview');
  expect(views).toHaveLength(2);
  expect(views[1]!.properties.$pathname).toBe('/resumed');
  expect(views[1]!.properties.$prev_pageview_id).toBeUndefined();
});

test('rage clicks require nearby clicks without selection and respect disabled options', () => {
  document.body.innerHTML = '<button>Save</button><input><span role="spinbutton">+</span>';
  const { client, events } = fixture();
  const stop = startBrowserCapture(client, { pageviews: false, captureText: false });
  const button = document.querySelector('button')!;
  click(button, 100);
  click(button);
  click(button);
  click(button);
  expect(events.filter((e) => e.event === '$rageclick')).toHaveLength(1);
  for (let i = 0; i < 3; i++) click(document.querySelector('input'));
  vi.spyOn(window.getSelection()!, 'toString').mockReturnValue('selection');
  for (let i = 0; i < 3; i++) click(button);
  expect(events.filter((e) => e.event === '$rageclick')).toHaveLength(1);
  expect(events[0]!.properties.$el_text).toBeUndefined();
  button.dispatchEvent(new Event('change', { bubbles: true }));
  stop();
  startBrowserCapture(client, { pageviews: false, autocapture: false });
  const count = events.length;
  click(button);
  expect(events).toHaveLength(count);
});

test('rage detection can be disabled independently and ignores old clicks', () => {
  document.body.innerHTML = '<button>Save</button>';
  const { client, events } = fixture();
  startBrowserCapture(client, { rageclick: false });
  for (let i = 0; i < 3; i++) click(document.querySelector('button'));
  expect(events.some((e) => e.event === '$rageclick')).toBe(false);
});
