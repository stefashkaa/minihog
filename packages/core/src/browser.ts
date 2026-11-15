import { uuid } from './internal/state.js';
import type { Cleanup, MiniHog, Properties } from './types.js';

export interface BrowserOptions {
  pageviews?: boolean;
  autocapture?: boolean;
  rageclick?: boolean;
  /** Avoid recording visible text in products that display personal information. */
  captureText?: boolean;
}

const privateSelector = '.ph-no-capture,.ph-sensitive,.nocapture,[data-ph-no-capture],[data-private]';

function browserProperties(): Properties {
  const agent = navigator.userAgent;
  const browser = /Edg\//.test(agent)
    ? 'Microsoft Edge'
    : /Firefox\//.test(agent)
      ? 'Firefox'
      : /Chrome\//.test(agent)
        ? 'Chrome'
        : /Safari\//.test(agent)
          ? 'Safari'
          : 'Other';
  const version = agent.match(/(?:Edg|Firefox|Chrome|Version)\/(\d+)/)?.[1];
  const os = /Android/.test(agent)
    ? 'Android'
    : /iPhone|iPad/.test(agent)
      ? 'iOS'
      : /Mac/.test(agent)
        ? 'Mac OS X'
        : /Windows/.test(agent)
          ? 'Windows'
          : /Linux/.test(agent)
            ? 'Linux'
            : 'Other';
  return {
    $browser: browser,
    $browser_version: Number(version ?? 0),
    $os: os,
    $device_type: /iPad|Tablet/.test(agent) ? 'Tablet' : /Mobi|iPhone|Android/.test(agent) ? 'Mobile' : 'Desktop',
    $screen_height: screen.height,
    $screen_width: screen.width,
    $viewport_height: innerHeight,
    $viewport_width: innerWidth,
    $browser_language: navigator.language,
    $timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    $is_internal_or_test_user: /^(localhost|127\.0\.0\.1)$/.test(location.hostname)
  };
}

function referrerProperties(): Properties {
  let domain = '$direct';
  try {
    if (document.referrer) domain = new URL(document.referrer).hostname;
  } catch {
    /* Referrers can be suppressed. */
  }
  return { $referrer: document.referrer || '$direct', $referring_domain: domain };
}

function elements(target: Element, captureText: boolean): Properties[] {
  const chain: Properties[] = [];
  let element: Element | null = target;
  while (element && chain.length < 10) {
    const tag = element.tagName.toLowerCase();
    let nthChild = 1;
    let nthOfType = 1;
    let sibling = element.previousElementSibling;
    while (sibling) {
      nthChild++;
      if (sibling.tagName === element.tagName) nthOfType++;
      sibling = sibling.previousElementSibling;
    }
    const entry: Properties = { tag_name: tag, nth_child: nthChild, nth_of_type: nthOfType };
    if (element.id) entry.attr__id = element.id;
    if (element.classList.length) entry.attr__class = [...element.classList].join(' ');
    if (element instanceof HTMLAnchorElement) entry.attr__href = element.href;
    if (
      captureText &&
      /^(a|button|label|span)$/.test(tag) &&
      !element.querySelector('input,textarea,[contenteditable]')
    ) {
      const text = element.textContent?.trim().slice(0, 255);
      // Keep obvious email addresses and long numeric identifiers out of autocapture.
      if (text && !/@|\d{6,}/.test(text)) entry.$el_text = text;
    }
    chain.push(entry);
    element = element.parentElement;
  }
  return chain;
}

function elementsChain(chain: Properties[]): string {
  const quote = (value: unknown) => String(value).replaceAll('"', '\\"');
  return chain
    .map((element) => {
      const classes = String(element.attr__class ?? '')
        .split(/\s+/)
        .filter(Boolean)
        .sort();
      const attributes: Properties = { 'nth-child': element.nth_child, 'nth-of-type': element.nth_of_type };
      for (const [name, value] of Object.entries(element)) if (name.startsWith('attr__')) attributes[name] = value;
      if (element.$el_text) attributes.text = element.$el_text;
      if (element.attr__href) attributes.href = element.attr__href;
      if (element.attr__id) attributes.attr_id = element.attr__id;
      const properties = Object.keys(attributes)
        .sort()
        .map((key) => `${quote(key)}="${quote(attributes[key])}"`)
        .join('');
      return `${element.tag_name}${classes.map((name) => `.${name.replaceAll('"', '')}`).join('')}:${properties}`;
    })
    .join(';');
}

/** Installs page/session attribution and DOM analytics; returns complete teardown. */
export function startBrowserCapture(client: MiniHog, options: BrowserOptions = {}): Cleanup {
  if (typeof window === 'undefined') return () => {};
  const removers: Cleanup[] = [];
  let page: { url: string; pathname: string; id: string; started: number } | undefined;
  let maxScroll = 0;
  let maxContent = 0;
  let maxHeight = 0;
  let left = false;
  let previousClicks: { x: number; y: number; time: number }[] = [];
  let disposed = false;
  const referrer = referrerProperties();
  client.register(browserProperties());
  client.registerOnce({ $initial_referrer: referrer.$referrer, $initial_referring_domain: referrer.$referring_domain });

  function attribution() {
    const url = new URL(location.href);
    const campaign: Properties = {};
    for (const [name, value] of url.searchParams) {
      if (/^utm_(source|medium|campaign|term|content|id)$/.test(name) || /^(gclid|fbclid|msclkid)$/.test(name))
        campaign[name] = value;
    }
    client.register({ ...campaign, ...referrer, $current_url: url.href, $host: url.host, $pathname: url.pathname });
    client.registerOnce({
      $session_entry_url: url.href,
      $session_entry_host: url.host,
      $session_entry_pathname: url.pathname,
      $session_entry_referrer: referrer.$referrer,
      $session_entry_referring_domain: referrer.$referring_domain
    });
  }

  function scroll() {
    maxScroll = Math.max(maxScroll, scrollY);
    maxContent = Math.max(maxContent, scrollY + innerHeight);
    maxHeight = Math.max(maxHeight, document.documentElement.scrollHeight);
  }

  function previousPage(): Properties {
    if (!page) return {};
    scroll();
    const percentage = (value: number, total: number) => (total <= 1 ? 1 : Math.min(1, Math.max(0, value / total)));
    return {
      $prev_pageview_id: page.id,
      $prev_pageview_pathname: page.pathname,
      $prev_pageview_duration: (Date.now() - page.started) / 1000,
      $prev_pageview_last_scroll: scrollY,
      $prev_pageview_max_scroll: maxScroll,
      $prev_pageview_last_scroll_percentage: percentage(scrollY, maxHeight - innerHeight),
      $prev_pageview_max_scroll_percentage: percentage(maxScroll, maxHeight - innerHeight),
      $prev_pageview_last_content: scrollY + innerHeight,
      $prev_pageview_max_content: maxContent,
      $prev_pageview_last_content_percentage: percentage(scrollY + innerHeight, maxHeight),
      $prev_pageview_max_content_percentage: percentage(maxContent, maxHeight)
    };
  }

  function pageview() {
    if (disposed || client.hasOptedOut() || options.pageviews === false || (page?.url === location.href && !left))
      return;
    client.touchSession();
    const previous = previousPage();
    page = { url: location.href, pathname: location.pathname, id: uuid(), started: Date.now() };
    maxScroll = maxContent = maxHeight = 0;
    left = false;
    attribution();
    client.register({ $pageview_id: page.id });
    client.capture('$pageview', { ...previous, $title: document.title });
  }

  function leave() {
    if (left || !page || client.hasOptedOut()) return;
    left = true;
    client.capture(
      '$pageleave',
      { ...previousPage(), $current_url: page.url, $pathname: page.pathname },
      { passive: true }
    );
    void client.flush({ beacon: true });
  }

  function autocapture(event: Event) {
    if (client.hasOptedOut()) return;
    const target = event.composedPath().find((item) => item instanceof Element);
    if (!(target instanceof Element) || target.closest(privateSelector)) return;
    if (target.closest('input[type="password"],[contenteditable="true"]')) return;
    const actionable = target.closest('a,button,input,select,textarea,label,form,[role="button"],[role="link"]');
    if (!actionable) return;
    const chain = elements(target, options.captureText !== false);
    client.capture('$autocapture', {
      $event_type: event.type,
      $elements: chain,
      $elements_chain: elementsChain(chain),
      $el_text: chain[0]?.$el_text
    });
    if (event instanceof MouseEvent && event.type === 'click' && options.rageclick !== false) {
      const now = Date.now();
      previousClicks = previousClicks.filter(
        (click) => now - click.time < 1000 && Math.abs(click.x - event.clientX) + Math.abs(click.y - event.clientY) < 30
      );
      previousClicks.push({ x: event.clientX, y: event.clientY, time: now });
      if (
        previousClicks.length === 3 &&
        !target.closest('input,select,textarea,[role="spinbutton"]') &&
        !window.getSelection()?.toString()
      ) {
        client.capture('$rageclick', { $event_type: 'click', $elements: chain, $elements_chain: elementsChain(chain) });
        previousClicks = [];
      }
    }
  }

  function listen(target: EventTarget, type: string, listener: EventListener, capture = false) {
    target.addEventListener(type, listener, { capture, passive: true });
    removers.push(() => target.removeEventListener(type, listener, capture));
  }

  if (options.pageviews !== false) {
    for (const name of ['pushState', 'replaceState'] as const) {
      const original = history[name];
      const wrapped: History[typeof name] = function (this: History, ...args) {
        original.apply(this, args);
        queueMicrotask(pageview);
      };
      history[name] = wrapped;
      removers.push(() => {
        if (history[name] === wrapped) history[name] = original;
      });
    }
    listen(window, 'popstate', pageview);
    listen(window, 'hashchange', pageview);
    listen(window, 'pagehide', leave);
    listen(window, 'pageshow', ((event: PageTransitionEvent) => {
      if (event.persisted) pageview();
    }) as EventListener);
    listen(window, 'scroll', scroll);
  }
  if (options.autocapture !== false)
    for (const type of ['click', 'change', 'submit']) listen(document, type, autocapture, true);
  listen(window, 'resize', () => client.register({ $viewport_height: innerHeight, $viewport_width: innerWidth }));
  removers.push(
    client.onConsentChange((enabled) => {
      if (enabled) {
        page = undefined;
        pageview();
      }
    })
  );
  removers.push(
    client.onSessionChange(() => {
      for (const name of ['url', 'host', 'pathname', 'referrer', 'referring_domain'])
        client.unregister(`$session_entry_${name}`);
      page = undefined;
      attribution();
    })
  );
  attribution();
  pageview();
  const cleanup = () => {
    disposed = true;
    for (const remove of removers) remove();
    unregister();
  };
  const unregister = client.addCleanup(cleanup);
  return cleanup;
}
