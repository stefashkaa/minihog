// @vitest-environment jsdom
import { expect, test, vi } from 'vitest';
import { fixture, memory } from './helpers.ts';
import { context, browserStorage, legacyState, read, validSession } from '../../src/internal/state.ts';
import { createMiniHog } from '../../src/index.ts';
import { identify, alias, group, setPersonProperties } from '../../src/identity.ts';

test('validates tokens and keeps property registration independent of prototypes', async () => {
  expect(() => createMiniHog(' ')).toThrow('project token');
  const { client, events } = fixture();
  client.register({ plan: 'pro' });
  client.registerOnce({ plan: 'free', toString: 'owned' });
  expect(client.getProperty('plan')).toBe('pro');
  expect(client.getProperty('toString')).toBe('owned');
  expect(client.capture('')).toBeUndefined();
  const device = client.getDistinctId();
  client.reset(false);
  expect(client.getDistinctId()).toBe(device);
  const cleanup = vi.fn();
  const remove = client.addCleanup(cleanup);
  remove();
  await client.destroy();
  await client.destroy();
  client.reset();
  client.optIn();
  expect(cleanup).not.toHaveBeenCalled();
  expect(client.capture('after destroy')).toBeUndefined();
  expect(() => context(client)).toThrow('destroyed');
  expect(events).toHaveLength(0);
});

test('callback failures are isolated from capture, consent and cleanup', async () => {
  const { client, errors } = fixture({
    beforeSend: () => {
      throw 'redaction failed';
    }
  });
  const off = client.onConsentChange(() => {
    throw Error('observer');
  });
  client.addCleanup(() => {
    throw Error('cleanup');
  });
  client.capture('broken');
  client.optOut();
  off();
  client.optIn();
  await client.destroy();
  expect(errors.map((e) => e.message)).toEqual(['redaction failed', 'observer', 'cleanup']);
  const throwing = fixture({
    onError: () => {
      throw Error('callback');
    },
    beforeSend: () => {
      throw Error('event');
    }
  });
  expect(() => throwing.client.capture('safe')).not.toThrow();
});

test('DNT and default opt-out block capture even after opt-in', () => {
  vi.stubGlobal('navigator', { doNotTrack: '1' });
  const { client } = fixture({ respectDnt: true, optOutByDefault: true });
  client.optIn();
  expect(client.hasOptedOut()).toBe(true);
  expect(client.capture('blocked')).toBeUndefined();
});

test('identity operations obey person profile settings and consent', () => {
  const { client, events } = fixture({ personProfiles: 'never' });
  const original = client.getDistinctId();
  identify(client, 'account');
  setPersonProperties(client, {});
  alias(client, 'other');
  expect(client.getDistinctId()).toBe(original);
  expect(events).toHaveLength(0);
  const allowed = fixture({ personProfiles: 'always' });
  identify(allowed.client, '');
  alias(allowed.client, '');
  alias(allowed.client, allowed.client.getDistinctId());
  group(allowed.client, 'team', 'id');
  setPersonProperties(allowed.client, { name: 'Ada' }, { source: 'test' });
  expect(allowed.events[0]!.properties).toMatchObject({ $set_once: { source: 'test' }, $process_person_profile: true });
  allowed.client.optOut();
  identify(allowed.client, 'private');
  setPersonProperties(allowed.client, {});
  expect(allowed.events).toHaveLength(1);
});

test('migration handles cookies, malformed storage, and inaccessible browser storage', () => {
  const key = 'ph_cookie_posthog';
  document.cookie = key + '=' + encodeURIComponent(JSON.stringify({ distinct_id: 'cookie-user' }));
  expect(legacyState(undefined, 'cookie')!.distinct_id).toBe('cookie-user');
  document.cookie = key + '=%bad';
  expect(legacyState(undefined, 'cookie')).toBeUndefined();
  document.cookie = key + '=; max-age=0';
  expect(legacyState(memory({ ph_test_posthog: '[]' }), 'test')).toBeUndefined();
  expect(read(memory({ bad: '{' }), 'bad')).toBeUndefined();
  for (const value of [undefined, {}, [1], [1, 2, 3], [1, 'id', 'bad']]) expect(validSession(value)).toBe(false);
  expect(browserStorage()).toBe(window.localStorage);
  vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
    throw Error('blocked');
  });
  expect(browserStorage()).toBeUndefined();
  const { client } = fixture({ persistence: 'localStorage', migratePostHog: false, persistenceKey: 'custom' });
  expect(client.getDistinctId()).toBeTruthy();
});

test('storage events synchronize identity, sessions and opt-out across tabs', async () => {
  const storage = memory();
  const { client, requests } = fixture({ storage, persistence: 'localStorage' });
  const identity = vi.fn();
  const session = vi.fn();
  const consent = vi.fn();
  const offIdentity = client.onIdentityChange(identity);
  const offSession = client.onSessionChange(session);
  client.onConsentChange(consent);
  const state = JSON.parse(storage.getItem('minihog_test')!);
  const dispatch = (key: string, newValue: string | null) =>
    window.dispatchEvent(new StorageEvent('storage', { key, newValue }));
  for (const value of [
    {},
    { ...state, distinctId: 1 },
    { ...state, deviceId: 1 },
    { ...state, session: [] },
    { ...state, properties: [] }
  ]) {
    storage.setItem('minihog_test', JSON.stringify(value));
    dispatch('minihog_test', 'changed');
  }
  expect(identity).not.toHaveBeenCalled();
  Object.assign(state, {
    distinctId: 'account',
    deviceId: 'device',
    identified: true,
    personProcessing: true,
    session: [Date.now(), 'new', Date.now()],
    properties: { shared: true }
  });
  storage.setItem('minihog_test', JSON.stringify(state));
  dispatch('minihog_test', 'changed');
  dispatch('minihog_test', 'same');
  expect(client.getDistinctId()).toBe('account');
  expect(client.getProperty('shared')).toBe(true);
  expect(identity).toHaveBeenCalledTimes(1);
  expect(session).toHaveBeenCalledWith('new');
  offIdentity();
  offSession();
  client.capture('queued');
  dispatch('minihog_test_consent', 'false');
  await client.flush();
  expect(requests).toHaveLength(0);
  dispatch('minihog_test', 'ignored');
  dispatch('other', null);
  dispatch('minihog_test_consent', 'true');
  expect(client.hasOptedOut()).toBe(false);
  client.capture('online');
  window.dispatchEvent(new Event('online'));
  await client.flush();
  client.capture('hidden');
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  document.dispatchEvent(new Event('visibilitychange'));
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  document.dispatchEvent(new Event('visibilitychange'));
  await client.flush();
  client.capture('leaving');
  window.dispatchEvent(new Event('pagehide'));
  await client.flush();
  expect(requests).toHaveLength(3);
});
