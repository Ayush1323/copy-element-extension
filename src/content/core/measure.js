// Dimensions mode: reads an element's box model (size, margin, border, padding, flex/grid gap) and measures the distance
// between two elements. The geometry helpers are pure so they can be tested without a browser.

const EPS = 0.5;
const px = (v) => { const s = String(v || ''); if (s.endsWith('%')) return 0; const n = parseFloat(s); return Number.isFinite(n) ? n : 0; };

/** 12 → "12", 12.5 → "12.5", 12.04 → "12". */
export const fmt = (n) => { const v = Math.round(n * 10) / 10; return Number.isInteger(v) ? String(v) : v.toFixed(1); };

const plainRect = (r) => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height });
const side4 = (cs, p, suf = '') => ({ t: px(cs[`${p}Top${suf}`]), r: px(cs[`${p}Right${suf}`]), b: px(cs[`${p}Bottom${suf}`]), l: px(cs[`${p}Left${suf}`]) });

/** Everything the overlay and the info card need about one element. */
export function readBox(el) {
  const cs = getComputedStyle(el);
  const rect = plainRect(el.getBoundingClientRect());
  const flexish = /flex|grid/.test(cs.display);
  return {
    rect,
    margin: side4(cs, 'margin'),
    padding: side4(cs, 'padding'),
    border: side4(cs, 'border', 'Width'),
    display: cs.display,
    position: cs.position,
    flexDirection: /flex/.test(cs.display) ? cs.flexDirection : '',
    gapRow: flexish ? px(cs.rowGap) : 0,
    gapCol: flexish ? px(cs.columnGap) : 0,
    boxSizing: cs.boxSizing,
    // as written in CSS (what a developer would type), not the possibly transformed on-screen size
    cssWidth: cs.width,
    cssHeight: cs.height,
  };
}

/** The four nested boxes DevTools shows: margin ⊃ border ⊃ padding ⊃ content (negative margins are not drawn). */
export function boxLayers(b) {
  const r = b.rect;
  const m = { t: Math.max(0, b.margin.t), r: Math.max(0, b.margin.r), b: Math.max(0, b.margin.b), l: Math.max(0, b.margin.l) };
  const grow = (o, s) => ({ left: o.left - s.l, top: o.top - s.t, right: o.right + s.r, bottom: o.bottom + s.b });
  const shrink = (o, s) => {
    const left = o.left + s.l, top = o.top + s.t, right = Math.max(left, o.right - s.r), bottom = Math.max(top, o.bottom - s.b);
    return { left, top, right, bottom };
  };
  const border = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  const padding = shrink(border, b.border);
  const content = shrink(padding, b.padding);
  return { margin: grow(border, m), border, padding, content };
}

/** clip-path that keeps only the ring between `outer` and `inner` (both in viewport px). Returns '' when there is no ring. */
export function ringClip(outer, inner) {
  const w = outer.right - outer.left, h = outer.bottom - outer.top;
  const il = inner.left - outer.left, it = inner.top - outer.top, ir = inner.right - outer.left, ib = inner.bottom - outer.top;
  if (w <= 0 || h <= 0) return '';
  if (Math.abs(il) < 0.01 && Math.abs(it) < 0.01 && Math.abs(ir - w) < 0.01 && Math.abs(ib - h) < 0.01) return '';
  const p = (x, y) => `${fmt(x)}px ${fmt(y)}px`;
  return `polygon(evenodd, ${p(0, 0)}, ${p(w, 0)}, ${p(w, h)}, ${p(0, h)}, ${p(0, 0)}, ${p(il, it)}, ${p(il, ib)}, ${p(ir, ib)}, ${p(ir, it)}, ${p(il, it)})`;
}

const overlapX = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left);
const overlapY = (a, b) => Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);

/**
 * The gap strips between the children of a flex / grid container: [{left, top, right, bottom, value, axis}].
 * `rects` are the children's boxes; only neighbours that really are `gap` apart count.
 */
export function gapStrips(rects, gapCol, gapRow) {
  const out = [];
  const list = rects.slice(0, 80);
  for (let i = 0; i < list.length; i++) {
    for (let j = 0; j < list.length; j++) {
      if (i === j) continue;
      const a = list[i], b = list[j];
      if (gapCol > 0 && Math.abs(b.left - a.right - gapCol) <= 1 && overlapY(a, b) > 1) {
        out.push({ left: a.right, right: b.left, top: Math.max(a.top, b.top), bottom: Math.min(a.bottom, b.bottom), value: gapCol, axis: 'col' });
      }
      if (gapRow > 0 && Math.abs(b.top - a.bottom - gapRow) <= 1 && overlapX(a, b) > 1) {
        out.push({ left: Math.max(a.left, b.left), right: Math.min(a.right, b.right), top: a.bottom, bottom: b.top, value: gapRow, axis: 'row' });
      }
    }
  }
  return out;
}

/** Gap strips of a real element (flex or grid with a non-zero gap). */
export function readGaps(el, box) {
  if (!(box.gapRow > 0 || box.gapCol > 0)) return [];
  const rects = [];
  for (const c of el.children) {
    if (rects.length >= 80) break;
    const cs = getComputedStyle(c);
    if (cs.display === 'none' || cs.position === 'absolute' || cs.position === 'fixed') continue;
    const r = c.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) rects.push(plainRect(r));
  }
  return gapStrips(rects, box.gapCol, box.gapRow);
}

/**
 * Distances between two boxes (viewport px), Figma style.
 * Returns { segs: [{x1,y1,x2,y2,value,dir:'h'|'v'}], guides: [{x1,y1,x2,y2}] }:
 *  - one inside the other: the four distances between their edges
 *  - side by side / above / diagonal: the gap on each axis that has one, with dashed guides to the boxes
 *  - overlapping: how far the matching edges are apart
 */
export function measureBetween(A, B) {
  const segs = [];
  const guides = [];
  const H = (x1, x2, y) => ({ x1, y1: y, x2, y2: y, value: Math.abs(x2 - x1), dir: 'h' });
  const V = (y1, y2, x) => ({ x1: x, y1, x2: x, y2, value: Math.abs(y2 - y1), dir: 'v' });
  const add = (s) => { if (s.value > EPS) segs.push(s); return s; };
  const contains = (o, i) => i.left >= o.left - EPS && i.right <= o.right + EPS && i.top >= o.top - EPS && i.bottom <= o.bottom + EPS;

  // a dashed guide from a segment end to the box edge it belongs to, when the end floats beside the box
  const touch = (s, r) => {
    const ends = [[s.x1, s.y1], [s.x2, s.y2]];
    for (const [x, y] of ends) {
      if (s.dir === 'h' && (Math.abs(r.left - x) <= EPS || Math.abs(r.right - x) <= EPS)) {
        if (y < r.top - EPS) guides.push({ x1: x, y1: y, x2: x, y2: r.top }); else if (y > r.bottom + EPS) guides.push({ x1: x, y1: y, x2: x, y2: r.bottom });
      }
      if (s.dir === 'v' && (Math.abs(r.top - y) <= EPS || Math.abs(r.bottom - y) <= EPS)) {
        if (x < r.left - EPS) guides.push({ x1: x, y1: y, x2: r.left, y2: y }); else if (x > r.right + EPS) guides.push({ x1: x, y1: y, x2: r.right, y2: y });
      }
    }
  };

  const outer = contains(A, B) ? A : contains(B, A) ? B : null;
  if (outer) {
    const inner = outer === A ? B : A;
    const cx = (inner.left + inner.right) / 2, cy = (inner.top + inner.bottom) / 2;
    add(H(outer.left, inner.left, cy)); add(H(inner.right, outer.right, cy));
    add(V(outer.top, inner.top, cx)); add(V(inner.bottom, outer.bottom, cx));
    return { segs, guides };
  }

  const ox = overlapX(A, B), oy = overlapY(A, B);
  if (ox > 0 && oy > 0) { // overlapping: distance between matching edges
    const my = Math.max(A.top, B.top) + oy / 2, mx = Math.max(A.left, B.left) + ox / 2;
    add(H(A.left, B.left, my)); add(H(A.right, B.right, my));
    add(V(A.top, B.top, mx)); add(V(A.bottom, B.bottom, mx));
    return { segs, guides };
  }
  if (ox <= 0) { // one is left of the other
    const [L, R] = A.right <= B.left ? [A, B] : [B, A];
    const y = oy > 0 ? Math.max(A.top, B.top) + oy / 2 : (L.top + L.bottom) / 2;
    const s = add(H(L.right, R.left, y));
    if (s.value > EPS) { touch(s, L); touch(s, R); }
  }
  if (oy <= 0) { // one is above the other
    const [T, Bt] = A.bottom <= B.top ? [A, B] : [B, A];
    const x = ox > 0 ? Math.max(A.left, B.left) + ox / 2 : (Bt.left + Bt.right) / 2;
    const s = add(V(T.bottom, Bt.top, x));
    if (s.value > EPS) { touch(s, T); touch(s, Bt); }
  }
  return { segs, guides };
}

/** tag#id.class, short enough for a label. */
export function shortSelector(el) {
  const tag = (el.localName || '').toLowerCase();
  let s = tag;
  if (el.id) s += `#${el.id}`;
  else {
    const c = typeof el.className === 'string' ? el.className.trim().split(/\s+/).filter(Boolean)[0] : '';
    if (c) s += `.${c}`;
  }
  return s.length > 34 ? `${s.slice(0, 33)}…` : s;
}

const sides = (s) => [s.t, s.r, s.b, s.l];
const isZero = (s) => sides(s).every((v) => Math.abs(v) < 0.01);
/** CSS shorthand style: 4 equal → "8", t/b + l/r → "8 16", else all four. */
export function shorthand(s) {
  const [t, r, b, l] = sides(s).map(fmt);
  if (t === r && r === b && b === l) return t;
  if (t === b && r === l) return `${t} ${r}`;
  return `${t} ${r} ${b} ${l}`;
}

/** Rows for the info card: [{k, v, tone}] (zero margins / paddings / borders are left out). */
export function cardRows(b) {
  const rows = [{ k: 'Size', v: `${fmt(b.rect.width)} × ${fmt(b.rect.height)}`, tone: 'size' }];
  if (!isZero(b.margin)) rows.push({ k: 'Margin', v: shorthand(b.margin), tone: 'margin' });
  if (!isZero(b.border)) rows.push({ k: 'Border', v: shorthand(b.border), tone: 'border' });
  if (!isZero(b.padding)) rows.push({ k: 'Padding', v: shorthand(b.padding), tone: 'padding' });
  if (b.gapRow > 0 || b.gapCol > 0) rows.push({ k: 'Gap', v: b.gapRow === b.gapCol ? fmt(b.gapRow) : `${fmt(b.gapRow)} / ${fmt(b.gapCol)}`, tone: 'gap' });
  rows.push({ k: 'Display', v: b.flexDirection && b.flexDirection !== 'row' ? `${b.display} · ${b.flexDirection}` : b.display, tone: '' });
  if (b.position && b.position !== 'static') rows.push({ k: 'Position', v: b.position, tone: '' });
  return rows;
}

/** The measurements as paste-ready CSS. */
export function cssSummary(b, selector = '') {
  const lines = [`width: ${fmt(b.rect.width)}px;`, `height: ${fmt(b.rect.height)}px;`];
  const unit = (s) => sides(s).map((v) => `${fmt(v)}px`).join(' ');
  if (!isZero(b.margin)) lines.push(`margin: ${unit(b.margin)};`);
  if (!isZero(b.border)) lines.push(`border-width: ${unit(b.border)};`);
  if (!isZero(b.padding)) lines.push(`padding: ${unit(b.padding)};`);
  if (b.gapRow > 0 || b.gapCol > 0) lines.push(b.gapRow === b.gapCol ? `gap: ${fmt(b.gapRow)}px;` : `gap: ${fmt(b.gapRow)}px ${fmt(b.gapCol)}px;`);
  return (selector ? `/* ${selector} */\n` : '') + lines.join('\n');
}

/** Topmost element under the point, looking through open shadow roots. Our own UI is never returned. */
export function deepElementAt(x, y) {
  let el = document.elementFromPoint(x, y);
  while (el && el.shadowRoot) {
    const inner = el.shadowRoot.elementFromPoint(x, y);
    if (!inner || inner === el) break;
    el = inner;
  }
  return el && el.localName === 'linklens-root' ? null : el;
}
