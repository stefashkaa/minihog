import type { ProxyOptions } from '../../types.js';

/** An endpoint allowlist prevents proxying arbitrary URLs, scripts, or management APIs. */
export function proxyTarget(url: URL, method: string, options: ProxyOptions): string | undefined {
  if (!url.pathname.startsWith(`${options.path}/`)) return;
  const path = url.pathname.slice(options.path.length);
  const ingestion = /^\/(batch|s)\/$/.test(path) || path === '/i/v0/e/';
  const flags = /^\/flags\/?$/.test(path);
  const config = /^\/array\/[a-zA-Z0-9_-]+\/config$/.test(path);
  const surveys = path === '/api/surveys/';
  if ((ingestion || flags) && method !== 'POST') return;
  if ((config || surveys) && method !== 'GET') return;
  if (!ingestion && !flags && !config && !surveys) return;
  return `${config ? options.assetsHost : options.host}${path}${url.search}`;
}
