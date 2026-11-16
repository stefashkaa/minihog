import type { Cleanup, MiniHog, Properties } from './types.js';

export function captureException(client: MiniHog, exception: unknown, properties?: Properties, handled = true): void {
  const error = exception instanceof Error ? exception : new Error(String(exception));
  client.capture('$exception', {
    $exception_list: [
      {
        type: error.name,
        value: error.message,
        mechanism: { type: 'generic', handled },
        stacktrace: {
          type: 'raw',
          frames: (error.stack?.split('\n').slice(1) ?? [])
            .flatMap((line) => {
              const match = line.trim().match(/^(?:at\s+)?(?:(.*?)\s*\()?((?:https?|file):.*?):(\d+):(\d+)\)?$/);
              return match
                ? [
                    {
                      function: match[1]?.trim(),
                      filename: match[2],
                      lineno: Number(match[3]),
                      colno: Number(match[4]),
                      in_app: true
                    }
                  ]
                : [];
            })
            .reverse()
        }
      }
    ],
    ...properties
  });
}

export function startErrorCapture(client: MiniHog): Cleanup {
  if (typeof window === 'undefined') return () => {};
  const error = (event: ErrorEvent) => {
    if (event.error) captureException(client, event.error, undefined, false);
  };
  const rejection = (event: PromiseRejectionEvent) => captureException(client, event.reason, undefined, false);
  window.addEventListener('error', error);
  window.addEventListener('unhandledrejection', rejection);
  const stop = () => {
    window.removeEventListener('error', error);
    window.removeEventListener('unhandledrejection', rejection);
    unregister();
  };
  const unregister = client.addCleanup(stop);
  return stop;
}
