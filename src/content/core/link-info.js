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
