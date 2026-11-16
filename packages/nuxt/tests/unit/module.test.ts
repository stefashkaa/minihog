import assert from 'node:assert/strict';
import { test } from 'vitest';
import { initializerSource } from '../../src/templates.ts';
import { proxyTarget } from '../../src/runtime/server/routing.ts';

const options = { host: 'https://eu.i.posthog.com', assetsHost: 'https://eu-assets.i.posthog.com', path: '/api/_ph' };
const target = (path: string, method = 'GET') => proxyTarget(new URL(`https://site.test${path}`), method, options);

test('proxy routes public endpoints and preserves queries', () => {
  assert.equal(target('/api/_ph/flags/?v=2&config=true', 'POST'), 'https://eu.i.posthog.com/flags/?v=2&config=true');
  assert.equal(target('/api/_ph/batch/', 'POST'), 'https://eu.i.posthog.com/batch/');
  assert.equal(target('/api/_ph/s/', 'POST'), 'https://eu.i.posthog.com/s/');
  assert.equal(target('/api/_ph/array/phc_public/config'), 'https://eu-assets.i.posthog.com/array/phc_public/config');
  assert.equal(target('/api/_ph/api/surveys/?token=public'), 'https://eu.i.posthog.com/api/surveys/?token=public');
});

test('proxy rejects scripts, management endpoints, traversal, and wrong methods', () => {
  for (const path of [
    '/api/_ph/static/recorder.ts',
    '/api/_ph/api/projects/',
    '/api/_ph/../batch/',
    '/api/_ph//evil.test/batch/',
    '/api/_ph/%2f%2fevil.test/batch/',
    '/api/_ph/array/token/config.ts',
    '/api/other/batch/'
  ])
    assert.equal(target(path, 'POST'), undefined);
  assert.equal(target('/api/_ph/batch/'), undefined);
  assert.equal(target('/api/_ph/array/token/config', 'POST'), undefined);
});

test('disabled feature imports are absent from generated initialization', () => {
  const source = initializerSource({});
  assert.ok(source.includes('@minihog/core/browser'));
  for (const feature of ['replay', 'web-vitals', 'surveys', 'flags', 'errors'])
    assert.equal(source.includes(`@minihog/core/${feature}`), false);
  assert.equal(initializerSource({ browser: false }).includes('@minihog/core/browser'), false);
});

test('enabled replay includes only the selected diagnostic imports', () => {
  const source = initializerSource({ replay: true });
  assert.ok(source.includes('@minihog/core/replay'));
  assert.equal(source.includes('@minihog/core/replay-console'), false);
  assert.equal(source.includes('@minihog/core/replay-network'), false);
  assert.ok(
    initializerSource({ replay: true, consoleRecording: true, networkTiming: true }).includes(
      '@minihog/core/replay-network'
    )
  );
});
