import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import type { CaptureEvent } from '@minihog/core';

const remote = JSON.parse(await readFile(new URL('../fixtures/recording-enabled.json', import.meta.url), 'utf8'));

async function intercept(page: Page, config: Record<string, unknown> = remote) {
  const events: CaptureEvent[] = [];
  const requests: string[] = [];
  const scripts: string[] = [];
  page.on('request', (request) => {
    if (request.resourceType() === 'script') scripts.push(request.url());
  });
  await page.route('**/api/_ph/**', async (route) => {
    const request = route.request();
    requests.push(request.url());
    if (request.method() === 'POST') {
      const payload = request.postDataJSON() as CaptureEvent[] | { batch?: CaptureEvent[] };
      events.push(...(Array.isArray(payload) ? payload : (payload.batch ?? [])));
    }
    await route.fulfill({ json: request.url().includes('/config') ? config : { status: 1 } });
  });
  return { events, requests, scripts };
}
async function open(page: Page, url = '/') {
  await page.goto(url);
  await expect(page.locator('main')).toHaveAttribute('data-hydrated', 'true');
}
const snapshots = (events: CaptureEvent[]) =>
  events.filter((event) => event.event === '$snapshot').flatMap((event) => event.properties.$snapshot_data);

async function countRecorderFrames(page: Page) {
  await page.evaluate(() => {
    const create = document.createElement;
    document.documentElement.dataset.recorderFrames = '0';
    document.createElement = ((...args: Parameters<typeof document.createElement>) => {
      if (args[0].toLowerCase() === 'iframe') {
        const root = document.documentElement;
        root.dataset.recorderFrames = String(Number(root.dataset.recorderFrames) + 1);
      }
      return Reflect.apply(create, document, args);
    }) as typeof document.createElement;
  });
}

test('packed module preserves delayed startup, SPA events, masked replay and diagnostics', async ({ page }) => {
  const { events, requests, scripts } = await intercept(page);
  await open(page);
  expect(requests).toHaveLength(0);
  await page.evaluate(() => {
    const style = document.createElement('style');
    style.textContent = '.replay-visible-marker { color: rgb(12, 34, 56); }';
    document.head.append(style);
    const script = document.createElement('script');
    script.type = 'application/json';
    script.id = 'REPLAY_NONVISUAL_SCRIPT';
    script.textContent = '{"data":"not needed for playback"}';
    document.head.append(script);
    document.body.append(document.createComment('REPLAY_NONVISUAL_COMMENT'));
    const visible = document.createElement('p');
    visible.className = 'replay-visible-marker';
    visible.textContent = 'REPLAY_VISIBLE_CONTENT';
    document.body.append(visible);
  });
  await countRecorderFrames(page);
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('running');
  await expect(page.locator('html')).toHaveAttribute('data-recorder-frames', '0');
  await page.evaluate(() => {
    document.querySelector('.replay-visible-marker')!.textContent = 'REPLAY_UPDATED_CONTENT';
  });
  await page.evaluate(() => console.log('REPLAY_CONSOLE_MARKER'));
  await page.getByRole('button', { name: 'Record action' }).click();
  await page.getByRole('link', { name: 'About', exact: true }).click();
  await expect(page).toHaveURL(/\/about$/);
  await page.getByRole('button', { name: 'Record action' }).click();
  await expect.poll(() => snapshots(events).length).toBeGreaterThan(0);
  // Allow the unresponsive-click timer to run before the extension is stopped.
  await page.waitForTimeout(2900);
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('stopped');
  expect(events.filter((event) => event.event === '$pageview')).toHaveLength(2);
  for (const name of ['$autocapture', '$snapshot', '$$heatmap', '$web_vitals', 'example_action'])
    expect(
      events.some((event) => event.event === name),
      name
    ).toBe(true);
  const replay = JSON.stringify(snapshots(events));
  expect(replay).toContain('rrweb/console@1');
  expect(replay).toContain('REPLAY_CONSOLE_MARKER');
  expect(replay).toContain('rrweb/network@1');
  expect(replay).toContain('REPLAY_VISIBLE_CONTENT');
  expect(replay).toContain('REPLAY_UPDATED_CONTENT');
  expect(replay).toContain('rgb(12, 34, 56)');
  expect(replay).not.toContain('REPLAY_NONVISUAL_SCRIPT');
  expect(replay).not.toContain('REPLAY_NONVISUAL_COMMENT');
  expect(replay).not.toContain('PRIVATE_REPLAY_VALUE');
  expect(scripts.every((url) => new URL(url).hostname === '127.0.0.1')).toBe(true);
  expect(requests.every((url) => !/\/static\/|\.js(?:\?|$)/.test(url))).toBe(true);
});

for (const patchedProperty of ['shadowRoot', 'querySelector', 'querySelectorAll', 'querySelector getter'] as const) {
  test(`recorder recovers native DOM access when Element.${patchedProperty} is patched`, async ({ page }) => {
    const { events } = await intercept(page);
    await open(page);
    await page.evaluate((property) => {
      const host = document.createElement('section');
      host.id = 'shadow-fixture';
      const shadow = host.attachShadow({ mode: 'open' });
      shadow.innerHTML =
        '<style>p { color: rgb(12, 34, 56); }</style><p>SHADOW_REPLAY_CONTENT</p><input value="SHADOW_PRIVATE_VALUE">';
      document.body.append(host);
      if (property === 'shadowRoot') {
        Object.defineProperty(Element.prototype, property, { configurable: true, get: () => null });
      } else if (property === 'querySelector getter') {
        const original = Element.prototype.querySelector;
        Object.defineProperty(Element.prototype, 'querySelector', {
          configurable: true,
          get() {
            if (this === Element.prototype) throw new Error('Recorder must not invoke a patched selector getter.');
            return original;
          }
        });
      } else {
        const original = Element.prototype[property];
        Object.defineProperty(Element.prototype, property, {
          configurable: true,
          value: function (this: Element, selectors: string) {
            return Reflect.apply(original, this, [selectors]);
          }
        });
      }
    }, patchedProperty);
    await countRecorderFrames(page);
    await page.getByRole('button', { name: 'Start', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText('running');
    await expect(page.locator('html')).toHaveAttribute('data-recorder-frames', '1');
    await page.evaluate(() => console.info('SHADOW_REPLAY_CONSOLE'));
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText('stopped');
    const replay = JSON.stringify(snapshots(events));
    expect(replay).toContain('SHADOW_REPLAY_CONTENT');
    expect(replay).toContain('rgb(12, 34, 56)');
    expect(replay).toContain('"isShadow":true');
    expect(replay).not.toContain('SHADOW_PRIVATE_VALUE');
    expect(replay).toContain('SHADOW_REPLAY_CONSOLE');
    expect(replay).toContain('rrweb/network@1');
  });
}

test('consent stops requests and opt-in restarts capture', async ({ page }) => {
  const { events, requests } = await intercept(page);
  await open(page);
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('running');
  await page.getByRole('button', { name: 'Opt out' }).click();
  await expect(page.getByRole('status')).toHaveText('opted out');
  const count = requests.length;
  await page.getByRole('button', { name: 'Record action' }).click();
  await page.getByRole('button', { name: 'Flush', exact: true }).click();
  await page.waitForTimeout(1100);
  expect(requests).toHaveLength(count);
  await page.getByRole('button', { name: 'Opt in' }).click();
  await expect.poll(() => snapshots(events).length).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
});

test('unsupported remote targeting does not silently broaden collection', async ({ page }) => {
  const { events } = await intercept(page, {
    ...remote,
    sessionRecording: { linkedFlag: 'restricted' },
    heatmaps: { urlAllowlistEnforced: true }
  });
  await open(page);
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('running');
  await page.getByRole('button', { name: 'Record action' }).click();
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  expect(events.some((e) => e.event === '$pageview')).toBe(true);
  expect(events.some((e) => e.event === '$snapshot' || e.event === '$$heatmap')).toBe(false);
});

test('missing project key leaves analytics implementation unloaded', async ({ page }) => {
  const { requests, scripts } = await intercept(page);
  await open(page, 'http://127.0.0.1:4318/');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('disabled');
  expect(requests).toHaveLength(0);
  for (const url of scripts) {
    const source = await (await page.request.get(url)).text();
    expect(source).not.toMatch(/MiniHog requires|rrweb|\$web_vitals_/);
  }
});
