import { defineNuxtConfig } from 'nuxt/config';

const diagnostics = process.env.MINIHOG_TEST_FEATURES !== 'off';

export default defineNuxtConfig({
  compatibilityDate: '2026-05-30',
  modules: ['@minihog/nuxt'],
  devtools: { enabled: false },
  minihog: {
    start: 'manual',
    webVitals: diagnostics,
    heatmaps: diagnostics,
    replay: diagnostics,
    consoleRecording: diagnostics,
    networkTiming: diagnostics
  }
});
