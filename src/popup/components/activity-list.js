import { icon } from '../../shared/icons.js';
import { escapeHtml, truncate, timeAgo } from '../../shared/helpers.js';

export function renderActivityList(root, { items, enabled, onCopy, onDelete, onOpenSettings }) {
  root.textContent = '';
  if (!enabled) {
    root.innerHTML = `<div class="empty">
      <span class="empty-ic">${icon('history', 22)}</span>
      <b>Copy history is off</b>
      <span>Nothing is being stored. You can turn it on in settings.</span>
      <button class="link" id="open-settings-link">Open settings</button></div>`;
    root.querySelector('#open-settings-link').addEventListener('click', onOpenSettings);
    return;
  }
  if (!items.length) {
    root.innerHTML = `<div class="empty">
      <span class="empty-ic">${icon('copy', 22)}</span>
      <b>Nothing copied yet</b>
      <span>Pick an element on any page — copied items show up here so you can copy them again.</span></div>`;
    return;
  }
  const list = document.createElement('ul');
  list.className = 'activity';
  for (const it of items) {
    const li = document.createElement('li');
    li.innerHTML = `
      <span class="chip">${escapeHtml(it.type || 'Text')}</span>
      <div class="a-main">
        <div class="a-text">${escapeHtml(truncate((it.text || '').replace(/\s+/g, ' '), 70))}</div>
        <div class="a-meta">${escapeHtml(it.domain || '—')} · ${timeAgo(it.at)}</div>
      </div>
      <button class="icon-btn sm" data-act="copy" title="Copy again" aria-label="Copy again">${icon('copy', 15)}</button>
      <button class="icon-btn sm danger" data-act="del" title="Remove" aria-label="Remove">${icon('x', 15)}</button>`;
    li.querySelector('[data-act="copy"]').addEventListener('click', (e) => onCopy(it, e.currentTarget));
    li.querySelector('[data-act="del"]').addEventListener('click', () => onDelete(it));
    list.appendChild(li);
  }
  root.appendChild(list);
}
