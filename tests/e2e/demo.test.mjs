import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir } from 'node:fs/promises';

test.use({ baseURL: 'http://127.0.0.1:4319' });

test('landing installs either package, supports animation pause and links to docs', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('.hero-art canvas')).toBeVisible();
  await page.getByRole('button', { name: 'Pause animation' }).click();
  await expect(page.getByRole('button', { name: 'Play animation' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Nuxt', exact: true }).click();
  await expect(page.locator('.install-box code')).toHaveText('pnpm add @minihog/nuxt');
  await page.getByRole('button', { name: 'Copy Terminal code' }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('pnpm add @minihog/nuxt');
  await page.getByRole('link', { name: 'Get started' }).click();
  await expect(page).toHaveURL(/\/docs$/);
  await page.getByRole('button', { name: 'Nuxt', exact: true }).click();
  await expect(page.locator('#installation')).toContainText("modules: ['@minihog/nuxt']");
  expect(errors).toEqual([]);
});

test('playground captures events, honors consent and evaluates flags without sending telemetry', async ({ page }) => {
  const telemetry = [];
  page.on('request', (request) => {
    if (/local-demo|api\/_ph|posthog\.com/.test(request.url())) telemetry.push(request.url());
  });
  await page.goto('/playground');
  const capture = page.getByRole('button', { name: 'Capture event', exact: true });
  await capture.click();
  await expect(page.locator('.event-json')).toContainText('project_opened');
  await page.getByRole('button', { name: 'Identify demo person' }).click();
  await expect(page.locator('.identity-list')).toContainText('demo-person');
  await page.getByRole('button', { name: 'Opt out', exact: true }).click();
  await capture.click();
  await expect(page.locator('.feedback')).toHaveText('Capture blocked by opt-out.');
  await page.getByRole('button', { name: 'Opt in', exact: true }).click();
  await page.locator('#variant').selectOption('test');
  await page.getByRole('button', { name: 'Evaluate flag' }).click();
  await expect(page.locator('.flag-result')).toContainText('Hello there');
  await page.getByRole('button', { name: 'Reset identity' }).click();
  await expect(page.locator('.identity-list')).not.toContainText('demo-person');
  await capture.click();
  await page.getByRole('button', { name: 'Flush queue' }).click();
  await expect(page.locator('.small')).not.toContainText('0 events');
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await page.getByRole('link', { name: 'Docs', exact: true }).click();
  expect(telemetry).toEqual([]);
});

for (const route of ['/', '/docs', '/playground']) {
  test(`${route} is accessible and fits desktop and mobile screens`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await mkdir('output/playwright', { recursive: true });
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(route);
      await expect(page.locator('main')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (width !== 320)
        await page.screenshot({
          path: `output/playwright/${route === '/' ? 'landing' : route.slice(1)}-${width}.png`,
          fullPage: true
        });
    }
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(results.violations).toEqual([]);
  });
}
