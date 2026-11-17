declare module '#minihog-init' {
  export function initialize(
    config: import('./types.js').PublicOptions,
    isActive?: () => boolean
  ): Promise<import('@minihog/core').MiniHog>;
}
declare module '#imports' {
  export function useRuntimeConfig(event?: unknown): { minihog: import('./types.js').ProxyOptions };
}
