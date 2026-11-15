import { expect, test, vi } from 'vitest';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { createApp, toNodeListener } from 'h3';
import handler from '../../src/runtime/server/proxy.ts';
import { useRuntimeConfig } from '../mocks/imports.ts';
import { limitedBody } from '../../src/runtime/server/body.ts';

vi.mock('../../src/runtime/server/body.ts', async (original) => ({
  limitedBody: vi.fn((await original()).limitedBody)
}));

async function server(t) {
  useRuntimeConfig.mockReturnValue({
    minihog: { host: 'https://ingest.test', assetsHost: 'https://assets.test', path: '/tracking' }
  });
  const app = createServer(toNodeListener(createApp().use(handler)));
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
  t.onTestFinished(
    () =>
      new Promise((resolve) => {
        app.closeAllConnections();
        app.close(resolve);
      })
  );
  const nativeFetch = globalThis.fetch;
  return (path, init) => nativeFetch(`http://127.0.0.1:${app.address().port}/tracking${path}`, init);
}

test('proxy forwards public context and query strings without cookies, credentials or stale encoding', async (t) => {
  const request = await server(t);
  const upstream = vi.fn().mockResolvedValue(
    new Response('{"ok":true}', {
      status: 202,
      headers: {
        'content-type': 'application/json',
        'retry-after': '2',
        'set-cookie': 'private',
        'content-encoding': 'gzip',
        'content-length': '999'
      }
    })
  );
  vi.stubGlobal('fetch', upstream);
  const response = await request('/flags/?v=2', {
    method: 'POST',
    body: '{}',
    headers: {
      cookie: 'site=secret',
      authorization: 'Bearer secret',
      origin: 'https://site.test',
      'x-forwarded-for': '192.0.2.1'
    }
  });
  expect(response.status).toBe(202);
  expect(await response.json()).toEqual({ ok: true });
  const [url, init] = upstream.mock.calls[0];
  expect(url).toBe('https://ingest.test/flags/?v=2');
  expect(init).toMatchObject({ body: '{}', method: 'POST', redirect: 'error' });
  expect(init.headers.cookie).toBeUndefined();
  expect(init.headers.authorization).toBeUndefined();
  expect(init.headers.origin).toBe('https://site.test');
  expect(response.headers.get('set-cookie')).toBeNull();
  expect(response.headers.get('content-encoding')).toBeNull();
  expect(response.headers.get('retry-after')).toBe('2');
  expect(response.headers.get('cache-control')).toBe('no-store');
});

test('proxy restricts endpoints and methods and streams configuration responses', async (t) => {
  const request = await server(t);
  const upstream = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', upstream);
  expect((await request('/static/file.js')).status).toBe(404);
  expect((await request('/batch/')).status).toBe(404);
  expect((await request('/array/token/config')).status).toBe(204);
  expect(upstream.mock.calls[0][0]).toBe('https://assets.test/array/token/config');
  expect(upstream).toHaveBeenCalledTimes(1);
});

test('oversized fixed and chunked uploads return 413 and the next request still succeeds', async (t) => {
  const request = await server(t);
  const upstream = vi.fn().mockResolvedValue(Response.json({}));
  vi.stubGlobal('fetch', upstream);
  expect((await request('/batch/', { method: 'POST', body: 'x'.repeat(2 * 1024 * 1024 + 1) })).status).toBe(413);
  const body = Readable.toWeb(Readable.from([Buffer.alloc(1024 * 1024), Buffer.alloc(1024 * 1024 + 1)]));
  expect((await request('/s/', { method: 'POST', body, duplex: 'half' })).status).toBe(413);
  expect((await request('/batch/', { method: 'POST', body: '{}' })).status).toBe(200);
  expect(upstream).toHaveBeenCalledTimes(1);
});

test('upstream and body read failures return errors without crashing the server', async (t) => {
  const request = await server(t);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(Error('offline')));
  expect((await request('/batch/', { method: 'POST', body: '{}' })).status).toBe(502);
  limitedBody.mockRejectedValueOnce(Error('broken stream'));
  expect((await request('/batch/', { method: 'POST', body: '{}' })).status).toBe(500);
});
