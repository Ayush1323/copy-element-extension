import { icon } from '../../shared/icons.js';
import { escapeHtml } from '../../shared/helpers.js';

export function renderActionCard({ id, title, desc, iconName, hint, active, disabled, onClick }) {
  const b = document.createElement('button');
  b.className = 'action' + (active ? ' is-active' : '');
  b.dataset.mode = id;
  b.disabled = !!disabled;
  b.setAttribute('aria-pressed', String(!!active));
  if (hint) b.title = `${title} (${hint})`;
  b.innerHTML = `
    <span class="a-top">
      <span class="a-icon">${icon(iconName, 19)}</span>
      <span class="pill ${active ? 'on' : ''}"><i></i>${active ? 'Active' : 'Ready'}</span>
    </span>
    <span class="a-body">
      <span class="a-title">${escapeHtml(title)}</span>
      <span class="a-desc">${escapeHtml(desc)}</span>
    </span>`;
  b.addEventListener('click', () => onClick(id));
  return b;
}
