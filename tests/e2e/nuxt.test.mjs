import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const remote = JSON.parse(
  await readFile(new URL('../../packages/nuxt/tests/fixtures/portfolio-config.json', import.meta.url), 'utf8')
);

async function intercept(page, config = remote) {
  const events = [];
  const requests = [];
  const scripts = [];
  page.on('request', (request) => {
    if (request.resourceType() === 'script') scripts.push(request.url());
  });
  await page.route('**/api/_ph/**', async (route) => {
    const request = route.request();
    requests.push(request.url());
    if (request.method() === 'POST') {
      const payload = request.postDataJSON();
      events.push(...(Array.isArray(payload) ? payload : (payload.batch ?? [])));
    }
    await route.fulfill({ json: request.url().includes('/config') ? config : { status: 1 } });
  });
  return { events, requests, scripts };
}
async function open(page, url = '/') {
  await page.goto(url);
  await expect(page.locator('main')).toHaveAttribute('data-hydrated', 'true');
}
const snapshots = (events) =>
  events.filter((event) => event.event === '$snapshot').flatMap((event) => event.properties.$snapshot_data);

test('packed module preserves delayed startup, SPA events, masked replay and diagnostics', async ({ page }) => {
  const { events, requests, scripts } = await intercept(page);
  await open(page);
  expect(requests).toHaveLength(0);
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('running');
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
  expect(replay).not.toContain('PRIVATE_REPLAY_VALUE');
  expect(scripts.every((url) => new URL(url).hostname === '127.0.0.1')).toBe(true);
  expect(requests.every((url) => !/\/static\/|\.js(?:\?|$)/.test(url))).toBe(true);
});

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
