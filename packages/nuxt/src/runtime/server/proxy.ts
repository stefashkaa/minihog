import {
  createError,
  defineEventHandler,
  getHeader,
  getRequestHeaders,
  getRequestURL,
  setHeader,
  setResponseStatus
} from 'h3';
import { useRuntimeConfig } from '#imports';
import { proxyTarget } from './routing.js';
import { limitedBody } from './body.js';

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event).minihog;
  const target = proxyTarget(getRequestURL(event), event.method, config);
  if (!target) throw createError({ statusCode: 404, statusMessage: 'Analytics endpoint not found' });
  const length = Number(getHeader(event, 'content-length') ?? 0);
  const limit = 2 * 1024 * 1024;
  if (length > limit) throw createError({ statusCode: 413, statusMessage: 'Analytics payload too large' });
  let body: string | undefined;
  try {
    if (event.method === 'POST') body = await limitedBody(event.node.req, limit);
  } catch (error) {
    if (error instanceof RangeError)
      throw createError({ statusCode: 413, statusMessage: 'Analytics payload too large' });
    throw error;
  }
  const incoming = getRequestHeaders(event);
  const headers: Record<string, string> = {};
  // Forward browser context for flag runtime detection and GeoIP, never site credentials.
  for (const name of [
    'content-type',
    'user-agent',
    'origin',
    'referer',
    'sec-fetch-site',
    'sec-fetch-mode',
    'x-forwarded-for'
  ]) {
    const value = incoming[name];
    if (typeof value === 'string') headers[name] = value;
  }
  let response: Response;
  try {
    response = await fetch(target, {
      method: event.method,
      headers,
      body,
      redirect: 'error',
      signal: AbortSignal.timeout(10000)
    });
  } catch {
    throw createError({ statusCode: 502, statusMessage: 'Analytics upstream unavailable' });
  }
  setResponseStatus(event, response.status);
  for (const name of ['content-type', 'retry-after']) {
    const value = response.headers.get(name);
    if (value) setHeader(event, name, value);
  }
  setHeader(event, 'cache-control', 'no-store');
  return response.body;
});
