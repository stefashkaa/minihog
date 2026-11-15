import { defineNuxtPlugin, onNuxtReady, useRuntimeConfig } from '#app';
import type { PublicOptions } from '../types.js';
import { createController } from './controller.js';

export default defineNuxtPlugin({
  name: 'minihog',
  setup() {
    const config = useRuntimeConfig().public.minihog as PublicOptions;
    const controller = createController(
      typeof window === 'undefined' ? { ...config, key: '' } : config,
      () => import('#minihog-init').then(({ initialize }) => initialize),
      (error) => console.warn('[minihog] Analytics could not start.', error)
    );
    if (typeof window !== 'undefined' && config.start !== 'manual') {
      onNuxtReady(() => {
        if (config.start === 'idle' && 'requestIdleCallback' in window) {
          window.requestIdleCallback(() => void controller.start(), { timeout: 2000 });
        } else void controller.start();
      });
    }
    return { provide: { minihog: controller } };
  }
});
