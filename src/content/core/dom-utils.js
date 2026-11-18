import { HOST_TAG } from '../../shared/constants.js';

export const SKIP_TAGS = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'IFRAME', 'CANVAS', 'VIDEO', 'AUDIO',
  'OBJECT', 'EMBED', 'LINK', 'META', 'HEAD', 'TITLE', 'MAP', 'AREA', 'DATALIST', 'OPTION',
  'IMG', 'PICTURE', 'SOURCE', 'TRACK', 'HR', 'MATH', HOST_TAG.toUpperCase(),
]);

const BLOCK_TAGS = new Set([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DETAILS', 'DIALOG', 'DD', 'DIV', 'DL', 'DT',
  'FIELDSET', 'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'HEADER', 'HGROUP', 'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE', 'SECTION', 'SUMMARY', 'TABLE',
  'TBODY', 'THEAD', 'TFOOT', 'TR', 'TD', 'TH', 'UL', 'BODY', 'HTML', 'BUTTON',
]);

export const INLINE_FORMAT_TAGS = new Set([
  'B', 'STRONG', 'I', 'EM', 'U', 'MARK', 'SMALL', 'SUB', 'SUP', 'CODE', 'ABBR', 'TIME',
  'S', 'DEL', 'INS', 'Q', 'CITE', 'BDI', 'BDO', 'KBD', 'SAMP', 'VAR', 'WBR',
]);

export const tagOf = (el) => (el && el.localName ? el.localName.toUpperCase() : '');
export const isElement = (n) => !!n && n.nodeType === 1;
export const isText = (n) => !!n && n.nodeType === 3;

let styleCache = new WeakMap();
let blockCache = new WeakMap();
let blockDescCache = new WeakMap();

/** Call at the start of every detection/extraction pass: layout may have changed. */
export function resetCaches() {
  styleCache = new WeakMap();
  blockCache = new WeakMap();
  blockDescCache = new WeakMap();
}

export function styleOf(el) {
  let cs = styleCache.get(el);
  if (!cs) {
    const win = (el.ownerDocument && el.ownerDocument.defaultView) || window;
    cs = win.getComputedStyle(el);
    styleCache.set(el, cs);
  }
  return cs;
}

export function parentComposed(node) {
  if (!node) return null;
  if (node.parentElement) return node.parentElement;
  const p = node.parentNode;
  return p && p.host ? p.host : null; // shadow root -> host
}

export function isOurs(node) {
  return !!node && node.localName === HOST_TAG;
}

export function childNodesOf(el) {
  if (el.localName === 'slot' && typeof el.assignedNodes === 'function') {
    const assigned = el.assignedNodes({ flatten: true });
    if (assigned.length) return assigned;
  }
  if (el.shadowRoot) return el.shadowRoot.childNodes;
  return el.childNodes;
}

export function childElementsOf(el) {
  return Array.from(childNodesOf(el)).filter(isElement);
}

const SR_ONLY = /(^|[\s_-])(sr-only|screen-reader|visually-hidden|visuallyhidden|assistive-text|a11y-hidden)([\s_-]|$)/i;

export function isHiddenElement(el) {
  if (el.hidden) return true;
  const cs = styleOf(el);
  if (cs.display === 'none') return true;
  if (cs.visibility === 'hidden' || cs.visibility === 'collapse') return true;
  if (parseFloat(cs.opacity) === 0) return true;
  if (el.getAttribute('aria-hidden') === 'true') return true;
  const cls = typeof el.className === 'string' ? el.className : '';
  if (SR_ONLY.test(cls)) return true;
  if (cs.position === 'absolute' && cs.overflow !== 'visible') {
    const r = el.getBoundingClientRect();
    if (r.width <= 1 && r.height <= 1 && (cs.clip !== 'auto' || cs.overflow === 'hidden')) return true;
  }
  return false;
}

export function shouldSkip(el) {
  if (SKIP_TAGS.has(tagOf(el))) return true;
  return isHiddenElement(el);
}

const ATOMIC = /^inline-(block|flex|grid|table)$/;

/** inline-block/flex "chips" that sit next to each other (tags, pills) behave like separate items. */
export function isChipLike(el) {
  const cs = styleOf(el);
  if (!ATOMIC.test(cs.display)) return false;
  const p = el.parentElement;
  if (!p) return false;
  for (const c of p.childNodes) {
    if (c.nodeType === 3 && c.nodeValue.trim()) return false;
    if (c.nodeType === 1 && c !== el && ATOMIC.test(styleOf(c).display)) return true;
  }
  return false;
}

function isFlexItem(el) {
  const p = el.parentElement;
  return !!p && /^(inline-)?(flex|grid)$/.test(styleOf(p).display);
}

export function isBlockLevel(el) {
  let v = blockCache.get(el);
  if (v !== undefined) return v;
  const cs = styleOf(el);
  const d = cs.display;
  if (isFlexItem(el)) v = true; // flex/grid items are blockified
  else if (!d) v = BLOCK_TAGS.has(tagOf(el));
  else if (d === 'contents') v = false;
  else if (d.startsWith('inline')) v = isChipLike(el);
  else v = true;
  blockCache.set(el, v);
  return v;
}

/** True if any visible descendant is block-level (so el is not a single text flow). */
export function hasBlockDescendant(el) {
  let v = blockDescCache.get(el);
  if (v !== undefined) return v;
  v = false;
  for (const c of childNodesOf(el)) {
    if (c.nodeType !== 1 || shouldSkip(c)) continue;
    if (isBlockLevel(c) || hasBlockDescendant(c)) {
      v = true;
      break;
    }
  }
  blockDescCache.set(el, v);
  return v;
}

export const isFlowContainer = (el) => !hasBlockDescendant(el);

export function rectOf(el) {
  return el.getBoundingClientRect();
}

export function hasLayout(el) {
  const r = rectOf(el);
  return r.width > 0 && r.height > 0;
}

export function viewportSize(doc = document) {
  const w = doc.defaultView || window;
  return { w: w.innerWidth || 1, h: w.innerHeight || 1 };
}

export function pointInRect(x, y, r, tol = 0) {
  return x >= r.left - tol && x <= r.right + tol && y >= r.top - tol && y <= r.bottom + tol;
}

/** Visible text length without layout (cheap). */
export function textLength(el) {
  return (el.textContent || '').replace(/\s+/g, ' ').trim().length;
}

export function ancestorsOf(el, stopAt = null) {
  const list = [];
  let n = el;
  while (n && n !== stopAt) {
    list.push(n);
    n = parentComposed(n);
  }
  return list;
}

/**
 * Elements under a viewport point, deepest first, piercing open shadow roots.
 */
export function elementsStackAt(x, y, doc = document) {
  let stack = doc.elementsFromPoint(x, y).filter((e) => !isOurs(e));
  let guard = 0;
  while (guard++ < 8) {
    const top = stack.find((e) => e.shadowRoot);
    if (!top) break;
    const inner = top.shadowRoot.elementsFromPoint(x, y).filter((e) => e !== top && !isOurs(e));
    if (!inner.length || stack.includes(inner[0])) break;
    const idx = stack.indexOf(top);
    stack = stack.slice(0, idx).concat(inner, stack.slice(idx));
  }
  return stack;
}

export function isEditable(el) {
  if (!el || !el.closest) return false;
  const t = tagOf(el);
  if (t === 'TEXTAREA' || t === 'SELECT') return true;
  if (t === 'INPUT') {
    const type = (el.getAttribute('type') || 'text').toLowerCase();
    return !['button', 'submit', 'reset', 'image', 'checkbox', 'radio'].includes(type);
  }
  return !!el.isContentEditable;
}
