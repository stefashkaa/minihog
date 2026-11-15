import { vi } from 'vitest';
export const defineNuxtPlugin = <T>(plugin: T) => plugin;
export const onNuxtReady = vi.fn();
export const useRuntimeConfig = vi.fn();
export const useNuxtApp = vi.fn();
