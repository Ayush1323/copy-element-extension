import { h } from './shadow-root-ui.js';
import { placeBeside } from './placement.js';
import { fmt, ringClip, cardRows } from '../core/measure.js';

const CARD_W = 244;

/**
 * Dimensions overlay: the element's box model drawn like DevTools (margin / border / padding / content), flex & grid
 * gaps, distances to a pinned element, and a small info card. Everything is pointer-events: none: it never gets in the way.
 */
export function createMeasureOverlay(ui) {
  const root = h('div', 'ms');
  const card = h('div', 'ms-card');
  root.hidden = true;
  card.hidden = true;
  ui.layer.append(root, card);

  const at = (cls, r, style = '') => {
    const d = h('div', cls);
    d.style.cssText = `left:${r.left}px;top:${r.top}px;width:${Math.max(0, r.right - r.left)}px;height:${Math.max(0, r.bottom - r.top)}px;${style}`;
    return d;
  };
  const pill = (text, cls, x, y) => {
    const d = h('div', `ms-v ${cls}`);
    d.textContent = text;
    d.style.cssText = `left:${Math.round(x)}px;top:${Math.round(y)}px;`;
    return d;
  };

  function render({ box, layers, gaps, pin, between, label, pointer, pinned, shiftHint }) {
    const vw = document.documentElement.clientWidth || window.innerWidth;
    const vh = window.innerHeight;
    const frag = document.createDocumentFragment();

    // 1. the four boxes
    const rings = [['margin', layers.margin, layers.border], ['border', layers.border, layers.padding], ['padding', layers.padding, layers.content]];
    for (const [name, outer, inner] of rings) {
      const clip = ringClip(outer, inner);
      if (clip) frag.append(at(`ms-box ${name}`, outer, `clip-path:${clip};`));
    }
    frag.append(at('ms-box content', layers.content));

    // 2. flex / grid gaps
    for (const g of gaps) {
      frag.append(at('ms-gap', g));
      const w = g.right - g.left, hh = g.bottom - g.top;
      if (Math.min(w, hh) >= 4) frag.append(pill(fmt(g.value), 'g', (g.left + g.right) / 2, (g.top + g.bottom) / 2));
    }

    // 3. margin and padding numbers in their strips
    const m = box.margin, p = box.padding, b = layers.border, pd = layers.padding;
    const num = (v, cls, x, y) => { if (v >= 3) frag.append(pill(fmt(v), cls, x, y)); };
    const cx = (b.left + b.right) / 2, cy = (b.top + b.bottom) / 2;
    num(m.t, 'm', cx, b.top - Math.max(0, m.t) / 2); num(m.b, 'm', cx, b.bottom + Math.max(0, m.b) / 2);
    num(m.l, 'm', b.left - Math.max(0, m.l) / 2, cy); num(m.r, 'm', b.right + Math.max(0, m.r) / 2, cy);
    num(p.t, 'p', cx, pd.top + p.t / 2); num(p.b, 'p', cx, pd.bottom - p.b / 2);
    num(p.l, 'p', pd.left + p.l / 2, cy); num(p.r, 'p', pd.right - p.r / 2, cy);

    // 4. the pinned element and the distances to it
    if (pin) {
      frag.append(at('ms-pin', pin));
      const chip = h('div', 'ms-pinchip');
      chip.textContent = 'Pinned';
      chip.style.cssText = `left:${Math.round(Math.max(4, pin.left))}px;top:${Math.round(Math.max(4, pin.top - 20))}px;`;
      frag.append(chip);
    }
    if (between) {
      for (const g of between.guides) {
        frag.append(at(`ms-guide ${g.x1 === g.x2 ? 'v' : 'h'}`, { left: Math.min(g.x1, g.x2), right: Math.max(g.x1, g.x2) || 0, top: Math.min(g.y1, g.y2), bottom: Math.max(g.y1, g.y2) }));
      }
      for (const s of between.segs) {
        const horizontal = s.dir === 'h';
        frag.append(at('ms-line', horizontal ? { left: Math.min(s.x1, s.x2), right: Math.max(s.x1, s.x2), top: s.y1 - 0.5, bottom: s.y1 + 0.5 } : { left: s.x1 - 0.5, right: s.x1 + 0.5, top: Math.min(s.y1, s.y2), bottom: Math.max(s.y1, s.y2) }));
        for (const [ex, ey] of [[s.x1, s.y1], [s.x2, s.y2]]) {
          frag.append(at('ms-tick', horizontal ? { left: ex - 0.5, right: ex + 0.5, top: ey - 4, bottom: ey + 4 } : { left: ex - 4, right: ex + 4, top: ey - 0.5, bottom: ey + 0.5 }));
        }
        const mx = (s.x1 + s.x2) / 2, my = (s.y1 + s.y2) / 2;
        frag.append(pill(fmt(s.value), 'd', horizontal ? mx : mx + 16, horizontal ? my - 12 : my));
      }
    }

    // 5. the size label above (or below) the element
    const size = h('div', 'ms-size');
    size.innerHTML = '<b></b><span></span>';
    size.firstChild.textContent = label;
    size.lastChild.textContent = ` ${fmt(box.rect.width)} × ${fmt(box.rect.height)}`;
    const top = layers.margin.top - 26 >= 4 ? layers.margin.top - 26 : Math.min(vh - 26, layers.margin.bottom + 4);
    size.style.cssText = `left:${Math.round(Math.min(Math.max(layers.margin.left, 4), vw - 160))}px;top:${Math.round(top)}px;`;
    frag.append(size);

    root.textContent = '';
    root.append(frag);
    root.hidden = false;

    // 6. the info card, beside the element
    card.textContent = '';
    const head = h('div', 'ms-ch');
    head.textContent = label;
    const list = h('dl', 'ms-cl');
    for (const r of cardRows(box)) {
      const dt = h('dt', r.tone);
      dt.textContent = r.k;
      const dd = h('dd');
      dd.textContent = r.v;
      list.append(dt, dd);
    }
    const hint = h('div', 'ms-hint');
    hint.textContent = pinned ? 'Click to unpin · Alt+C copies CSS' : between ? 'Distance to the pinned element · Alt+C copies CSS' : 'Click to pin · Shift: distance to parent · Alt+↑↓ parent/child · Alt+C copies CSS';
    if (shiftHint) hint.textContent = 'Distance to the parent element';
    card.append(head, list, hint);
    card.hidden = false;
    card.style.width = `${CARD_W}px`;
    const hgt = card.offsetHeight || 150;
    const pos = placeBeside(layers.margin, pointer, CARD_W, hgt, vw, vh, 30, true);
    card.style.transform = `translate(${Math.round(pos.left)}px, ${Math.round(pos.top)}px)`;
  }

  function hide() {
    root.hidden = true;
    card.hidden = true;
  }

  return { render, hide, isShown: () => !root.hidden };
}
