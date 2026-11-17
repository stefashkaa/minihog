<script setup lang="ts">
import { useHead } from '#imports';
import { computed, ref } from 'vue';
useHead({ title: 'Documentation · MiniHog' });
const platform = ref<'core' | 'nuxt'>('core');
const install = computed(() => `pnpm add @minihog/${platform.value}`);
const setup = computed(() =>
  platform.value === 'core'
    ? `import { createMiniHog } from '@minihog/core';
import { startBrowserCapture } from '@minihog/core/browser';

const analytics = createMiniHog('phc_your_public_token', {
  apiHost: 'https://eu.i.posthog.com',
  personProfiles: 'identified_only'
});

startBrowserCapture(analytics);`
    : `// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['@minihog/nuxt'],
  minihog: {
    host: 'https://eu.i.posthog.com',
    proxyPath: '/api/_ph',
    start: 'manual'
  }
});

// Set NUXT_PUBLIC_MINIHOG_KEY in your environment.
// Call from a component or plugin when your app is ready:
await useMiniHog().start();`
);
const navigation = [
  ['installation', 'Installation'],
  ['capture', 'Capture events'],
  ['consent', 'Consent & identity'],
  ['nuxt', 'Nuxt integration'],
  ['api', 'Entry points'],
  ['replay', 'Replay & vitals'],
  ['flags', 'Feature flags'],
  ['compatibility', 'Compatibility']
];
const entryPoints = [
  ['@minihog/core', 'createMiniHog', 'Events, sessions, persistence, consent'],
  ['/browser', 'startBrowserCapture', 'Pageviews, SPA navigation, autocapture'],
  ['/identity', 'identify, group, alias', 'People and group properties'],
  ['/flags', 'createFeatureFlags', 'Variants, payloads, exposure events'],
  ['/heatmaps', 'startHeatmaps', 'Click, movement, rage, and dead-click points'],
  ['/surveys', 'getSurveys, surveySent', 'Headless definitions and responses'],
  ['/errors', 'captureException', 'Manual and global error capture'],
  ['/web-vitals', 'startWebVitals', 'CLS, FCP, INP, and LCP'],
  ['/replay', 'startSessionReplay', 'DOM recordings with rrweb'],
  ['/replay-console', 'consoleRecordingPlugin', 'Console recording for replay'],
  ['/replay-network', 'networkTimingPlugin', 'Resource and navigation timings'],
  ['/remote-config', 'getRemoteConfig', 'JSON project settings']
];
const capture = `analytics.capture('project_opened', { slug: 'my-project' });
analytics.register({ app_version: '1.0' });
analytics.registerOnce({ first_visit_source: 'docs' });
await analytics.flush();

// Remove listeners, stop extensions, and flush pending events.
await analytics.destroy();`;
const consent = `const analytics = createMiniHog('phc_your_public_token', {
  optOutByDefault: true,
  respectDnt: true
});

analytics.optIn();

import { identify, group } from '@minihog/core/identity';
identify(analytics, 'account-123', { plan: 'pro' });
group(analytics, 'organization', 'team-456');
analytics.reset(); // Return to an anonymous identity on logout.
analytics.optOut(); // Clears the queue and persisted MiniHog identity.`;
const deferred = `export default defineNuxtPlugin({
  dependsOn: ['minihog'],
  setup() {
    const analytics = useMiniHog();
    onNuxtReady(async () => {
      await loadContent().catch(showFallback);
      await analytics.start();
    });
  }
});`;
const replay = `import { startSessionReplay } from '@minihog/core/replay';
import { consoleRecordingPlugin } from '@minihog/core/replay-console';
import { networkTimingPlugin } from '@minihog/core/replay-network';
import { startWebVitals } from '@minihog/core/web-vitals';

startWebVitals(analytics);
const replay = startSessionReplay(analytics, {
  maskAllInputs: true,
  plugins: [consoleRecordingPlugin(), networkTimingPlugin(analytics.apiHost)]
});
replay.stop();`;
const flags = `import { createFeatureFlags } from '@minihog/core/flags';

const flags = createFeatureFlags(analytics);
await flags.reload();
const variant = flags.getFeatureFlag('new-checkout');
const payload = flags.getFeatureFlagPayload('new-checkout');`;
</script>

<template>
  <main id="main" class="container docs-layout">
    <aside class="docs-sidebar">
      <p class="eyebrow">Documentation</p>
      <nav aria-label="On this page">
        <a v-for="[id, label] in navigation" :key="id" :href="`#${id}`">{{ label }}</a>
      </nav>
      <NuxtLink class="sidebar-playground" to="/playground">Try the playground ↗</NuxtLink>
    </aside>
    <article class="docs-content">
      <div class="page-intro">
        <p class="eyebrow">Get started</p>
        <h1>A few imports.<br />Your analytics.</h1>
        <p>
          MiniHog sends events to your existing PostHog project. Use the TypeScript client directly or let the Nuxt
          module handle startup and proxying.
        </p>
      </div>
      <section id="installation">
        <h2>Installation</h2>
        <div class="segmented" aria-label="Installation framework">
          <button :aria-pressed="platform === 'core'" @click="platform = 'core'">TypeScript</button
          ><button :aria-pressed="platform === 'nuxt'" @click="platform = 'nuxt'">Nuxt</button>
        </div>
        <CodeBlock :code="install" label="Terminal" /><CodeBlock
          :code="setup"
          :label="platform === 'core' ? 'analytics.ts' : 'nuxt.config.ts'"
        />
        <p>
          Use a public project token. Direct ingestion defaults to US Cloud; the example uses EU Cloud. A relative
          <code>apiHost</code> requires a proxy. The Nuxt module provides one.
        </p>
      </section>
      <section id="capture">
        <h2>Capture events</h2>
        <p>Register shared properties once, and pass event-specific properties to <code>capture</code>.</p>
        <CodeBlock :code="capture" />
        <p>
          Events are batched automatically. Use <code>flush()</code> to send pending events immediately. See
          <a href="https://github.com/stefashkaa/minihog/tree/main/packages/core#consent-delivery-and-teardown"
            >delivery and teardown</a
          >
          for queue limits, retries, and cleanup.
        </p>
      </section>
      <section id="consent">
        <h2>Consent & identity</h2>
        <p>
          Use <code>optOutByDefault</code> when analytics should wait for permission. Opt-out stops collection and
          replay. A request already delivered cannot be recalled.
        </p>
        <CodeBlock :code="consent" />
        <p>
          Standard PostHog identity and session data migrate from the default storage keys. MiniHog persists its own
          state in localStorage, with memory fallback. Use <code>persistence: 'memory'</code> to avoid durable state.
        </p>
      </section>
      <section id="nuxt">
        <h2>Nuxt integration</h2>
        <p>
          Choose <code>start: 'ready'</code>, <code>'idle'</code>, or <code>'manual'</code>. Manual startup keeps the
          analytics implementation unloaded until <code>start()</code>. The controller is safe during SSR.
        </p>
        <CodeBlock :code="deferred" label="plugins/analytics.client.ts" />
        <p>
          The module provides a same-origin proxy and requires a Node-based Nitro deployment. See the
          <a href="https://github.com/stefashkaa/minihog/tree/main/packages/nuxt#module-options"
            >Nuxt module reference</a
          >
          for all options and proxy routes. Replace <code>loadContent</code> and <code>showFallback</code> with your
          application's loading and error handlers.
        </p>
        <p>
          Enable extensions through <code>webVitals</code>, <code>heatmaps</code>, <code>replay</code>,
          <code>consoleRecording</code>, and <code>networkTiming</code>. These default to false. Remote settings must
          also permit collection.
        </p>
      </section>
      <section id="api">
        <h2>Entry points</h2>
        <p>
          Each extension is imported explicitly. Unused imports can be removed by your bundler. Prefix short paths below
          with <code>@minihog/core</code>.
        </p>
        <div class="table-scroll" tabindex="0" role="region" aria-label="API entry points">
          <table>
            <thead>
              <tr>
                <th>Import</th>
                <th>API</th>
                <th>Purpose</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="[path, api, purpose] in entryPoints" :key="path">
                <td>
                  <code>{{ path }}</code>
                </td>
                <td>
                  <code>{{ api }}</code>
                </td>
                <td>{{ purpose }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
      <section id="replay">
        <h2>Replay & web vitals</h2>
        <p>
          Import the extensions you use. If your package manager does not install peers automatically, add the
          <a href="https://github.com/stefashkaa/minihog/tree/main/packages/core#install-and-capture">required peers</a>
          explicitly.
        </p>
        <CodeBlock :code="replay" />
        <p>
          Inputs are masked by default. Block content with <code>.ph-no-capture</code>, <code>.ph-sensitive</code>, or
          <code>[data-private]</code>. Console output may contain application data. Network diagnostics capture URLs and
          timings, without headers or bodies.
        </p>
        <p>
          See the
          <a href="https://github.com/stefashkaa/minihog/tree/main/packages/core#web-vitals-and-replay">replay guide</a>
          for masking, sampling, canvas recording, and delayed loading.
        </p>
      </section>
      <section id="flags">
        <h2>Feature flags</h2>
        <CodeBlock :code="flags" />
        <p>
          Unknown flags return <code>undefined</code>. Access records a deduplicated exposure event. Identity and group
          changes invalidate the previous result and reload flags. In a Nuxt app, install
          <code>@minihog/core</code> directly before importing its helpers.
        </p>
      </section>
      <section id="compatibility">
        <h2>Compatibility</h2>
        <p>
          MiniHog targets modern browsers with ES2022, Web Crypto, and Fetch. It adds no polyfills. The Nuxt module
          supports Nuxt 4 and Node-based Nitro servers.
        </p>
        <p>
          Migrating from <code>posthog-js</code> requires updating calls to MiniHog's separate imports and camelCase
          API. Check
          <a href="https://github.com/stefashkaa/minihog/tree/main/packages/core#compatibility"
            >supported features and compatibility</a
          >
          before migrating.
        </p>
        <a class="text-link" href="https://github.com/stefashkaa/minihog/tree/main/packages/core"
          >Complete core reference ↗</a
        >
      </section>
    </article>
  </main>
</template>
