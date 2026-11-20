import { h } from './shadow-root-ui.js';
import { icon } from '../../shared/icons.js';
import { MODE_META } from '../../shared/constants.js';

export function createIndicator(ui, { onMode, onExit }) {
  const el = h('div', 'indicator', `
    <span class="dot"></span><span class="ind-title">LinkLens</span>
    <div class="seg" role="tablist">
      <button data-m="element" title="Element Picker (Alt+E)">${icon('pointer', 13)}<span>Element</span></button>
      <button data-m="card" title="Card Extractor">${icon('card', 13)}<span>Card</span></button>
      <button data-m="section" title="Section Extractor (Alt+S)">${icon('section', 13)}<span>Section</span></button>
      <button data-m="text" title="Selected Text">${icon('text', 13)}<span>Text</span></button>
      <button data-m="images" title="Inspect Images">${icon('image', 13)}<span>Images</span></button>
      <button data-m="screenshot" title="Screenshot (Alt+Shift+S)">${icon('camera', 13)}<span>Screenshot</span></button>
    </div>
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
