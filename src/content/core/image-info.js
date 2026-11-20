import { elementsStackAt, isOurs, parentComposed } from './dom-utils.js';

const gcd = (a, b) => (b ? gcd(b, a % b) : a);

/** "148:83" style reduced ratio of whole pixel sizes; '—' when a side is 0. */
export function ratio(w, h) {
  const a = Math.round(w), b = Math.round(h);
  if (!a || !b) return '—';
  const g = gcd(a, b);
  return `${a / g}:${b / g}`;
}

/** Decimal units, like Chrome DevTools ("22.3 kB"). */
export function formatBytes(n) {
  if (n == null) return 'Unavailable';
  if (n < 1000) return `${n} B`;
  if (n < 1e6) return `${(n / 1e3).toFixed(1)} kB`;
  return `${(n / 1e6).toFixed(2)} MB`;
}

export function middleTruncate(s, max) {
  if (s.length <= max) return s;
  const keep = max - 1;
  const head = Math.ceil(keep * 0.55);
  return `${s.slice(0, head)}…${s.slice(s.length - (keep - head))}`;
}

/* ---------- what is under the pointer? an <img>, or an element painted with a CSS background image ---------- */

const URL_RE = /url\(\s*(["']?)(.*?)\1\s*\)/;

/** First url(...) of a computed background-image value, or null (gradients / none). */
export function backgroundUrl(value) {
  if (!value || value === 'none') return null;
  const m = URL_RE.exec(value);
  return m && m[2] ? m[2] : null;
}

/* ---------- index of everything image-like on the page ----------
 * Hit-testing alone is not enough: sites routinely set `pointer-events: none` on hero photos and decorative
 * layers, put images behind stretched-link overlays, or paint backgrounds with ::before / ::after.
 * So we keep a (time-sliced, self-refreshing) index of every <img> and every element/pseudo-element that has a
 * CSS background image, and combine it with the hit-test stack. */

const idx = { imgs: [], bgs: [], gen: 0, timer: 0, dirty: false, mo: null };
const SKIP = new Set(['script', 'style', 'noscript', 'template', 'head', 'meta', 'link', 'title', 'br', 'wbr']);

function allElements(doc) {
  const out = [];
  const scan = (root) => {
    for (const el of root.querySelectorAll('*')) {
      if (isOurs(el)) continue;
      out.push(el);
      if (el.shadowRoot) scan(el.shadowRoot);
    }
  };
  scan(doc);
  return out;
}

function rebuildIndex(doc = document) {
  const gen = ++idx.gen;
  idx.dirty = false;
  const els = allElements(doc);
  const imgs = [];
  const bgs = [];
  let i = 0;
  const step = () => {
    if (gen !== idx.gen) return; // superseded or stopped
    const end = Math.min(i + 600, els.length);
    for (; i < end; i++) {
      const el = els[i];
      if (SKIP.has(el.localName)) continue;
      if (el.localName === 'img') { imgs.push(el); continue; }
      let cs;
      try { cs = getComputedStyle(el); } catch (_) { continue; }
      const own = backgroundUrl(cs.backgroundImage);
      if (own) bgs.push({ el, url: own, pseudo: '' });
      for (const ps of ['::before', '::after']) {
        const u = backgroundUrl(getComputedStyle(el, ps).backgroundImage);
        if (u) bgs.push({ el, url: u, pseudo: ps });
      }
    }
    if (i < els.length) setTimeout(step, 0);
    else { idx.imgs = imgs; idx.bgs = bgs; }
  };
  step();
}

function scheduleRebuild() {
  idx.dirty = true;
  if (idx.timer) return;
  idx.timer = setTimeout(() => { idx.timer = 0; if (idx.dirty && idx.mo) rebuildIndex(); }, 700);
}

export function startImageIndex() {
  stopImageIndex();
  rebuildIndex();
  idx.mo = new MutationObserver((muts) => {
    if (muts.every((m) => m.target && m.target.localName && isOurs(m.target))) return;
    scheduleRebuild();
  });
  idx.mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'src', 'srcset', 'data-src', 'hidden'] });
}

export function stopImageIndex() {
  idx.gen++;
  clearTimeout(idx.timer);
  idx.timer = 0;
  if (idx.mo) idx.mo.disconnect();
  idx.mo = null;
  idx.imgs = [];
  idx.bgs = [];
}

/** Really painted at (x, y)? Rules out opacity:0 / visibility:hidden and anything clipped away by an overflow ancestor. */
function paintedAt(el, x, y) {
  let cur = el;
  for (let depth = 0; cur && depth < 24; depth++) {
    let cs;
    try { cs = getComputedStyle(cur); } catch (_) { return false; }
    if (depth === 0 && cs.visibility !== 'visible') return false;
    if (cs.display === 'none' || Number(cs.opacity) < 0.02) return false;
    if (depth > 0 && (cs.overflowX !== 'visible' || cs.overflowY !== 'visible')) {
      const r = cur.getBoundingClientRect();
      if (x < r.left || x > r.right || y < r.top || y > r.bottom) return false;
    }
    cur = parentComposed(cur);
  }
  return true;
}

const containsPoint = (r, x, y) => r.width > 0 && r.height > 0 && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
const imgUrl = (el) => el.currentSrc || el.getAttribute('src') || '';

/**
 * The most specific image-like thing at the point: an <img> or a CSS background image (element or ::before/::after),
 * including ones that never receive pointer events. Smaller (more specific) boxes win; <img> beats a background.
 * @returns {{el: Element, kind: 'img'|'bg', url: string, pseudo?: string}|null}
 */
export function imageTargetAt(x, y) {
  const cands = [];
  const seen = new Set();
  const add = (c, rect) => {
    const key = c.el;
    const tag = c.pseudo ? `${c.pseudo}` : '';
    if (seen.has(key) && !tag) return;
    c.area = rect.width * rect.height;
    cands.push(c);
    if (!tag) seen.add(key);
  };

  // 1) what the browser hit-tests (works before the index is ready, and for iframes-free simple pages)
  let stack = [];
  try { stack = elementsStackAt(x, y); } catch (_) { /* detached */ }
  stack.slice(0, 24).forEach((el, order) => {
    if (el.localName === 'html') return;
    const r = el.getBoundingClientRect();
    if (el.localName === 'img') {
      const url = imgUrl(el);
      if (url && paintedAt(el, x, y)) add({ el, kind: 'img', url, order }, r);
      return;
    }
    let u = null;
    try { u = backgroundUrl(getComputedStyle(el).backgroundImage); } catch (_) { /* ignore */ }
    if (u && paintedAt(el, x, y)) add({ el, kind: 'bg', url: u, pseudo: '', order }, r);
  });

  // 2) the index: pointer-events:none images, pseudo-element backgrounds, images behind overlays
  for (const el of idx.imgs) {
    if (seen.has(el) || !el.isConnected) continue;
    const r = el.getBoundingClientRect();
    if (!containsPoint(r, x, y) || r.width < 8 || r.height < 8) continue;
    const url = imgUrl(el);
    if (!url || !paintedAt(el, x, y)) continue;
    add({ el, kind: 'img', url, order: 99 }, r);
  }
  for (const b of idx.bgs) {
    if (!b.el.isConnected || (!b.pseudo && seen.has(b.el))) continue;
    const r = b.el.getBoundingClientRect();
    if (!containsPoint(r, x, y) || r.width < 8 || r.height < 8) continue;
    if (!paintedAt(b.el, x, y)) continue;
    add({ el: b.el, kind: 'bg', url: b.url, pseudo: b.pseudo, order: 99 }, r);
  }

  if (!cands.length) return null;
  cands.sort((a, b) => (a.area - b.area) || ((a.kind === 'img' ? 0 : 1) - (b.kind === 'img' ? 0 : 1)) || (a.order - b.order));
  const { el, kind, url, pseudo } = cands[0];
  return { el, kind, url, pseudo: pseudo || '' };
}

/* ---------- intrinsic size of background images (an <img> already knows its own) ---------- */

const natural = new Map(); // url -> {w,h} | null (failed) ; absent = not requested yet
const naturalPending = new Map();

export const cachedNatural = (url) => (natural.has(url) ? natural.get(url) : undefined);

export function loadNatural(url) {
  if (natural.has(url)) return Promise.resolve(natural.get(url));
  if (naturalPending.has(url)) return naturalPending.get(url);
  const p = new Promise((resolve) => {
    const im = new Image();
    im.onload = () => resolve({ w: im.naturalWidth, h: im.naturalHeight });
    im.onerror = () => resolve(null);
    im.src = url;
  }).then((v) => { natural.set(url, v); naturalPending.delete(url); return v; });
  naturalPending.set(url, p);
  return p;
}

export function readImageInfo(target) {
  const { el, kind, url } = target;
  const r = el.getBoundingClientRect();
  const rw = Math.round(r.width), rh = Math.round(r.height);
  let nw = 0, nh = 0, state = 'loaded';
  if (kind === 'img') {
    nw = el.naturalWidth || 0; nh = el.naturalHeight || 0;
    if (!(el.complete && nw > 0)) state = 'notloaded';
  } else {
    const n = cachedNatural(url);
    if (n === undefined) state = 'loading';
    else if (!n || !n.w) state = 'notloaded';
    else { nw = n.w; nh = n.h; }
  }
  return {
    el, kind, src: url,
    rendered: { w: rw, h: rh },
    intrinsic: { w: nw, h: nh, state },
    renderedRatio: ratio(rw, rh),
    intrinsicRatio: ratio(nw, nh),
  };
}

export const infoSignature = (i) => JSON.stringify([i.kind, i.src, i.rendered, i.intrinsic]);

/** Rows in the same order and wording as Chrome DevTools' image tooltip. */
export function infoRows(i, sizeText) {
  const ok = i.intrinsic.state === 'loaded';
  const missing = i.intrinsic.state === 'loading' ? 'Loading…' : 'Not loaded';
  return [
    ['Rendered size', `${i.rendered.w} × ${i.rendered.h} px`],
    ['Rendered aspect ratio', i.renderedRatio],
    ['Intrinsic size', ok ? `${i.intrinsic.w} × ${i.intrinsic.h} px` : missing],
    ['Intrinsic aspect ratio', ok ? i.intrinsicRatio : '—'],
    ['File size', sizeText],
    ['Current source', i.src || 'Not specified'],
  ];
}

/* ---------- file size (best effort: the page's own network entry first, then a cache-friendly fetch) ---------- */

const sizeCache = new Map();
const queue = [];
let running = 0;

function fromTiming(url) {
  try {
    const e = performance.getEntriesByName(url).filter((x) => x.encodedBodySize > 0 || x.decodedBodySize > 0).pop();
    return e ? e.encodedBodySize || e.decodedBodySize : null;
  } catch (_) { return null; }
}

async function measure(url) {
  if (/^data:/i.test(url)) {
    const comma = url.indexOf(',');
    const body = url.slice(comma + 1);
    return /;base64/i.test(url.slice(0, comma)) ? Math.floor((body.length * 3) / 4) - (body.endsWith('==') ? 2 : body.endsWith('=') ? 1 : 0) : decodeURIComponent(body).length;
  }
  const t = fromTiming(url);
  if (t != null) return t;
  try {
    const res = await fetch(url, { cache: 'force-cache', credentials: 'omit' });
    if (!res.ok) return null;
    const len = Number(res.headers.get('content-length'));
    const blob = await res.blob();
    return blob.size || (len > 0 ? len : null);
  } catch (_) { return null; } // CORS / CSP: unknowable from a content script
}

function pump() {
  while (running < 4 && queue.length) {
    const { url, resolve } = queue.shift();
    running++;
    measure(url).then((n) => { sizeCache.set(url, n); resolve(n); }).finally(() => { running--; pump(); });
  }
}

/** Resolves to bytes, or null when the browser does not let us read it. Cached per URL. */
export function getFileSize(url) {
  if (!url) return Promise.resolve(null);
  if (sizeCache.has(url)) return Promise.resolve(sizeCache.get(url));
  return new Promise((resolve) => { queue.push({ url, resolve }); pump(); });
}
export const cachedSize = (url) => (sizeCache.has(url) ? sizeCache.get(url) : undefined);
export function clearImageCaches() { sizeCache.clear(); natural.clear(); queue.length = 0; }
