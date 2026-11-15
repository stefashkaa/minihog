<script setup lang="ts">
import { computed, ref } from 'vue';

const target = ref<'core' | 'nuxt'>('core');
const install = computed(() => `pnpm add @minihog/${target.value}`);
const capture = `import { createMiniHog } from '@minihog/core';

const analytics = createMiniHog('phc_…', {
  apiHost: '/api/_ph'
});

analytics.capture('something_good', {
  project: 'your-next-idea'
});`;
const features = [
  {
    number: '01',
    title: 'Start small.',
    text: 'Events, identity, sessions, and consent. The core has no runtime dependencies.',
    tag: '@minihog/core'
  },
  {
    number: '02',
    title: 'Add what you need.',
    text: 'Pageviews, flags, heatmaps, replay, and web vitals each have a separate import.',
    tag: '12 entry points'
  },
  {
    number: '03',
    title: 'Choose when it starts.',
    text: 'Wait for your gallery, editor, or consent flow. The Nuxt module loads analytics when you call start().',
    tag: '@minihog/nuxt'
  }
];
</script>

<template>
  <main id="main">
    <section class="hero container">
      <div class="hero-copy">
        <p class="eyebrow"><span class="status-dot" /> TypeScript · ESM · Tree-shakable</p>
        <h1>PostHog analytics.<br /><span>A smaller footprint.</span></h1>
        <p class="hero-description">
          Capture events. Understand sessions. Import the features your app uses, and load them when your app is ready.
        </p>
        <div class="hero-actions">
          <NuxtLink class="button primary" to="/docs">Get started <span aria-hidden="true">↗</span></NuxtLink
          ><NuxtLink class="text-link" to="/playground">Try the playground <span aria-hidden="true">→</span></NuxtLink>
        </div>
        <div class="install-box">
          <div class="segmented" aria-label="Choose package">
            <button :aria-pressed="target === 'core'" @click="target = 'core'">TypeScript</button
            ><button :aria-pressed="target === 'nuxt'" @click="target = 'nuxt'">Nuxt</button>
          </div>
          <CodeBlock :code="install" label="Terminal" />
        </div>
      </div>
      <div class="hero-art">
        <ClientOnly>
          <LazyHeroEye
            eye-color="#ff8a45"
            background-color="#0d0d0c"
            :intensity="1.3"
            :scale="0.64"
            :flame-speed="0.5"
          />
        </ClientOnly>
      </div>
    </section>
    <div class="facts container">
      <span><strong>0</strong> core runtime dependencies</span><span><strong>12</strong> independent entry points</span
      ><span><strong>ES2022</strong> without added polyfills</span
      ><span><strong>MIT</strong> open-source packages</span>
    </div>
    <section class="overview container section-space">
      <div class="section-heading">
        <p class="eyebrow">A small, explicit API</p>
        <h2>Good data starts<br />with a few lines.</h2>
        <p>
          Keep your PostHog project. Send events through its ingestion APIs, with a client you can assemble feature by
          feature.
        </p>
        <NuxtLink class="text-link" to="/docs#api">Explore the API <span aria-hidden="true">→</span></NuxtLink>
      </div>
      <CodeBlock :code="capture" label="analytics.ts" />
    </section>
    <section class="features container" aria-label="Package features">
      <article v-for="feature in features" :key="feature.number">
        <span class="feature-number">{{ feature.number }}</span>
        <h3>{{ feature.title }}</h3>
        <p>{{ feature.text }}</p>
        <code>{{ feature.tag }}</code>
      </article>
    </section>
    <section class="closing container section-space">
      <div>
        <p class="eyebrow">Try it in your browser</p>
        <h2>Send an event.<br />See what goes with it.</h2>
      </div>
      <div>
        <p>
          The playground shows event properties, identity changes, consent, and flag evaluation. Everything stays in
          your tab.
        </p>
        <NuxtLink class="button primary" to="/playground">Open playground <span aria-hidden="true">→</span></NuxtLink>
      </div>
    </section>
  </main>
</template>
