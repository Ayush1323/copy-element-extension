// SEO panel: the parts that need the live page or the network (web vitals, response headers, robots.txt, sitemap, link checks).
// Nothing runs until the panel asks for it, and nothing is ever sent anywhere except the page's own site (and, for the optional
// external link check, the link's target through the extension's background worker).
import { MSG } from '../../shared/message-types.js';
import { cumulativeShift, readNavigation, pickHeaders } from './seo.js';

/** Watches LCP / CLS / FCP / TTFB / INP with PerformanceObserver (buffered, so values from before the panel opened count too). */
export function startVitals(onChange) {
  const v = { LCP: null, CLS: null, FCP: null, TTFB: null, INP: null };
  const observers = [];
  const emit = () => { try { onChange({ ...v }); } catch (_) { /* panel closed */ } };
  const supported = (t) => { try { return PerformanceObserver.supportedEntryTypes.includes(t); } catch (_) { return false; } };
  const watch = (type, cb, opts = {}) => {
    if (!supported(type)) return;
    try {
      const o = new PerformanceObserver((list) => { cb(list.getEntries()); emit(); });
      o.observe({ type, buffered: true, ...opts });
      observers.push(o);
    } catch (_) { /* not allowed on this page */ }
  };
  const nav = readNavigation(performance);
  if (nav && nav.ttfb >= 0) v.TTFB = nav.ttfb;
  watch('largest-contentful-paint', (es) => { const e = es[es.length - 1]; if (e) v.LCP = e.renderTime || e.loadTime || e.startTime; });
  watch('paint', (es) => { const f = es.find((e) => e.name === 'first-contentful-paint'); if (f) v.FCP = f.startTime; });
  const shifts = [];
  if (supported('layout-shift')) v.CLS = 0;
  watch('layout-shift', (es) => { shifts.push(...es); v.CLS = cumulativeShift(shifts); });
  const worst = new Map(); // interactionId → longest duration: with few interactions the worst one is the INP
  watch('event', (es) => {
    for (const e of es) if (e.interactionId) worst.set(e.interactionId, Math.max(worst.get(e.interactionId) || 0, e.duration));
    if (worst.size) v.INP = Math.max(...worst.values());
  }, { durationThreshold: 16 });
  emit();
  return { get: () => ({ ...v }), stop() { observers.forEach((o) => { try { o.disconnect(); } catch (_) { /* gone */ } }); } };
}

const withTimeout = (ms) => { const c = new AbortController(); const t = setTimeout(() => c.abort(), ms); return { signal: c.signal, done: () => clearTimeout(t) }; };

/** The page's own response headers (a HEAD request to the same URL; GET if the server refuses HEAD). */
export async function fetchHeaders(url) {
  const t0 = performance.now();
  let res = null;
  for (const method of ['HEAD', 'GET']) {
    const to = withTimeout(12000);
    try {
      res = await fetch(url, { method, credentials: 'same-origin', cache: 'no-store', redirect: 'follow', signal: to.signal });
    } catch (e) { to.done(); if (method === 'GET') throw e; continue; }
    to.done();
    if (res.status !== 405 && res.status !== 501) break;
  }
  return { status: res.status, redirected: res.redirected, finalUrl: res.url, ms: Math.round(performance.now() - t0), headers: pickHeaders(res.headers) };
}

/** Plain text of a same-site file (robots.txt, sitemap.xml). Throws when the browser blocks the request. */
export async function fetchText(url, maxChars = 3000000) {
  const to = withTimeout(15000);
  try {
    const res = await fetch(url, { credentials: 'omit', cache: 'no-store', signal: to.signal });
    const text = (await res.text()).slice(0, maxChars);
    return { ok: res.ok, status: res.status, text };
  } finally { to.done(); }
}

/**
 * Checks link targets, a few at a time. Same-site links are fetched here; links to other sites go through the background
 * worker, which only does it when the user has given the optional all-sites permission.
 * `onResult(url, { status, redirected?, error? })` is called for each one.
 */
export async function checkLinks(urls, onResult, { concurrency = 5, isCancelled = () => false } = {}) {
  const queue = [...urls];
  const here = location.origin;
  let denied = false;
  async function one(url) {
    let origin = '';
    try { origin = new URL(url).origin; } catch (_) { onResult(url, { status: 0, error: 'Invalid URL' }); return; }
    if (!/^https?:/.test(url)) { onResult(url, { status: 0, error: 'Not an http(s) link' }); return; }
    if (origin === here) {
      for (const method of ['HEAD', 'GET']) {
        const to = withTimeout(10000);
        try {
          const res = await fetch(url, { method, credentials: 'same-origin', cache: 'no-store', redirect: 'follow', signal: to.signal });
          to.done();
          if ((res.status === 405 || res.status === 501) && method === 'HEAD') continue;
          onResult(url, { status: res.status, redirected: res.redirected });
          return;
        } catch (e) { to.done(); if (method === 'GET') onResult(url, { status: 0, error: 'Could not be reached' }); }
      }
      return;
    }
    if (denied) { onResult(url, { status: 0, error: 'needs-permission' }); return; }
    try {
      const res = await chrome.runtime.sendMessage({ type: MSG.CHECK_URL, url });
      if (res && res.error === 'no_permission') { denied = true; onResult(url, { status: 0, error: 'needs-permission' }); return; }
      onResult(url, res && res.ok ? { status: res.status, redirected: res.redirected } : { status: 0, error: (res && res.error) || 'Could not be reached' });
    } catch (_) { onResult(url, { status: 0, error: 'Could not be reached' }); }
  }
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length && !isCancelled()) await one(queue.shift());
  });
  await Promise.all(workers);
}
