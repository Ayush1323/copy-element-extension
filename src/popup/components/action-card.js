import { icon } from '../../shared/icons.js';
import { escapeHtml } from '../../shared/helpers.js';

export function renderActionCard({ id, title, desc, iconName, hint, featured, active, disabled, onClick }) {
  const b = document.createElement('button');
  b.className = 'action' + (featured ? ' big' : '') + (active ? ' is-active' : '');
  b.dataset.mode = id;
  b.disabled = !!disabled;
  b.setAttribute('aria-pressed', String(!!active));
  b.title = hint ? `${title} (${hint}): ${desc}` : `${title}: ${desc}`;
  b.innerHTML = `
    <span class="a-top"><span class="a-icon">${icon(iconName, featured ? 26 : 20)}</span></span>
    <span class="a-body">
      <span class="a-head">
        <span class="a-title">${escapeHtml(title)}</span>
        <span class="pill ${active ? 'on' : ''}"><i></i>Active</span>
        ${hint ? `<span class="a-kbd" aria-hidden="true">${hint.split('+').map((k) => `<i>${escapeHtml(k)}</i>`).join('')}</span>` : ''}
      </span>
      <span class="a-desc">${escapeHtml(desc)}</span>
    </span>`;
  b.addEventListener('click', () => onClick(id));
  return b;
}
