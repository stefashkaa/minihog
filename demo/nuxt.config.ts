import { defineNuxtConfig } from 'nuxt/config';

export default defineNuxtConfig({
  compatibilityDate: '2026-05-30',
  modules: ['@minihog/nuxt'],
  devtools: { enabled: false },
  css: ['~/assets/styles.css'],
  minihog: { start: 'manual' },
  vite: {
    optimizeDeps: {
      include: ['ogl']
    }
  },
  app: {
    head: {
      htmlAttrs: { lang: 'en' },
      title: 'MiniHog · Modular PostHog analytics',
      meta: [
        {
          name: 'description',
          content:
            'A small TypeScript client for PostHog. Import events, replay, web vitals, and other features separately. Includes a Nuxt module with deferred startup.'
        }
      ],
      link: [{ rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }]
    }
  }
});
