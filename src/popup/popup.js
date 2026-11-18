import { MSG } from '../shared/message-types.js';
import { MODES } from '../shared/constants.js';
import { getSettings, saveSettings, getHistory, removeHistory, clearHistory, getLast, onStorageChange } from '../shared/storage.js';
import { domainOf, isRestrictedUrl, timeAgo, escapeHtml } from '../shared/helpers.js';
import { icon } from '../shared/icons.js';
import { writeClipboard } from '../content/clipboard/clipboard-manager.js';
import { renderHeader } from './components/header.js';
import { renderActionCard } from './components/action-card.js';
import { renderActivityList } from './components/activity-list.js';

const $ = (s) => document.querySelector(s);
const state = { tab: null, restricted: false, mode: null, settings: null, history: [], last: null, busy: false };

const ACTIONS = [
  { id: MODES.ELEMENT, title: 'Element Picker', desc: 'Hover & copy any text', iconName: 'pointer', hint: 'Alt+E' },
  { id: MODES.CARD, title: 'Card Extractor', desc: 'Grab a whole card', iconName: 'card', hint: '' },
  { id: MODES.SECTION, title: 'Section Extractor', desc: 'Copy a full section', iconName: 'section', hint: 'Alt+S' },
  { id: MODES.TEXT, title: 'Selected Text', desc: 'Copy highlighted text', iconName: 'text', hint: '' },
];

function toast(msg, ok = true) {
  const t = $('#toast');
  t.className = 'toast' + (ok ? '' : ' err');
  t.innerHTML = `${icon(ok ? 'check' : 'alert', 14)}<span>${escapeHtml(msg)}</span>`;
  t.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (t.hidden = true), 1800);
}

async function loadTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  state.tab = tab || null;
  state.restricted = !tab || isRestrictedUrl(tab.url);
  state.mode = null;
  if (tab && !state.restricted) {
    try {
      const res = await chrome.tabs.sendMessage(tab.id, { type: MSG.GET_STATE });
      state.mode = res ? res.mode : null;
    } catch (_) { /* content script not injected → picker inactive */ }
  }
}

function renderNotice(text, tone = 'warn') {
  const n = $('#notice');
  if (!text) { n.hidden = true; return; }
  n.hidden = false;
  n.className = `notice ${tone}`;
  n.innerHTML = `${icon('alert', 16)}<span>${escapeHtml(text)}</span>`;
}

function renderActions() {
  const root = $('#actions');
  root.textContent = '';
  for (const a of ACTIONS) {
    root.appendChild(renderActionCard({ ...a, active: state.mode === a.id, disabled: state.restricted || state.busy, onClick: activate }));
  }
}

function renderFormat() {
  const root = $('#format');
  const cur = state.settings.defaultFormat;
  root.innerHTML = [
    ['plain', 'Plain Text', 'file'],
    ['rich', 'Rich Text (HTML)', 'bolt'],
  ].map(([v, label, ic]) => `<button role="radio" aria-checked="${cur === v}" class="${cur === v ? 'on' : ''}" data-v="${v}">${icon(ic, 15)}${label}</button>`).join('');
  root.querySelectorAll('button').forEach((b) => b.addEventListener('click', async () => {
    state.settings = await saveSettings({ defaultFormat: b.dataset.v });
    renderFormat();
  }));
}

function renderStatus() {
  const active = !!state.mode;
  const domain = state.tab && !state.restricted ? domainOf(state.tab.url) : state.restricted ? 'Restricted page' : '—';
  const last = state.last;
  const modeName = { element: 'Element Picker', card: 'Card Extractor', section: 'Section Extractor', text: 'Selected Text' }[state.mode];
  $('#status').innerHTML = `
    <div class="cell"><span class="k">${icon('pointer', 13)}Picker</span><span class="v"><i class="dot ${active ? 'on' : ''}"></i>${active ? escapeHtml(modeName) : 'Inactive'}</span></div>
    <div class="cell"><span class="k">${icon('globe', 13)}Website</span><span class="v" title="${escapeHtml(domain)}">${escapeHtml(domain || '—')}</span></div>
    <div class="cell"><span class="k">${icon('file', 13)}Last copied</span><span class="v">${last ? escapeHtml(last.type || 'Text') : '—'}</span></div>
    <div class="cell"><span class="k">${icon('clock', 13)}Status</span><span class="v ${last ? 'good' : ''}">${last ? `${icon('check', 13)}Copied ${timeAgo(last.at)}` : 'Nothing copied yet'}</span></div>`;
}

function renderActivity() {
  const s = state.settings;
  renderActivityList($('#activity'), {
    items: state.history.slice(0, 4),
    enabled: s.historyEnabled,
    onOpenSettings: () => chrome.runtime.openOptionsPage(),
    onCopy: async (it, btn) => {
      const res = await writeClipboard({ text: it.text, html: s.defaultFormat === 'rich' ? it.html : '' });
      if (res.ok) { btn.innerHTML = icon('check', 15); btn.classList.add('ok'); toast('Copied to clipboard'); } else toast(res.error || 'Copy failed', false);
    },
    onDelete: async (it) => { state.history = await removeHistory(it.id); renderActivity(); },
  });
  $('#clear-all').hidden = !(s.historyEnabled && state.history.length);
}

function renderFooter() {
  const f = $('#footer');
  f.innerHTML = `
    <button class="foot-btn" data-s="settings">${icon('settings', 14)}Settings</button>
    <button class="foot-btn" data-s="shortcuts">${icon('keyboard', 14)}Shortcuts</button>
    <button class="foot-btn" data-s="privacy">${icon('shield', 14)}Privacy</button>
    <span class="foot-ver">v${chrome.runtime.getManifest().version}</span>`;
  f.querySelectorAll('[data-s]').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.s === 'settings') chrome.runtime.openOptionsPage();
    else openSheet(b.dataset.s);
  }));
}

function openSheet(kind) {
  const sheet = $('#sheet');
  const kb = (a) => `<kbd>${a}</kbd>`;
  const body = kind === 'shortcuts'
    ? `<h3>Keyboard shortcuts</h3>
       <ul class="rows">
        <li><span>Activate Element Picker</span>${kb('Alt + E')}</li>
        <li><span>Activate Section Extractor</span>${kb('Alt + S')}</li>
        <li><span>Copy hovered element</span>${kb('Alt + C')}</li>
        <li><span>Select parent / child</span>${kb('Alt + ↑ / ↓')}</li>
        <li><span>Exit current mode</span>${kb('Esc')}</li>
       </ul>
       <button class="primary-btn" id="open-shortcuts">Customize at chrome://extensions/shortcuts</button>`
    : `<h3>Privacy</h3>
       <ul class="bullets">
        <li>Everything runs locally in your browser.</li>
        <li>No servers, analytics, tracking or external APIs.</li>
        <li>Copy history stays in local extension storage — clear or disable it any time.</li>
        <li>The extension only touches a page when you activate it (activeTab).</li>
        <li>Copied HTML is sanitized before it reaches your clipboard.</li>
       </ul>`;
  sheet.innerHTML = `<div class="sheet-card">${body}<button class="link close-sheet">Close</button></div>`;
  sheet.hidden = false;
  sheet.querySelector('.close-sheet').addEventListener('click', () => (sheet.hidden = true));
  sheet.addEventListener('click', (e) => { if (e.target === sheet) sheet.hidden = true; });
  const os = sheet.querySelector('#open-shortcuts');
  if (os) os.addEventListener('click', () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }));
}

async function activate(mode) {
  if (!state.tab || state.busy) return;
  state.busy = true;
  const res = await chrome.runtime.sendMessage({ type: MSG.ACTIVATE, tabId: state.tab.id, mode, toggle: true });
  state.busy = false;
  if (!res || !res.ok) {
    renderNotice((res && res.error) || 'Could not start on this page.');
    return;
  }
  // The popup closes so the page is fully usable — the on-page indicator shows the active mode.
  window.close();
}

async function init() {
  state.settings = await getSettings();
  renderHeader($('#header'), { version: chrome.runtime.getManifest().version, onSettings: () => chrome.runtime.openOptionsPage() });
  renderFooter();
  await Promise.all([loadTab(), getHistory().then((h) => (state.history = h)), getLast().then((l) => (state.last = l))]);
  if (state.restricted) renderNotice('Chrome blocks extensions on this page (browser pages, the Web Store, or unsupported URLs). Open a regular website to start.');
  renderActions();
  renderFormat();
  renderStatus();
  renderActivity();
  $('#clear-all').addEventListener('click', async () => { await clearHistory(); state.history = []; renderActivity(); });
  onStorageChange(async () => {
    [state.settings, state.history, state.last] = await Promise.all([getSettings(), getHistory(), getLast()]);
    renderFormat(); renderStatus(); renderActivity();
  });
}

init().catch((e) => { console.error(e); renderNotice('Something went wrong: ' + (e && e.message)); });
