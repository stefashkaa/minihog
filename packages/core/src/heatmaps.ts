import type { Cleanup, MiniHog } from './types.js';

interface Point {
  x: number;
  y: number;
  target_fixed: boolean;
  type: 'click' | 'mousemove' | 'rageclick' | 'deadclick';
}
interface Candidate {
  point: Point;
  url: string;
  time: number;
  target: Element;
}

/** Click/movement heatmaps, including rage clicks and unresponsive DOM clicks. */
export function startHeatmaps(client: MiniHog): Cleanup {
  if (typeof window === 'undefined') return () => {};
  let buffer: Record<string, Point[]> = {};
  let count = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let movement: ReturnType<typeof setTimeout> | undefined;
  let check: ReturnType<typeof setTimeout> | undefined;
  let candidates: Candidate[] = [];
  let recent: { x: number; y: number; time: number }[] = [];
  let lastFocus = 0;
  let selectionDuringGesture = false;

  function flush() {
    clearTimeout(timer);
    timer = undefined;
    if (count && !client.hasOptedOut()) client.capture('$$heatmap', { $heatmap_data: buffer }, { passive: true });
    buffer = {};
    count = 0;
  }

  function add(point: Point, url = location.href) {
    if (client.hasOptedOut()) return;
    (buffer[url] ??= []).push(point);
    if (++count >= 500) flush();
    if (!timer && count) timer = setTimeout(flush, 5000);
  }

  function point(event: MouseEvent, type: Point['type']): Point {
    let element = event.target instanceof Element ? event.target : null;
    let fixed = false;
    while (element && element !== document.body) {
      const position = getComputedStyle(element).position;
      if (position === 'fixed' || position === 'sticky') {
        fixed = true;
        break;
      }
      element = element.parentElement;
    }
    return {
      x: event.clientX + (fixed ? 0 : scrollX),
      y: event.clientY + (fixed ? 0 : scrollY),
      target_fixed: fixed,
      type
    };
  }

  function clearCandidates() {
    candidates = [];
    observer.disconnect();
    clearTimeout(check);
    check = undefined;
  }

  function checkCandidates() {
    check = undefined;
    const now = Date.now();
    candidates = candidates.filter((candidate) => {
      if (now - candidate.time < 2750) return true;
      if (candidate.target.isConnected) add({ ...candidate.point, type: 'deadclick' }, candidate.url);
      return false;
    });
    if (candidates.length) check = setTimeout(checkCandidates, 50);
    else observer.disconnect();
  }

  const observer = new MutationObserver(() => {
    const now = Date.now();
    for (const candidate of candidates) {
      if (now - candidate.time >= 2500 && candidate.target.isConnected)
        add({ ...candidate.point, type: 'deadclick' }, candidate.url);
    }
    clearCandidates();
  });

  function click(event: MouseEvent) {
    if (
      client.hasOptedOut() ||
      !(event.target instanceof Element) ||
      event.target.closest('.ph-no-capture,.ph-sensitive,[data-private]')
    )
      return;
    client.touchSession();
    const now = Date.now();
    const locationPoint = point(event, 'click');
    add(locationPoint);
    recent = recent.filter(
      (item) => now - item.time < 1000 && Math.abs(item.x - event.clientX) + Math.abs(item.y - event.clientY) < 30
    );
    recent.push({ x: event.clientX, y: event.clientY, time: now });
    if (
      recent.length === 3 &&
      !event.target.closest('input,select,textarea,[role="spinbutton"]') &&
      !window.getSelection()?.toString()
    ) {
      add({ ...locationPoint, type: 'rageclick' });
      recent = [];
    }
    if (
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      selectionDuringGesture ||
      now - lastFocus < 1000 ||
      event.target.closest(
        'a,input,select,textarea,label,canvas,video,audio,embed,object,[contenteditable],.ph-ignore-dead-clicks'
      ) ||
      candidates.some((candidate) => candidate.target === event.target && now - candidate.time < 1000)
    )
      return;
    if (candidates.length >= 50) candidates.shift();
    candidates.push({ point: locationPoint, time: now, url: location.href, target: event.target });
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true
    });
    if (!check) check = setTimeout(checkCandidates, 50);
  }

  function move(event: MouseEvent) {
    clearTimeout(movement);
    const url = location.href;
    movement = setTimeout(() => {
      if (url === location.href) add(point(event, 'mousemove'), url);
    }, 500);
  }

  function response() {
    const now = Date.now();
    for (const candidate of candidates)
      if (now - candidate.time >= 100) add({ ...candidate.point, type: 'deadclick' }, candidate.url);
    clearCandidates();
  }
  const down = () => {
    selectionDuringGesture = false;
  };
  const selection = () => {
    selectionDuringGesture = true;
    response();
  };
  const focus = () => {
    lastFocus = Date.now();
    clearCandidates();
  };
  const hidden = () => {
    focus();
    if (document.visibilityState === 'hidden') {
      flush();
      void client.flush({ beacon: true });
    }
  };
  const leave = () => {
    flush();
    void client.flush({ beacon: true });
  };
  document.addEventListener('click', click, true);
  document.addEventListener('mousemove', move, true);
  document.addEventListener('mousedown', down, true);
  document.addEventListener('selectionchange', selection);
  document.addEventListener('scroll', response, { capture: true, passive: true });
  document.addEventListener('visibilitychange', hidden);
  window.addEventListener('focus', focus);
  window.addEventListener('blur', focus);
  window.addEventListener('pagehide', leave);
  const consent = client.onConsentChange((enabled) => {
    if (!enabled) {
      buffer = {};
      count = 0;
      clearCandidates();
      clearTimeout(movement);
    }
  });
  const stop = () => {
    flush();
    clearCandidates();
    clearTimeout(movement);
    consent();
    document.removeEventListener('click', click, true);
    document.removeEventListener('mousemove', move, true);
    document.removeEventListener('mousedown', down, true);
    document.removeEventListener('selectionchange', selection);
    document.removeEventListener('scroll', response, true);
    document.removeEventListener('visibilitychange', hidden);
    window.removeEventListener('focus', focus);
    window.removeEventListener('blur', focus);
    window.removeEventListener('pagehide', leave);
    unregister();
  };
  const unregister = client.addCleanup(stop);
  return stop;
}
