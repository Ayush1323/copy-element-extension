import { isOurs, elementsStackAt } from './dom-utils.js';

/**
 * Closest `a[href]` from `el` upwards, crossing Shadow DOM boundaries.
 * Anchors inside the extension's own UI are never returned.
 */
export function findLink(el) {
  let cur = el && el.nodeType === 1 ? el : null;
  while (cur) {
    if (isOurs(cur)) return null;
    // closest('a[href]') covers the light-DOM tree (nested elements); then hop out of the shadow root
    const hit = cur.closest ? cur.closest('a[href]') : null;
    if (hit) return isOurs(hit) ? null : hit;
    const root = cur.getRootNode ? cur.getRootNode() : null;
    cur = root && root.host ? root.host : null;
  }
  return null;
}

/** Link under the pointer: from the detected element first, then from the raw element stack (stretched/overlay links). */
export function findLinkAt(rawEl, x, y) {
  const direct = findLink(rawEl);
  if (direct) return direct;
  try {
    const top = elementsStackAt(x, y)[0];
    if (top && top !== rawEl) return findLink(top);
  } catch (_) { /* detached / cross-origin frame */ }
  return null;
}

const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();

function resolveHref(a, raw) {
  if (raw == null) return '';
  try { return new URL(raw, a.baseURI || document.baseURI).href; } catch (_) { return raw; }
}

/**
 * Raw attribute snapshot. `null` means the attribute is absent (never inferred);
 * an empty string means present-but-empty.
 */
export function readLinkInfo(a) {
  const attr = (n) => (a.hasAttribute(n) ? a.getAttribute(n) : null);
  const hrefRaw = attr('href');
  const rel = attr('rel');
  return {
    text: norm(a.textContent),
    hrefRaw,
    href: resolveHref(a, hrefRaw),
    target: attr('target'),
    rel,
    relTokens: rel ? rel.split(/\s+/).filter(Boolean) : [],
    title: attr('title'),
    download: attr('download'),
    ariaLabel: attr('aria-label'),
  };
}

/** Cheap change detector so an unchanged link is never re-rendered (no flicker). */
export function linkSignature(info) {
  return JSON.stringify([info.text, info.hrefRaw, info.href, info.target, info.rel, info.title, info.download, info.ariaLabel]);
}

// Loading a destination on hover is a real GET request, so never do it for links that look like actions.
const ACTION_RE = /(^|[/_.\-?&=])(log[-_]?out|sign[-_]?out|log[-_]?off|unsubscribe|delete|remove|revoke|disconnect|deactivate|cancel)($|[/_.\-?&=#])/i;

/**
 * Should the hover preview load this link? Returns { ok, url?, cross? } or { ok:false, reason }.
 * Only http(s) pages, never downloads, the current page, insecure content on https pages, or action-looking URLs.
 */
export function previewDecision(info, pageHref = location.href) {
  if (info.hrefRaw == null) return { ok: false, reason: '' };
  let u;
  let here;
  try { u = new URL(info.href); here = new URL(pageHref); } catch (_) { return { ok: false, reason: 'Invalid link' }; }
  if (!/^https?:$/.test(u.protocol)) return { ok: false, reason: `${u.protocol.replace(':', '')} links have no preview` };
  if (info.download != null) return { ok: false, reason: 'Download link, not previewed' };
  if (u.origin === here.origin && u.pathname === here.pathname && u.search === here.search) return { ok: false, reason: 'Same page' };
  if (here.protocol === 'https:' && u.protocol === 'http:') return { ok: false, reason: 'Insecure (http) page: cannot be previewed from an https page' };
  if (ACTION_RE.test(u.pathname) || ACTION_RE.test(u.search)) return { ok: false, reason: 'Looks like an action link (log out, delete…): not loaded' };
  return { ok: true, url: u.href, cross: u.origin !== here.origin };
}
