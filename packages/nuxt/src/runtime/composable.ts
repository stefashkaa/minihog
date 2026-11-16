import { useNuxtApp } from '#app';
import type { MiniHogController } from '../types.js';

/** Available during SSR; start() becomes a no-op until called in the browser. */
export function useMiniHog(): MiniHogController {
  return useNuxtApp().$minihog;
}
