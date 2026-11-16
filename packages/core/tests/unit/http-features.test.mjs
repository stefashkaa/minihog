import { expect, test, vi } from 'vitest';
import { fixture } from './helpers.mjs';
import { getRemoteConfig } from '../../src/remote-config.ts';
import { getSurveys, surveySent } from '../../src/surveys.ts';
import { createFeatureFlags } from '../../src/flags.ts';
import { startBrowserCapture } from '../../src/browser.ts';
import { startHeatmaps } from '../../src/heatmaps.ts';
import { startErrorCapture, captureException } from '../../src/errors.ts';
import { startWebVitals } from '../../src/web-vitals.ts';
import { startSessionReplay } from '../../src/replay.ts';
import { consoleRecordingPlugin } from '../../src/replay-console.ts';

test('every optional browser extension can be imported and stopped during SSR', (t) => {
  const { client } = fixture(t);
  for (const start of [startBrowserCapture, startHeatmaps, startErrorCapture, startWebVitals]) start(client)();
  const replay = startSessionReplay(client);
  expect(replay.isRecording()).toBe(false);
  replay.flush();
  replay.stop();
  replay.stop();
  expect(typeof consoleRecordingPlugin).toBe('function');
});

test('remote config uses encoded public token, omits credentials and reports HTTP failures', async (t) => {
  const { client, errors } = fixture(t, { fetch: undefined });
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ surveys: false }))
    .mockResolvedValueOnce(new Response('', { status: 503 }));
  vi.stubGlobal('fetch', fetch);
  expect(await getRemoteConfig(client)).toEqual({ surveys: false });
  expect(fetch.mock.calls[0][0]).toBe('https://us-assets.i.posthog.com/array/test/config');
  expect(fetch.mock.calls[0][1].credentials).toBe('omit');
  expect(await getRemoteConfig(client)).toBeUndefined();
  expect(errors[0].message).toContain('503');
});

test('config requests abort on timeout or consent revocation and discard late responses', async (t) => {
  vi.useFakeTimers();
  t.onTestFinished(() => vi.useRealTimers());
  let signal;
  let resolve;
  const { client, errors } = fixture(t, {
    requestTimeoutMs: 20,
    fetch: (_url, init) => {
      signal = init.signal;
      return new Promise((done) => {
        resolve = done;
      });
    }
  });
  const pending = getRemoteConfig(client);
  await vi.advanceTimersByTimeAsync(20);
  expect(signal.aborted).toBe(true);
  client.optOut();
  resolve(Response.json({ surveys: true }));
  expect(await pending).toBeUndefined();
  expect(errors).toHaveLength(0);
  client.optIn();
  const second = getRemoteConfig(client);
  client.optOut();
  expect(signal.aborted).toBe(true);
  resolve(Response.json({}));
  await second;
});

test.each([
  ['https://eu.i.posthog.com', undefined, 'https://eu-assets.i.posthog.com'],
  ['/api/_ph', undefined, '/api/_ph'],
  ['https://analytics.example', undefined, 'https://analytics.example'],
  ['https://analytics.example', 'https://assets.example/', 'https://assets.example']
])('remote config resolves the correct asset host for %s', async (apiHost, assetsHost, expected, t) => {
  const fetch = vi.fn().mockResolvedValue(Response.json({ surveys: false }));
  const { client } = fixture(t, { apiHost, fetch });
  await getRemoteConfig(client, assetsHost);
  expect(fetch.mock.calls[0][0]).toBe(`${expected}/array/test/config`);
});

test('headless surveys handle consent, missing data, HTTP errors and supplied responses', async (t) => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ surveys: [{ id: 's' }] }))
    .mockResolvedValueOnce(Response.json({}))
    .mockResolvedValueOnce(new Response('', { status: 401 }));
  vi.stubGlobal('fetch', fetch);
  const { client, errors, events } = fixture(t, { fetch: undefined, requestTimeoutMs: 100 });
  expect(await getSurveys(client)).toEqual([{ id: 's' }]);
  expect(await getSurveys(client)).toEqual([]);
  expect(await getSurveys(client)).toEqual([]);
  expect(errors[0].message).toContain('401');
  fetch.mockImplementationOnce(async () => {
    client.optOut();
    return Response.json({ surveys: [{}] });
  });
  expect(await getSurveys(client)).toEqual([]);
  expect(await getSurveys(client)).toEqual([]);
  client.optIn();
  surveySent(client, { id: 's', name: 'N', questions: [{ id: 'toString' }] }, {});
  expect(events[0].properties.$survey_response_toString).toBeUndefined();
});

test('flags expose bootstrap, converted payloads and immutable notifications', async (t) => {
  const fetch = vi.fn().mockResolvedValue(
    Response.json({
      flags: {
        enabled: { enabled: true, metadata: { payload: { n: 1 } } },
        text: { enabled: true, metadata: { payload: 'invalid json' } }
      }
    })
  );
  const { client, events, errors } = fixture(t, { fetch });
  client.register({ $groups: { team: 'one' } });
  const flags = createFeatureFlags(client, {
    bootstrap: { old: true },
    personProperties: { plan: 'pro' },
    groupProperties: { team: { size: 3 } },
    evaluationContexts: ['checkout']
  });
  const values = [];
  const remove = flags.onFeatureFlags((value) => values.push(value));
  const bad = flags.onFeatureFlags(() => {});
  bad();
  let first = true;
  flags.onFeatureFlags(() => {
    if (!first) throw Error('subscriber');
    first = false;
  });
  expect(flags.isFeatureEnabled('missing')).toBeUndefined();
  expect(flags.getFeatureFlagPayload('missing')).toBeUndefined();
  expect(flags.getFeatureFlag('toString')).toBeUndefined();
  await flags.reload();
  expect(errors[0].message).toBe('subscriber');
  expect(flags.isFeatureEnabled('enabled')).toBe(true);
  expect(flags.getFeatureFlagPayload('enabled')).toEqual({ n: 1 });
  expect(flags.getFeatureFlagPayload('text')).toBe('invalid json');
  expect(client.getProperty('$feature/old')).toBeUndefined();
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({
    groups: { team: 'one' },
    person_properties: { plan: 'pro' },
    evaluation_contexts: ['checkout']
  });
  expect(values).toHaveLength(2);
  remove();
  expect(events.filter((e) => e.event === '$feature_flag_called')).toHaveLength(2);
  flags.destroy();
  expect(await flags.reload()).toEqual({});
  expect(flags.getFeatureFlag('enabled')).toBeUndefined();
});

test.each([{ errorsWhileComputingFlags: true }, { quotaLimited: ['feature_flags'] }, 'http'])(
  'flag evaluation fails without replacing bootstrap: %s',
  async (data) => {
    const { client, errors } = fixture(undefined, {
      fetch: async () => (data === 'http' ? new Response('', { status: 500 }) : Response.json(data))
    });
    const flags = createFeatureFlags(client, { bootstrap: { safe: false } });
    expect(await flags.reload()).toEqual({ safe: false });
    expect(errors).toHaveLength(1);
  }
);

test('flag requests time out, honor consent and discard destroyed responses', async (t) => {
  vi.useFakeTimers();
  t.onTestFinished(() => vi.useRealTimers());
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  let signal;
  let resolve;
  fetch.mockImplementation((_url, init) => {
    signal = init.signal;
    return new Promise((done) => {
      resolve = done;
    });
  });
  const { client } = fixture(t, { fetch: undefined, requestTimeoutMs: 10 });
  const flags = createFeatureFlags(client);
  const pending = flags.reload();
  await vi.advanceTimersByTimeAsync(10);
  expect(signal.aborted).toBe(true);
  client.optOut();
  resolve(Response.json({ flags: {} }));
  await pending;
  expect(await flags.reload()).toEqual({});
  client.optIn();
  resolve(Response.json({}));
  await Promise.resolve();
  await Promise.resolve();
  const late = flags.reload();
  flags.destroy();
  resolve(Response.json({ flags: { stale: { enabled: true } } }));
  await late;
  expect(flags.getFeatureFlag('stale')).toBeUndefined();
});

test('exceptions parse supported stack frames and tolerate arbitrary values and absent stacks', (t) => {
  const { client, events } = fixture(t);
  const error = new Error('bad');
  error.stack = 'Error: bad\n at work (https://app.test/app.js:5:9)\nhttps://app.test/other.js:1:2\n native';
  captureException(client, error, { context: 'test' }, false);
  expect(events[0].properties.$exception_list[0]).toMatchObject({
    mechanism: { handled: false },
    stacktrace: { frames: [{ lineno: 1 }, { function: 'work', lineno: 5 }] }
  });
  error.stack = undefined;
  captureException(client, error);
  captureException(client, 'string');
  expect(events[1].properties.$exception_list[0].stacktrace.frames).toEqual([]);
  expect(events[2].properties.$exception_list[0].value).toBe('string');
});
