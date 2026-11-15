import assert from 'node:assert/strict';
import { test } from 'vitest';
import { createController } from '../../src/runtime/controller.ts';

const config = { key: 'test', proxyPath: '/api/_ph', start: 'manual', client: {} };
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { resolve, promise };
};

test('no key means no SDK import; concurrent starts initialize once', async () => {
  let imports = 0;
  const client = { destroy: async () => {} };
  const load = async () => {
    imports++;
    return async () => client;
  };
  assert.equal(await createController({ ...config, key: '' }, load, assert.fail).start(), undefined);
  assert.equal(imports, 0);
  const controller = createController(config, load, assert.fail);
  const first = controller.start();
  assert.equal(first, controller.start());
  assert.equal(await first, client);
  assert.equal(await controller.start(), client);
  assert.equal(imports, 1);
});

test('stopping during import cancels initialization', async () => {
  const loading = deferred();
  let started = 0;
  const controller = createController(config, () => loading.promise, assert.fail);
  const start = controller.start();
  const stop = controller.stop();
  loading.resolve(async () => {
    started++;
    return { destroy: async () => {} };
  });
  await Promise.all([start, stop]);
  assert.equal(started, 0);
  assert.equal(controller.getClient(), undefined);
});

test('stopping during initialization disposes the late client and permits a fresh start', async () => {
  const initializing = deferred();
  let disposals = 0;
  let calls = 0;
  const fresh = { destroy: async () => {} };
  const controller = createController(
    config,
    async () => async () => (++calls === 1 ? initializing.promise : fresh),
    assert.fail
  );
  const first = controller.start();
  await new Promise((done) => setImmediate(done));
  const stop = controller.stop();
  const second = controller.start();
  initializing.resolve({
    destroy: async () => {
      disposals++;
    }
  });
  await Promise.all([first, second, stop]);
  assert.equal(disposals, 1);
  assert.equal(controller.getClient(), fresh);
});

test('initialization failures do not reject application startup and can be retried', async () => {
  let calls = 0;
  const errors = [];
  const client = { destroy: async () => {} };
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
