import { h } from './shadow-root-ui.js';
import { icon } from '../../shared/icons.js';

export function createToaster(ui, isEnabled) {
  const wrap = h('div', 'toasts');
  ui.layer.appendChild(wrap);
  return {
    show(message, { type = 'success', detail = '', force = false } = {}) {
      if (!force && type === 'success' && !isEnabled()) return;
      const t = h('div', `toast ${type}`, `<span class="ti">${icon(type === 'error' ? 'x' : 'check', 13)}</span><span class="tt"></span>`);
      const tt = t.querySelector('.tt');
      tt.textContent = message;
      if (detail) {
        const s = document.createElement('small');
        s.textContent = detail;
        tt.appendChild(s);
      }
      t.firstChild.style.color = '#fff';
      while (wrap.children.length > 2) wrap.firstChild.remove();
      wrap.appendChild(t);
      setTimeout(() => {
        t.classList.add('out');
        setTimeout(() => t.remove(), 220);
      }, type === 'error' ? 3200 : 1700);
    },
  };
}
