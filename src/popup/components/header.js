import { icon, LOGO_SVG } from '../../shared/icons.js';
import { escapeHtml } from '../../shared/helpers.js';

export function renderHeader(root, { version, onSettings }) {
  root.innerHTML = `
    <div class="brand">
      <span class="logo">${LOGO_SVG}</span>
      <div class="brand-text">
        <div class="brand-name">Link<b>Lens</b></div>
        <div class="brand-tag">Hover. Discover. Copy.</div>
      </div>
    </div>
    <span class="version">v${escapeHtml(version)}</span>
    <button class="icon-btn" id="hdr-settings" title="Settings" aria-label="Open settings">${icon('settings', 18)}</button>`;
  root.querySelector('#hdr-settings').addEventListener('click', onSettings);
}
