import assert from 'node:assert/strict';
import { test } from 'vitest';
import { createController } from '../../src/runtime/controller.ts';
import type { MiniHog } from 'minihog';
import type { PublicOptions } from '../../src/types.js';

const config: PublicOptions = { key: 'test', proxyPath: '/api/_ph', start: 'manual', client: {} };
type Initializer = Awaited<ReturnType<Parameters<typeof createController>[1]>>;
const unexpectedError = (error: unknown) => assert.fail(error instanceof Error ? error : String(error));
const mockClient = (destroy: MiniHog['destroy'] = async () => {}) => ({ destroy }) as MiniHog;
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { resolve, promise };
};

test('no key means no SDK import; concurrent starts initialize once', async () => {
  let imports = 0;
  const client = mockClient();
  const load = async () => {
    imports++;
    return async () => client;
  };
  assert.equal(await createController({ ...config, key: '' }, load, unexpectedError).start(), undefined);
  assert.equal(imports, 0);
  const controller = createController(config, load, unexpectedError);
  const first = controller.start();
  assert.equal(first, controller.start());
  assert.equal(await first, client);
  assert.equal(await controller.start(), client);
  assert.equal(imports, 1);
});

test('stopping during import cancels initialization', async () => {
  const loading = deferred<Initializer>();
  let started = 0;
  const controller = createController(config, () => loading.promise, unexpectedError);
  const start = controller.start();
  const stop = controller.stop();
  loading.resolve(async () => {
    started++;
    return mockClient();
  });
  await Promise.all([start, stop]);
  assert.equal(started, 0);
  assert.equal(controller.getClient(), undefined);
});

test('stopping during initialization disposes the late client and permits a fresh start', async () => {
  const initializing = deferred<MiniHog>();
  let disposals = 0;
  let calls = 0;
  const fresh = mockClient();
  const controller = createController(
    config,
    async () => async () => (++calls === 1 ? initializing.promise : fresh),
    unexpectedError
  );
  const first = controller.start();
  await new Promise((done) => setImmediate(done));
  const stop = controller.stop();
  const second = controller.start();
  initializing.resolve(
    mockClient(async () => {
      disposals++;
    })
  );
  await Promise.all([first, second, stop]);
  assert.equal(disposals, 1);
  assert.equal(controller.getClient(), fresh);
});

test('initialization failures do not reject application startup and can be retried', async () => {
  let calls = 0;
  const errors: unknown[] = [];
  const client = mockClient();
  const controller = createController(
    config,
    async () => {
      if (++calls === 1) throw Error('offline');
      return async () => client;
    },
    (error) => errors.push(error)
  );
  assert.equal(await controller.start(), undefined);
  assert.equal(await controller.start(), client);
  assert.equal(errors.length, 1);
});
