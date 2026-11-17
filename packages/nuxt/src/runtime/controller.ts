import type { MiniHog } from '@minihog/core';
import type { MiniHogController, PublicOptions } from '../types.js';

type Initialize = (config: PublicOptions, isActive: () => boolean) => Promise<MiniHog>;

export function createController(
  config: PublicOptions,
  load: () => Promise<Initialize>,
  onError: (error: unknown) => void
): MiniHogController {
  let client: MiniHog | undefined;
  let pending: Promise<MiniHog | undefined> | undefined;
  let generation = 0;
  return {
    getClient: () => client,
    start() {
      if (!config.key) return Promise.resolve(undefined);
      if (client) return Promise.resolve(client);
      if (pending) return pending;
      const version = generation;
      const operation = load()
        .then((initialize) => {
          if (version === generation) return initialize(config, () => version === generation);
        })
        .then(async (created) => {
          if (!created) return;
          if (version !== generation) {
            await created.destroy();
            return;
          }
          client = created;
          return client;
        })
        .catch((error: unknown) => {
          onError(error);
          return undefined;
        })
        .finally(() => {
          if (pending === operation) pending = undefined;
        });
      pending = operation;
      return operation;
    },
    async stop() {
      generation++;
      const loading = pending;
      const previous = client;
      pending = undefined;
      client = undefined;
      await loading;
      await previous?.destroy();
    }
  };
}
