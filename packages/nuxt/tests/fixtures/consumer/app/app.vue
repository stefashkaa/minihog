<script setup lang="ts">
import { onMounted, ref } from 'vue';

const analytics = useMiniHog();
const status = ref('idle');
const hydrated = ref(false);
onMounted(() => {
  hydrated.value = true;
});

async function start() {
  status.value = (await analytics.start()) ? 'running' : 'disabled';
}
async function stop() {
  await analytics.stop();
  status.value = 'stopped';
}
function consent(enabled: boolean) {
  const client = analytics.getClient();
  if (enabled) client?.optIn();
  else client?.optOut();
  status.value = enabled ? 'running' : 'opted out';
}
</script>

<template>
  <main :data-hydrated="hydrated">
    <h1>MiniHog Nuxt example</h1>
    <p>Analytics starts when you press Start. Set NUXT_PUBLIC_MINIHOG_KEY to your public project token.</p>
    <p role="status">{{ status }}</p>
    <button @click="start">Start</button>
    <button @click="stop">Stop</button>
    <button @click="consent(false)">Opt out</button>
    <button @click="consent(true)">Opt in</button>
    <button @click="analytics.getClient()?.capture('example_action')">Record action</button>
    <button @click="analytics.getClient()?.flush()">Flush</button>
    <label>Masked input <input value="PRIVATE_REPLAY_VALUE" /></label>
    <nav><NuxtLink to="/">Home</NuxtLink> <NuxtLink to="/about">About</NuxtLink></nav>
    <NuxtPage />
  </main>
</template>
