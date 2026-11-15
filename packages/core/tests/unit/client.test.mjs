import assert from 'node:assert/strict';
import { test, vi } from 'vitest';
import { createMiniHog } from '../../src/index.ts';
import { identify, alias, group, resetGroups, setPersonProperties } from '../../src/identity.ts';
import { getRemoteConfig } from '../../src/remote-config.ts';

function memory(entries = {}) {
  const values = new Map(Object.entries(entries));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key)
  };
}

function fixture(t, options = {}) {
  const requests = [];
  const client = createMiniHog('phc_test', {
    persistence: 'memory',
    flushIntervalMs: 60000,
    fetch: async (url, init) => {
      requests.push({ url, init, body: JSON.parse(init.body) });
      return new Response('{}');
    },
    ...options
  });
  t.onTestFinished(() => client.destroy());
  return { client, requests };
}

test('imports and construction are safe during SSR and make no requests', async (t) => {
  const { client, requests } = fixture(t);
  await import('../../src/browser.ts');
  await import('../../src/replay.ts');
  await import('../../src/web-vitals.ts');
  await client.flush();
  assert.equal(requests.length, 0);
  assert.match(client.getSessionId(), /^[\da-f]{8}-[\da-f]{4}-7[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/);
});

test('capture produces the public batch envelope and snapshots mutable properties', async (t) => {
  const { client, requests } = fixture(t, { apiHost: '/api/_ph/' });
  const properties = { plan: { name: 'free' } };
  client.capture('signup', properties, { timestamp: new Date('2026-01-01T00:00:00Z') });
  properties.plan.name = 'changed';
  await client.flush();
  assert.equal(requests[0].url, '/api/_ph/batch/');
  assert.equal(requests[0].body.api_key, 'phc_test');
  const [event] = requests[0].body.batch;
  assert.equal(event.properties.plan.name, 'free');
  assert.equal(event.properties.$process_person_profile, false);
  assert.equal(event.properties.distinct_id, client.getDistinctId());
  assert.equal(event.timestamp, '2026-01-01T00:00:00.000Z');
  assert.equal(requests[0].init.credentials, 'omit');
});

test('PostHog identity, device, and current session migrate without a new visitor', (t) => {
  const now = Date.now();
  const storage = memory({
    ph_phc_test_posthog: JSON.stringify({
      distinct_id: 'existing-user',
      $device_id: 'device',
      $user_state: 'identified',
      $sesid: [now, 'session', now]
    })
  });
  const { client } = fixture(t, { persistence: 'localStorage', storage });
  assert.equal(client.getDistinctId(), 'existing-user');
  const event = client.capture('continued');
  assert.equal(event.properties.$device_id, 'device');
  assert.equal(event.properties.$session_id, 'session');
  assert.equal(event.properties.$process_person_profile, true);
});

test('existing PostHog opt-out suppresses capture, config requests, and identity writes', async (t) => {
  const storage = memory({ __ph_opt_in_out_phc_test: '0' });
  const { client, requests } = fixture(t, { persistence: 'localStorage', storage });
  assert.equal(client.hasOptedOut(), true);
  assert.equal(client.capture('blocked'), undefined);
  assert.equal(await getRemoteConfig(client), undefined);
  assert.equal(storage.getItem('minihog_phc_test'), null);
  await client.flush();
  assert.equal(requests.length, 0);
  client.optIn();
  client.capture('allowed');
  await client.flush();
  assert.equal(requests.length, 1);
});

test('a persisted logout takes precedence over the old PostHog identity on reload', (t) => {
  const storage = memory({
    ph_phc_test_posthog: JSON.stringify({ distinct_id: 'old-account', $user_state: 'identified', $epp: true })
  });
  const first = fixture(t, { persistence: 'localStorage', storage }).client;
  first.reset();
  const second = fixture(t, { persistence: 'localStorage', storage }).client;
  const event = second.capture('anonymous-after-logout');
  assert.notEqual(second.getDistinctId(), 'old-account');
  assert.equal(event.properties.$is_identified, false);
  assert.equal(event.properties.$process_person_profile, false);
});

test('opt-out clears queued events and prevents retrying an in-flight failure', async (t) => {
  let reject;
  let calls = 0;
  const { client } = fixture(t, {
    fetch: () => {
      calls++;
      return new Promise((_, fail) => {
        reject = fail;
      });
    }
  });
  client.capture('in-flight');
  const pending = client.flush();
  client.capture('queued');
  client.optOut();
  reject(new Error('connection closed'));
  await pending;
  client.optIn();
  await client.flush();
  assert.equal(calls, 1);
});

test('identity links the anonymous visitor once, then supports person and group events', async (t) => {
  const { client, requests } = fixture(t);
  const anonymous = client.getDistinctId();
  identify(client, 'account-1', { name: 'Ada' }, { source: 'docs' });
  identify(client, 'account-1');
  group(client, 'company', 'team-1', { plan: 'pro' });
  client.capture('used-feature');
  resetGroups(client);
  alias(client, 'old-account');
  await client.flush();
  const events = requests[0].body.batch;
  assert.equal(events[0].properties.$anon_distinct_id, anonymous);
  assert.equal(events[1].properties.$anon_distinct_id, undefined);
  assert.equal(events[2].event, '$groupidentify');
  assert.deepEqual(events[3].properties.$groups, { company: 'team-1' });
  assert.equal(events[4].properties.alias, 'old-account');
  client.reset();
  assert.notEqual(client.getDistinctId(), 'account-1');
  assert.equal(client.getProperty('$groups'), undefined);
});

test('passive diagnostics do not extend idle sessions; activity rotates after 30 minutes', (t) => {
  let now = Date.now();
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  const { client } = fixture(t);
  const before = client.getSessionId();
  now += 31 * 60000;
  assert.equal(client.capture('$web_vitals', {}, { passive: true }).properties.$session_id, before);
  assert.notEqual(client.capture('click').properties.$session_id, before);
});

test('setting anonymous person properties does not prevent a later identity merge', async (t) => {
  const { client, requests } = fixture(t);
  const anonymous = client.getDistinctId();
  setPersonProperties(client, { plan: 'free' });
  identify(client, 'signed-in');
  await client.flush();
  assert.equal(requests[0].body.batch[0].properties.$is_identified, false);
  assert.equal(requests[0].body.batch[1].properties.$anon_distinct_id, anonymous);
});

test('a session rotated in another tab is adopted', (t) => {
  let now = Date.now();
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  const storage = memory();
  const first = fixture(t, { storage, persistence: 'localStorage' }).client;
  const second = fixture(t, { storage, persistence: 'localStorage' }).client;
  now += 31 * 60000;
  first.capture('activity');
  assert.equal(second.getSessionId(), first.getSessionId());
});

test('bounded retries keep the same event UUID and permanent failures are dropped', async (t) => {
  const bodies = [];
  let status = 503;
  const { client } = fixture(t, {
    fetch: async (_url, init) => {
      bodies.push(JSON.parse(init.body));
      return new Response('{}', { status });
    }
  });
  client.capture('retry');
  await client.flush();
  status = 200;
  await client.flush();
  assert.equal(bodies[0].batch[0].uuid, bodies[1].batch[0].uuid);
  status = 400;
  client.capture('invalid');
  await client.flush();
  await client.flush();
  assert.equal(bodies.length, 3);
});

test('queue limits and invalid input cannot break the caller', async (t) => {
  const errors = [];
  const { client, requests } = fixture(t, { maxQueueBytes: 1500, onError: (error) => errors.push(error) });
  const cycle = {};
  cycle.self = cycle;
  client.capture('invalid', cycle);
  for (let i = 0; i < 20; i++) client.capture('event', { i });
  await client.flush();
  assert.ok(errors.length > 0);
  assert.ok(requests[0].body.batch.length < 20);
});

test('storage failures fall back to memory; beforeSend can redact or drop events', async (t) => {
  const blockedStorage = {
    getItem() {
      throw Error('blocked');
    },
    setItem() {
      throw Error('blocked');
    },
    removeItem() {
      throw Error('blocked');
    }
  };
  const { client, requests } = fixture(t, {
    storage: blockedStorage,
    persistence: 'localStorage',
    beforeSend: (event) => (event.event === 'private' ? null : event)
  });
  client.capture('private');
  client.capture('public');
  await client.flush();
  assert.equal(requests[0].body.batch.length, 1);
  client.optOut();
  assert.equal(client.hasOptedOut(), true);
});

test('replay uses its separate ingestion envelope and passive session ID', async (t) => {
  const { client, requests } = fixture(t);
  client.capture(
    '$snapshot',
    { $snapshot_data: [{ type: 4, data: {}, timestamp: Date.now() }] },
    { endpoint: '/s/', passive: true }
  );
  await client.flush();
  assert.ok(requests[0].url.endsWith('/s/'));
  assert.equal(requests[0].body[0].properties.token, 'phc_test');
  assert.equal(requests[0].body[0].event, '$snapshot');
});
