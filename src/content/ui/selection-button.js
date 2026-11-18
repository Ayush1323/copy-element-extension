import { h } from './shadow-root-ui.js';
import { icon } from '../../shared/icons.js';
import { clamp } from '../../shared/helpers.js';

export function createSelectionButton(ui, { onCopy }) {
  const el = h('button', 'selbtn', `${icon('copy', 14)}<span>Copy</span>`);
  el.hidden = true;
  ui.layer.appendChild(el);
  // preserve the page selection: don't let the press move focus or collapse it
  el.addEventListener('mousedown', (e) => e.preventDefault());
  el.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    onCopy();
  });
  return {
    show(rect) {
      el.hidden = false;
      const w = el.offsetWidth || 70;
      const vw = document.documentElement.clientWidth || window.innerWidth;
      const x = clamp(rect.right - w, 8, Math.max(8, vw - w - 8));
      let y = rect.top - 38;
      if (y < 8) y = Math.min(rect.bottom + 8, window.innerHeight - 40);
      el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    },
    hide() { el.hidden = true; el.classList.remove('ok'); },
    flashOk() {
      el.classList.add('ok');
      el.lastChild.textContent = 'Copied';
      setTimeout(() => { el.lastChild.textContent = 'Copy'; el.classList.remove('ok'); }, 900);
    },
    isVisible: () => !el.hidden,
  };
}
