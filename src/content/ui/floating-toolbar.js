import { h } from './shadow-root-ui.js';
import { icon } from '../../shared/icons.js';
import { truncate } from '../../shared/helpers.js';
import { TOOLBAR_W, placeToolbar } from './placement.js';

export { TOOLBAR_W, placeToolbar };

const PANEL_H = 140;

export function createToolbar(ui, { onAction }) {
  const el = h('div', 'toolbar', `
    <div class="handle" title="Hover for copy options">${icon('copy', 12)}<span class="tb-chip-h"></span><span class="tb-meta"></span></div>
    <div class="tb">
      <div class="tb-head"><span class="tb-chip"></span></div>
      <p class="tb-preview"></p>
      <div class="tb-actions">
        <button class="btn" data-a="text" title="Copy exact text (plain)">${icon('copy', 14)}<span>Copy Text</span></button>
        <button class="btn" data-a="element" title="Copy element with structure">${icon('pointer', 14)}<span>Copy Element</span></button>
        <button class="btn" data-a="card" title="Copy the whole card">${icon('card', 14)}<span>Copy Card</span></button>
        <button class="btn" data-a="section" title="Copy the whole section">${icon('section', 14)}<span>Copy Section</span></button>
        <button class="btn icon-only" data-a="preview" title="Preview before copying">${icon('eye', 16)}</button>
      </div>
    </div>`);
  el.hidden = true;
  ui.layer.appendChild(el);
  const chip = el.querySelector('.tb-chip');
  const chipH = el.querySelector('.tb-chip-h');
  const meta = el.querySelector('.tb-meta');
  const prev = el.querySelector('.tb-preview');
  const buttons = Array.from(el.querySelectorAll('[data-a]'));

  el.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('[data-a]');
    if (b) {
      e.preventDefault();
      e.stopPropagation();
      onAction(b.dataset.a, b);
    }
  });
  // keep page focus/selection untouched while using the toolbar
  el.addEventListener('mousedown', (e) => e.preventDefault());

  return {
    el,
    show({ rect, label, preview, meta: metaText, primary }) {
      chip.textContent = label;
      chipH.textContent = label;
      meta.textContent = metaText || '';
      prev.textContent = preview ? truncate(preview.replace(/\s+/g, ' '), 140) : 'No text in this element';
      prev.classList.toggle('empty', !preview);
      buttons.forEach((b) => b.classList.toggle('primary', b.dataset.a === primary));
      el.hidden = false;
      const hw = el.firstElementChild.offsetWidth || 120;
      const hh = el.firstElementChild.offsetHeight || 24;
      const vw = document.documentElement.clientWidth || window.innerWidth;
      const vh = window.innerHeight;
      const pos = placeToolbar(rect, hw, hh, vw, vh);
      const roomUp = pos.top >= PANEL_H + 10;
      const roomDown = pos.top + hh + PANEL_H <= vh - 6;
      const up = pos.side === 'above' ? roomUp || !roomDown : !(roomDown || !roomUp);
      el.classList.toggle('up', up);
      el.classList.toggle('down', !up);
      el.style.setProperty('--shift', `${Math.min(0, Math.round(vw - 8 - (pos.left + TOOLBAR_W)))}px`);
      el.style.transform = `translate(${Math.round(pos.left)}px, ${Math.round(pos.top)}px)`;
    },
    hide() { el.hidden = true; },
    flash(action) {
      const b = buttons.find((x) => x.dataset.a === action);
      if (!b) return;
      b.classList.add('ok');
      setTimeout(() => b.classList.remove('ok'), 700);
    },
    isVisible: () => !el.hidden,
    /** Is the viewport point over the handle (or the open menu)? */
    hit(x, y) {
      if (el.hidden) return false;
      const rs = [el.firstElementChild.getBoundingClientRect()];
      const tb = el.querySelector('.tb');
      if (tb && tb.offsetWidth) rs.push(tb.getBoundingClientRect());
      return rs.some((r) => x >= r.left && x <= r.right && y >= r.top - 2 && y <= r.bottom + 2);
    },
  };
}
