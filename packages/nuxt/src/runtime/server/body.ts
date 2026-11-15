import type { Readable } from 'node:stream';

/** Limit body memory without destroying the socket before Nitro can return 413. */
export async function limitedBody(stream: Readable, limit: number): Promise<string> {
  const reader = stream.iterator({ destroyOnReturn: false });
  const decoder = new TextDecoder();
  let size = 0;
  let body = '';
  try {
    while (true) {
      const chunk = await reader.next();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > limit) {
        throw new RangeError('Analytics payload too large');
      }
      body += decoder.decode(chunk.value, { stream: true });
    }
    return body + decoder.decode();
  } finally {
    await reader.return?.();
    // Drain unread bytes without retaining them. H3 1.x's Web Stream adapter does
    // not detach its end handler on cancellation and otherwise throws on close.
    if (!stream.readableEnded) stream.resume();
  }
}
