import { record } from '@rrweb/record';
import { context } from './internal/state.js';
import { VERSION } from './internal/version.js';
import type { Cleanup, MiniHog } from './types.js';

type RecorderOptions = NonNullable<Parameters<typeof record>[0]>;
type RecorderPlugin = NonNullable<RecorderOptions['plugins']>[number];
interface Snapshot {
  type: number;
  data: unknown;
  timestamp: number;
}

export interface ReplayOptions {
  sampleRate?: number;
  minimumDurationMs?: number;
  idleTimeoutMs?: number;
  maskAllInputs?: boolean;
  maskTextSelector?: string;
  blockSelector?: string;
  /** Supply plugins explicitly so unused diagnostic implementations are removable. */
  plugins?: RecorderPlugin[];
  recordCanvas?: boolean;
}

export interface ReplayController {
  stop: Cleanup;
  flush: Cleanup;
  isRecording(): boolean;
}

let activeRecorder: object | undefined;

/** Records rrweb events locally and sends the PostHog $snapshot ingestion envelope. */
export function startSessionReplay(client: MiniHog, options: ReplayOptions = {}): ReplayController {
  const current = context(client);
  const owner = {};
  const sampleRate = options.sampleRate ?? 1;
  if (!Number.isFinite(sampleRate) || sampleRate < 0 || sampleRate > 1)
    throw new Error('Replay sampleRate must be between 0 and 1.');
  let stopRecording: Cleanup | undefined;
  let snapshots: Snapshot[] = [];
  let bytes = 0;
  let sessionId = client.getSessionId();
  const windowId = client.getWindowId();
  let started = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let idle = false;
  let lastActivity = 0;
  const encoder = new TextEncoder();

  function flush() {
    clearTimeout(timer);
    timer = undefined;
    if (!snapshots.length || client.hasOptedOut()) {
      snapshots = [];
      bytes = 0;
      return;
    }
    if (Date.now() - started < (options.minimumDurationMs ?? 0)) return;
    client.capture(
      '$snapshot',
      {
        $snapshot_data: snapshots,
        $snapshot_bytes: bytes,
        $session_id: sessionId,
        $window_id: windowId,
        $snapshot_host: typeof location === 'undefined' ? '' : location.hostname,
        $lib: 'web',
        $lib_version: `minihog-${VERSION}`
      },
      { endpoint: '/s/', passive: true }
    );
    snapshots = [];
    bytes = 0;
  }

  function emit(event: Snapshot) {
    if (client.hasOptedOut() || stopped) return;
    const size = encoder.encode(JSON.stringify(event)).byteLength;
    if (bytes + size > 48 * 1024) flush();
    if (bytes + size > 1024 * 1024) {
      // Do not retain an unbounded recording while waiting for a minimum duration.
      current.error(new Error('Replay buffer exceeded 1 MiB; recording stopped.'));
      snapshots = [];
      bytes = 0;
      queueMicrotask(() => stop());
      return;
    }
    snapshots.push(event);
    bytes += size;
    if (!timer) timer = setTimeout(flush, 1000);
  }

  function pause() {
    stopRecording?.();
    stopRecording = undefined;
    if (activeRecorder === owner) activeRecorder = undefined;
    flush();
  }

  function start() {
    if (stopped || idle || stopRecording || client.hasOptedOut() || typeof window === 'undefined') return;
    const sample = (parseInt(sessionId.replaceAll('-', '').slice(-8), 16) >>> 0) / 2 ** 32;
    if (sample >= sampleRate) return;
    if (activeRecorder && activeRecorder !== owner) {
      current.error(new Error('Only one session recorder can run in a document.'));
      return;
    }
    activeRecorder = owner;
    try {
      stopRecording = record({
        emit,
        maskAllInputs: options.maskAllInputs ?? true,
        maskTextClass: 'ph-mask',
        maskTextSelector: options.maskTextSelector,
        blockClass: 'ph-no-capture',
        blockSelector: options.blockSelector ?? '.ph-sensitive,[data-private]',
        ignoreClass: 'ph-ignore-input',
        recordCanvas: options.recordCanvas ?? false,
        inlineStylesheet: true,
        collectFonts: false,
        checkoutEveryNms: 5 * 60 * 1000,
        plugins: options.plugins,
        errorHandler: (error) => {
          current.error(error);
          return true;
        }
      });
      if (!stopRecording) activeRecorder = undefined;
    } catch (error) {
      activeRecorder = undefined;
      current.error(error);
    }
  }

  function activity() {
    const now = Date.now();
    if (now - lastActivity < 1000 || client.hasOptedOut()) return;
    lastActivity = now;
    client.touchSession();
    idle = false;
    start();
    clearTimeout(idleTimer);
    idleTimer = setTimeout(
      () => {
        idle = true;
        pause();
      },
      options.idleTimeoutMs ?? 5 * 60 * 1000
    );
  }

  const unsubscribeSession = client.onSessionChange((id) => {
    pause();
    snapshots = [];
    bytes = 0;
    sessionId = id;
    started = Date.now();
    start();
  });
  const unsubscribeConsent = client.onConsentChange((enabled) => {
    if (enabled) start();
    else {
      snapshots = [];
      bytes = 0;
      pause();
    }
  });
  const hidden = () => {
    if (document.visibilityState === 'hidden') {
      flush();
      void client.flush({ beacon: true });
    }
  };
  const pagehide = () => {
    flush();
    void client.flush({ beacon: true });
  };
  const activityEvents = ['pointerdown', 'pointermove', 'keydown', 'scroll'];
  if (typeof window !== 'undefined') {
    for (const type of activityEvents) window.addEventListener(type, activity, { passive: true, capture: true });
    window.addEventListener('pagehide', pagehide);
    document.addEventListener('visibilitychange', hidden);
  }
  start();
  if (stopRecording)
    idleTimer = setTimeout(
      () => {
        idle = true;
        pause();
      },
      options.idleTimeoutMs ?? 5 * 60 * 1000
    );
  const stop = () => {
    if (stopped) return;
    pause();
    stopped = true;
    clearTimeout(timer);
    clearTimeout(idleTimer);
    unsubscribeSession();
    unsubscribeConsent();
    if (typeof window !== 'undefined') {
      for (const type of activityEvents) window.removeEventListener(type, activity, true);
      window.removeEventListener('pagehide', pagehide);
      document.removeEventListener('visibilitychange', hidden);
    }
    unregister();
  };
  const unregister = client.addCleanup(stop);
  return { stop, flush, isRecording: () => !!stopRecording };
}
