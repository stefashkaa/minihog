<script setup lang="ts">
import { useHead } from '#imports';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { createMiniHog } from '@minihog/core';
import type { CaptureEvent, MiniHog } from '@minihog/core';
import { identify } from '@minihog/core/identity';
import { createFeatureFlags } from '@minihog/core/flags';

useHead({ title: 'Playground · MiniHog' });
let client: MiniHog | undefined;
let flags: ReturnType<typeof createFeatureFlags> | undefined;
const ready = ref(false);
const events = ref<CaptureEvent[]>([]);
const eventName = ref('project_opened');
const consent = ref(true);
const identified = ref(false);
const distinctId = ref('');
const sessionId = ref('');
const delivered = ref(0);
const variant = ref('control');
const result = ref('Not evaluated');
const selected = ref(0);
const message = ref('');
const preview = computed(() =>
  events.value[selected.value]
    ? JSON.stringify(events.value[selected.value], null, 2)
    : '// Capture an event to inspect its payload.'
);
const snippet = computed(
  () =>
    `analytics.capture(${JSON.stringify(eventName.value || 'project_opened')}, {\n  source: 'playground',\n  project: 'demo'\n});`
);

function refresh() {
  distinctId.value = client?.getDistinctId() ?? '';
  sessionId.value = client?.getSessionId() ?? '';
}
onMounted(() => {
  client = createMiniHog('demo_public_token', {
    persistence: 'memory',
    apiHost: '/local-demo',
    flushIntervalMs: 60000,
    beforeSend(event) {
      events.value.unshift(event);
      events.value = events.value.slice(0, 20);
      selected.value = 0;
      return event;
    },
    async fetch(url, init) {
      if (String(url).includes('/flags/'))
        return Response.json({
          flags: {
            welcome: {
              enabled: true,
              variant: variant.value,
              metadata: { payload: JSON.stringify({ label: variant.value === 'control' ? 'Welcome' : 'Hello there' }) }
            }
          }
        });
      const body = JSON.parse(String(init?.body));
      delivered.value += body.batch?.length ?? 0;
      return Response.json({ status: 1 });
    }
  });
  ready.value = true;
  refresh();
});
onBeforeUnmount(() => {
  void client?.destroy();
});
function capture() {
  if (!eventName.value.trim()) {
    message.value = 'Give your event a name.';
    return;
  }
  client?.capture(eventName.value.trim(), { source: 'playground', project: 'demo' });
  message.value = consent.value ? 'Event captured locally.' : 'Capture blocked by opt-out.';
  refresh();
}
function changeIdentity() {
  if (identified.value) client?.reset();
  else if (client) identify(client, 'demo-person', { plan: 'free' });
  identified.value = !identified.value;
  refresh();
}
function toggleConsent() {
  consent.value = !consent.value;
  if (consent.value) client?.optIn();
  else client?.optOut();
  message.value = consent.value ? 'Capture is enabled.' : 'Capture is disabled and the delivery queue is cleared.';
}
async function evaluate() {
  if (!client) return;
  flags ??= createFeatureFlags(client);
  await flags.reload();
  result.value = JSON.stringify(
    { variant: flags.getFeatureFlag('welcome'), payload: flags.getFeatureFlagPayload('welcome') },
    null,
    2
  );
}
</script>

<template>
  <main id="main" class="container playground section-space">
    <div class="page-intro">
      <p class="eyebrow">Interactive examples</p>
      <h1>Meet your next event.</h1>
      <p>Use the real MiniHog client with an in-memory transport. No data leaves this tab.</p>
    </div>
    <div class="playground-grid">
      <div class="controls-panel">
        <section>
          <div class="panel-heading">
            <span class="step">01</span>
            <h2>Capture an event</h2>
          </div>
          <label for="event-name">Event name</label
          ><input
            id="event-name"
            v-model="eventName"
            placeholder="project_opened"
            maxlength="100"
            @keyup.enter="capture"
          />
          <div class="button-row">
            <button class="button primary" :disabled="!ready" @click="capture">Capture event</button
            ><button class="button secondary" :disabled="!ready" @click="client?.flush()">Flush queue</button>
          </div>
          <p class="small muted">{{ delivered }} events delivered to local transport.</p>
        </section>
        <section>
          <div class="panel-heading">
            <span class="step">02</span>
            <h2>Identity & consent</h2>
          </div>
          <div class="button-row">
            <button class="button secondary" :disabled="!ready || !consent" @click="changeIdentity">
              {{ identified ? 'Reset identity' : 'Identify demo person' }}</button><button
              class="button secondary"
              :disabled="!ready"
              :aria-pressed="!consent"
              @click="toggleConsent"
            >
              {{ consent ? 'Opt out' : 'Opt in' }}
            </button>
          </div>
          <dl class="identity-list">
            <dt>Person</dt>
            <dd>{{ identified ? 'Identified' : 'Anonymous' }}</dd>
            <dt>Distinct ID</dt>
            <dd>{{ distinctId || 'Initializing…' }}</dd>
            <dt>Session ID</dt>
            <dd>{{ sessionId || 'Initializing…' }}</dd>
          </dl>
        </section>
        <section>
          <div class="panel-heading">
            <span class="step">03</span>
            <h2>Evaluate a feature flag</h2>
          </div>
          <label for="variant">Simulated server variant</label>
          <div class="button-row">
            <select id="variant" v-model="variant">
              <option value="control">Control</option>
              <option value="test">Test</option></select
            ><button class="button secondary" :disabled="!ready || !consent" @click="evaluate">Evaluate flag</button>
          </div>
          <pre class="flag-result" aria-live="polite">{{ result }}</pre>
        </section>
        <p class="feedback" role="status">{{ message || 'Ready when you are.' }}</p>
      </div>
      <div class="event-panel">
        <div class="code-bar">
          <span><span class="status-dot" /> Local event stream</span><span>{{ events.length }} / 20</span>
        </div>
        <div v-if="!events.length" class="empty-stream">
          <span class="empty-symbol" aria-hidden="true">{ }</span>
          <h2>Your first event goes here.</h2>
          <p>Give it a name, then press Capture event.</p>
        </div>
        <template v-else
          ><div class="event-tabs" aria-label="Captured events">
            <button
              v-for="(event, index) in events"
              :key="event.uuid"
              :aria-pressed="selected === index"
              @click="selected = index"
            >
              {{ event.event }}
            </button>
          </div>
          <pre class="event-json" tabindex="0" aria-label="Selected event JSON">{{ preview }}</pre>
        </template>
        <div class="stream-footer">In-memory persistence · No network requests</div>
      </div>
    </div>
    <div class="example-source">
      <div>
        <p class="eyebrow">Use it in your app</p>
        <h2>The same API.<br />Your own events.</h2>
        <NuxtLink class="text-link" to="/docs#capture">Read the capture guide →</NuxtLink>
      </div>
      <CodeBlock :code="snippet" label="capture.ts" />
    </div>
  </main>
</template>
