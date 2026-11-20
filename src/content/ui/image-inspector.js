import { h } from './shadow-root-ui.js';
import { placeLinkPanel } from './placement.js';
import {
  readImageInfo, infoRows, infoSignature, formatBytes, middleTruncate, getFileSize, cachedSize, loadNatural, cachedNatural,
} from '../core/image-info.js';

const sizeLabel = (n) => (n === undefined ? 'Loading…' : formatBytes(n));
const KIND = { img: 'IMAGE', bg: 'BACKGROUND IMAGE' };

/**
 * DevTools-style tooltip for the image / background image under the pointer.
 * Never interactive (pointer-events: none), so it can never steal the hover or flicker.
 */
export function createImageTip(ui) {
  const el = h('div', 'imgtip', `
    <div class="it-head"><span class="it-chip"></span><span class="it-hint">Alt+C copies URL</span></div>
    <img class="it-thumb" alt="">
    <dl class="it-list"></dl>`);
  el.hidden = true;
  ui.layer.appendChild(el);
  const chip = el.querySelector('.it-chip');
  const thumb = el.querySelector('.it-thumb');
  const list = el.querySelector('.it-list');
  let current = null; // element currently described
  let sig = '';
  let sizeCell = null;
  let placed = false;

  function fill(info) {
    chip.textContent = KIND[info.kind];
    if (thumb.getAttribute('src') !== info.src) thumb.src = info.src;
    list.textContent = '';
    sizeCell = null;
    for (const [k, v] of infoRows(info, sizeLabel(cachedSize(info.src)))) {
      const dt = h('dt'); dt.textContent = k;
      const dd = h('dd'); dd.textContent = k === 'Current source' ? middleTruncate(v, 64) : v;
      if (k === 'Current source') dd.title = v;
      if (k === 'File size') sizeCell = dd;
      list.append(dt, dd);
    }
  }

  /** Next to the element; for big targets (hero backgrounds, full-width banners) next to the pointer instead. */
  function place(rect, pointer) {
    const vw = document.documentElement.clientWidth || window.innerWidth;
    const vh = window.innerHeight;
    const w = Math.min(340, vw - 12);
    el.style.width = `${w}px`;
    const hgt = el.offsetHeight || 220;
    const big = rect.height > vh * 0.45 || rect.width > vw * 0.9;
    let pos;
    if (big && pointer && pointer.x >= 0) {
      const a = { left: pointer.x + 14, right: pointer.x + 15, top: pointer.y - 4, bottom: pointer.y + 18 };
      pos = placeLinkPanel(a, w, hgt, vw, vh, hgt + 10);
      if (pos.left + w > vw - 6) pos.left = Math.max(6, pointer.x - w - 14);
      if (pos.side === 'inside') pos.top = Math.min(Math.max(6, pointer.y + 18), vh - hgt - 6);
    } else pos = placeLinkPanel(rect, w, hgt, vw, vh, 30); // clear the outline's label chip
    el.style.transform = `translate(${Math.round(pos.left)}px, ${Math.round(pos.top)}px)`;
    placed = true;
  }

  return {
    show(target, rect, pointer) {
      const info = readImageInfo(target);
      const s = infoSignature(info);
      const changed = target.el !== current || s !== sig;
      if (changed) {
        const newTarget = target.el !== current;
        current = target.el;
        sig = s;
        fill(info);
        if (newTarget) {
          if (cachedSize(info.src) === undefined) {
            getFileSize(info.src).then((n) => { if (current === target.el && sizeCell) sizeCell.textContent = formatBytes(n); });
          }
          if (target.kind === 'bg' && cachedNatural(info.src) === undefined) {
            loadNatural(info.src).then(() => { if (current === target.el) this.show(target, target.el.getBoundingClientRect(), pointer); });
          }
        }
      }
      if (el.hidden) { placed = false; el.style.visibility = 'hidden'; el.hidden = false; }
      place(rect, pointer);
      el.style.visibility = ''; // revealed only once positioned: no jump from the corner
    },
    hide() { el.hidden = true; current = null; sig = ''; placed = false; },
    isVisible: () => !el.hidden,
    isPlaced: () => placed,
  };
}
