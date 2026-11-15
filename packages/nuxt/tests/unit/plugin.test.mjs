import { beforeEach, expect, test, vi } from 'vitest';
import plugin from '../../src/runtime/plugin.ts';
import { useMiniHog } from '../../src/runtime/composable.ts';
import { onNuxtReady, useRuntimeConfig, useNuxtApp } from '../mocks/app.ts';
import { initialize } from '../mocks/init.ts';

beforeEach(() => {
  vi.clearAllMocks();
  useRuntimeConfig.mockReturnValue({
    public: { minihog: { key: 'test', proxyPath: '/tracking', start: 'manual', client: {} } }
  });
  initialize.mockResolvedValue({ destroy: vi.fn() });
});

test('SSR provides a no-op controller; composable returns the injected controller', async () => {
  const { provide } = plugin.setup();
  expect(await provide.minihog.start()).toBeUndefined();
  expect(initialize).not.toHaveBeenCalled();
  useNuxtApp.mockReturnValue({ $minihog: provide.minihog });
  expect(useMiniHog()).toBe(provide.minihog);
});

test('manual mode never schedules startup and reports initialization errors', async () => {
  vi.stubGlobal('window', {});
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const { provide } = plugin.setup();
  expect(onNuxtReady).not.toHaveBeenCalled();
  initialize.mockRejectedValueOnce(Error('offline'));
  expect(await provide.minihog.start()).toBeUndefined();
  expect(warn).toHaveBeenCalled();
  const client = await provide.minihog.start();
  expect(client).toBeDefined();
  await provide.minihog.stop();
  expect(client.destroy).toHaveBeenCalled();
});

test.each(['ready', 'idle'])(
  '%s mode starts after Nuxt readiness, falling back without requestIdleCallback',
  async (start) => {
    vi.stubGlobal('window', {});
    useRuntimeConfig().public.minihog.start = start;
    const { provide } = plugin.setup();
    expect(initialize).not.toHaveBeenCalled();
    onNuxtReady.mock.calls[0][0]();
    await provide.minihog.start();
    expect(initialize).toHaveBeenCalledTimes(1);
    expect(initialize.mock.calls[0][1]()).toBe(true);
    await provide.minihog.stop();
    expect(initialize.mock.calls[0][1]()).toBe(false);
  }
);

test('idle mode waits for requestIdleCallback with a bounded timeout', async () => {
  const idle = vi.fn();
  vi.stubGlobal('window', { requestIdleCallback: idle });
  useRuntimeConfig().public.minihog.start = 'idle';
  const { provide } = plugin.setup();
  onNuxtReady.mock.calls[0][0]();
  expect(idle.mock.calls[0][1]).toEqual({ timeout: 2000 });
  expect(initialize).not.toHaveBeenCalled();
  idle.mock.calls[0][0]();
  await provide.minihog.start();
  expect(initialize).toHaveBeenCalledTimes(1);
});
