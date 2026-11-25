import { h } from './shadow-root-ui.js';
import { icon } from '../../shared/icons.js';
import { MODE_META } from '../../shared/constants.js';
import { toolByMode } from '../../shared/shortcuts.js';

const TABS = [
  ['element', 'pointer', 'Element'], ['card', 'card', 'Card'], ['section', 'section', 'Section'], ['text', 'text', 'Text'], ['images', 'image', 'Inspect'],
  ['screenshot', 'camera', 'Screenshot'], ['textutils', 'textutils', 'Utils'], ['measure', 'measure', 'Measure'], ['seo', 'seo', 'SEO'],
];

export function createIndicator(ui, { onMode, onExit }) {
  const tabs = TABS.map(([mode, ic, short]) => {
    const t = toolByMode(mode);
    return `<button data-m="${mode}" title="${t.label.replace(/&/g, '&amp;')} (${t.keys.join('+')})">${icon(ic, 13)}<span>${short}</span></button>`;
  }).join('');
  const el = h('div', 'indicator', `
    <span class="dot"></span><span class="ind-title">LinkLens</span>
    <div class="seg" role="tablist">${tabs}</div>
    <button class="ind-exit" title="Exit (Esc)">${icon('x', 12)}<span>Exit</span><kbd>Esc</kbd></button>`);
  el.hidden = true;
  ui.layer.appendChild(el);
  el.addEventListener('click', (e) => {
    const m = e.target.closest && e.target.closest('[data-m]');
    if (m) onMode(m.dataset.m);
    else if (e.target.closest && e.target.closest('.ind-exit')) onExit();
  });
  el.addEventListener('mousedown', (e) => e.preventDefault());
  return {
    show(mode) {
      el.hidden = false;
      el.querySelectorAll('[data-m]').forEach((b) => b.classList.toggle('on', b.dataset.m === mode));
      el.querySelector('.ind-title').textContent = MODE_META[mode] ? MODE_META[mode].label : 'LinkLens';
    },
    hide() { el.hidden = true; },
  };
}
