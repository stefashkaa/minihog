import assert from 'node:assert/strict';
import { test } from 'vitest';
import { Readable } from 'node:stream';
import { finished } from 'node:stream/promises';
import { createServer } from 'node:http';
import { limitedBody } from '../../src/runtime/server/body.ts';

test('UTF-8 characters survive chunk boundaries', async () => {
  const bytes = new TextEncoder().encode('hello 👋');
  const stream = Readable.from([bytes.slice(0, 7), bytes.slice(7)]);
  assert.equal(await limitedBody(stream, 100), 'hello 👋');
});

test('oversized chunked requests drain without cancelling the response socket', async () => {
  const stream = Readable.from([new Uint8Array(10), new Uint8Array(10), new Uint8Array(10)], { autoDestroy: false });
  await assert.rejects(limitedBody(stream, 15), RangeError);
  await finished(stream);
  assert.equal(stream.readableEnded, true);
  assert.equal(stream.destroyed, false);
});

test('an oversized HTTP upload returns 413 and leaves the server usable', async (t) => {
  const server = createServer(async (request, response) => {
    try {
      response.end(await limitedBody(request, 16));
    } catch (error) {
      response.statusCode = error instanceof RangeError ? 413 : 500;
      response.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.onTestFinished(() => {
    server.closeAllConnections();
    server.close();
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}`;
  const body = Readable.toWeb(Readable.from([new Uint8Array(10), new Uint8Array(10), new Uint8Array(10)]));
  // Node and DOM declarations use distinct Web Stream types for the same runtime object.
  const init: RequestInit & { duplex: 'half' } = { method: 'POST', body: body as unknown as BodyInit, duplex: 'half' };
  const oversized = await fetch(url, init);
  assert.equal(oversized.status, 413);
  const next = await fetch(url, { method: 'POST', body: 'still running' });
  assert.equal(await next.text(), 'still running');
});
