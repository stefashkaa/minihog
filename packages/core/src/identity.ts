import { context } from './internal/state.js';
import type { MiniHog, Properties } from './types.js';

export function identify(client: MiniHog, distinctId: string, set?: Properties, setOnce?: Properties): void {
  if (!distinctId.trim() || client.hasOptedOut()) return;
  const current = context(client);
  if (current.options.personProfiles === 'never') return;
  const previous = current.state.distinctId;
  const anonymous = !current.state.identified;
  current.state.distinctId = distinctId;
  current.state.identified = true;
  current.state.personProcessing = true;
  current.save();
  client.capture('$identify', {
    ...(anonymous && previous !== distinctId ? { $anon_distinct_id: previous } : {}),
    ...(set ? { $set: set } : {}),
    ...(setOnce ? { $set_once: setOnce } : {})
  });
  current.identityChanged();
}

export function setPersonProperties(client: MiniHog, set: Properties, setOnce?: Properties): void {
  const current = context(client);
  if (client.hasOptedOut() || current.options.personProfiles === 'never') return;
  current.state.personProcessing = true;
  current.save();
  client.capture('$set', { $set: set, ...(setOnce ? { $set_once: setOnce } : {}) });
}

export function alias(client: MiniHog, aliasId: string): void {
  if (context(client).options.personProfiles === 'never') return;
  if (aliasId && aliasId !== client.getDistinctId()) client.capture('$create_alias', { alias: aliasId });
}

export function group(client: MiniHog, type: string, key: string, properties?: Properties): void {
  const current = client.getProperty('$groups') as Record<string, string> | undefined;
  client.register({ $groups: { ...current, [type]: key } });
  if (properties) client.capture('$groupidentify', { $group_type: type, $group_key: key, $group_set: properties });
  context(client).identityChanged();
}

export function resetGroups(client: MiniHog): void {
  client.unregister('$groups');
  context(client).identityChanged();
}
