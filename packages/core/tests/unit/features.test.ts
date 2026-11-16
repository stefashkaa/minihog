import assert from 'node:assert/strict';
import { test } from 'vitest';
import { createMiniHog } from '../../src/index.ts';
import { identify } from '../../src/identity.ts';
import { createFeatureFlags } from '../../src/flags.ts';
import { surveyShown, surveySent, surveyDismissed } from '../../src/surveys.ts';
import { captureException } from '../../src/errors.ts';
import type { IngestionBatch } from './helpers.ts';

test('v2 flags support variants, payloads, unknown values, and deduplicated exposures', async (t) => {
  const batches: IngestionBatch[] = [];
  const client = createMiniHog('test', {
    persistence: 'memory',
    fetch: async (url, init) => {
      if (String(url).includes('/flags/'))
        return Response.json({
          flags: {
            checkout: { enabled: true, variant: 'test', metadata: { id: 12, version: 2, payload: '{"color":"red"}' } },
            off: { enabled: false }
          },
          requestId: 'request'
        });
      assert.ok(init && typeof init.body === 'string');
      batches.push(JSON.parse(init.body));
      return Response.json({});
    }
  });
  t.onTestFinished(() => client.destroy());
  const flags = createFeatureFlags(client);
  await flags.reload();
  assert.equal(flags.getFeatureFlag('missing'), undefined);
  assert.equal(flags.isFeatureEnabled('off'), false);
  assert.equal(flags.getFeatureFlag('checkout'), 'test');
  assert.deepEqual(flags.getFeatureFlagPayload('checkout'), { color: 'red' });
  flags.getFeatureFlag('checkout');
  await client.flush();
  const events = batches[0]!.batch.filter((event) => event.properties.$feature_flag === 'checkout');
  assert.equal(events.length, 1);
  assert.equal(events[0]!.properties.$feature_flag_request_id, 'request');
});

test('an old identity response cannot replace a new identity evaluation', async (t) => {
  const pending: ((response: Response) => void)[] = [];
  const client = createMiniHog('test', {
    persistence: 'memory',
    fetch: async (url) =>
      String(url).includes('/flags/') ? new Promise<Response>((resolve) => pending.push(resolve)) : Response.json({})
  });
  t.onTestFinished(() => client.destroy());
  const flags = createFeatureFlags(client);
  const first = flags.reload();
  identify(client, 'signed-in');
  pending[1]!(Response.json({ flags: { value: { enabled: true, variant: 'new' } } }));
  await new Promise((resolve) => setImmediate(resolve));
  pending[0]!(Response.json({ flags: { value: { enabled: true, variant: 'old' } } }));
  await first;
  assert.equal(flags.getFeatureFlag('value', false), 'new');
  client.optOut();
  assert.equal(flags.getFeatureFlag('value'), undefined);
});

test('survey and exception helpers emit documented property names', async (t) => {
  const batches: IngestionBatch[] = [];
  const client = createMiniHog('test', {
    persistence: 'memory',
    fetch: async (_url, init) => {
      assert.ok(init && typeof init.body === 'string');
      batches.push(JSON.parse(init.body));
      return Response.json({});
    }
  });
  t.onTestFinished(() => client.destroy());
  const survey = {
    id: 'survey',
    name: 'Feedback',
    questions: [{ id: 'question', type: 'open', question: 'How was it?' }]
  };
  surveyShown(client, survey);
  surveySent(client, survey, { question: 'Good', unknown: 'Ignored' });
  surveyDismissed(client, survey);
  captureException(client, new TypeError('Failed'));
  await client.flush();
  const events = batches[0]!.batch;
  assert.deepEqual(
    events.map((event) => event.event),
    ['survey shown', 'survey sent', 'survey dismissed', '$exception']
  );
  assert.equal(events[1]!.properties.$survey_response_question, 'Good');
  assert.equal(events[1]!.properties.$survey_response_unknown, undefined);
  assert.ok(Array.isArray(events[3]!.properties.$exception_list));
  assert.equal(events[3]!.properties.$exception_list[0].type, 'TypeError');
});
