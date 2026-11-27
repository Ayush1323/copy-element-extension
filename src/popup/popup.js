import { MSG } from '../shared/message-types.js';
import { MODES } from '../shared/constants.js';
import { applyTheme } from '../shared/themes.js';
import { TOOLS, EXTRA, shortcutOf } from '../shared/shortcuts.js';
import { getSettings, saveSettings, getHistory, removeHistory, clearHistory, getLast, onStorageChange } from '../shared/storage.js';
import { domainOf, isRestrictedUrl, timeAgo, escapeHtml } from '../shared/helpers.js';
import { icon } from '../shared/icons.js';
import { normalizeDomain } from '../shared/site-crawl.js';
import { writeClipboard } from '../content/clipboard/clipboard-manager.js';
import { renderHeader } from './components/header.js';
import { renderActionCard } from './components/action-card.js';
import { renderActivityList } from './components/activity-list.js';

const $ = (s) => document.querySelector(s);
const state = { tab: null, restricted: false, mode: null, settings: null, history: [], last: null, busy: false };

const ACTIONS = [
  // the four everyday tools: big cards on one line
  { id: MODES.ELEMENT, title: 'Text Picker', desc: 'Hover & copy any text', iconName: 'pointer', hint: shortcutOf(MODES.ELEMENT), featured: true },
  { id: MODES.TEXTUTILS, title: 'Text Utils', desc: 'Case, spaces & find / replace', iconName: 'textutils', hint: shortcutOf(MODES.TEXTUTILS), featured: true },
  { id: MODES.SCREENSHOT, title: 'Screenshot', desc: 'Capture & annotate the page', iconName: 'camera', hint: shortcutOf(MODES.SCREENSHOT), featured: true },
  { id: MODES.SEO, title: 'SEO Analyzer', desc: 'Meta, links, images & schema', iconName: 'seo', hint: shortcutOf(MODES.SEO), featured: true },
  // more tools
  // not an on-page mode: it opens its own page, so it also works where Chrome blocks extensions
  { id: 'site', title: 'Site Analyzer', desc: 'DA, PA, spam score & fixes', iconName: 'authority', page: 'domain/domain.html' },
  { id: MODES.IMAGES, title: 'Inspect Images & Text', desc: 'Image size & source, fonts and colors', iconName: 'image', hint: shortcutOf(MODES.IMAGES) },
  { id: MODES.MEASURE, title: 'Dimensions', desc: 'Size, spacing & gaps between elements', iconName: 'measure', hint: shortcutOf(MODES.MEASURE) },
  { id: MODES.CARD, title: 'Card Extractor', desc: 'Grab a whole card', iconName: 'card', hint: shortcutOf(MODES.CARD) },
  { id: MODES.SECTION, title: 'Section Extractor', desc: 'Copy a full section', iconName: 'section', hint: shortcutOf(MODES.SECTION) },
  { id: MODES.TEXT, title: 'Selected Text', desc: 'Copy highlighted text', iconName: 'text', hint: shortcutOf(MODES.TEXT) },
];

function toast(msg, ok = true) {
  const t = $('#toast');
  t.className = 'toast' + (ok ? '' : ' err');
  t.innerHTML = `${icon(ok ? 'check' : 'alert', 14)}<span>${escapeHtml(msg)}</span>`;
  t.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (t.hidden = true), 1800);
}

/** The active tab: one fast browser call. Whether LinkLens is already running there is asked separately (see refreshMode). */
async function loadTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  state.tab = tab || null;
  state.restricted = !tab || isRestrictedUrl(tab.url);
  state.mode = null;
}

/** Ask the page which mode is on. A busy page can take a while to answer, so nothing is held back for it. */
async function refreshMode() {
  const tab = state.tab;
  if (!tab || state.restricted) return;
  try {
    const res = await chrome.tabs.sendMessage(tab.id, { type: MSG.GET_STATE }, { frameId: 0 });
    const mode = res ? res.mode : null;
    if (mode !== state.mode) { state.mode = mode; renderActions(); renderStatus(); }
  } catch (_) { /* content script not injected → picker inactive */ }
}

function renderNotice(text, tone = 'warn') {
  const n = $('#notice');
  if (!text) { n.hidden = true; return; }
  n.hidden = false;
  n.className = `notice ${tone}`;
  n.innerHTML = `${icon('alert', 16)}<span>${escapeHtml(text)}</span>`;
}

function renderActions() {
  const big = $('#actions'), more = $('#more');
  big.textContent = '';
  more.textContent = '';
  for (const a of ACTIONS) {
    (a.featured ? big : more).appendChild(renderActionCard({ ...a, active: state.mode === a.id, disabled: !a.page && (state.restricted || state.busy), onClick: a.page ? () => openToolPage(a.page) : activate }));
  }
}

/** Arrow keys move between the tool cards (two columns). */
function wireKeys() {
  document.addEventListener('keydown', (e) => {
    const card = e.target && e.target.closest && e.target.closest('.action');
    if (!card || !/^Arrow/.test(e.key)) return;
    const list = [...document.querySelectorAll('.action')].filter((c) => !c.disabled);
    const i = list.indexOf(card);
    const next = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'ArrowDown' ? i + 2 : i - 2;
    e.preventDefault();
    const target = list[Math.min(Math.max(next, 0), list.length - 1)];
    if (target) target.focus();
  });
}

function renderFormat() {
  const root = $('#format');
  const cur = state.settings.defaultFormat;
  root.innerHTML = [
    ['plain', 'Plain Text', 'file'],
    ['rich', 'Rich Text', 'bolt'],
    ['markdown', 'Markdown', 'link'],
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
  const modeName = { element: 'Element Picker', card: 'Card Extractor', section: 'Section Extractor', text: 'Selected Text', images: 'Inspect Images & Text', screenshot: 'Screenshot', textutils: 'Text Utils', measure: 'Dimensions', seo: 'SEO Analyzer' }[state.mode];
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
  const kb = (a) => `<kbd>${escapeHtml(a)}</kbd>`;
  const body = kind === 'shortcuts'
    ? `<h3>Keyboard shortcuts</h3>
       <ul class="rows">
        ${TOOLS.map((t) => `<li><span>${escapeHtml(t.label)}</span>${t.keys.map(kb).join('')}</li>`).join('')}
        ${EXTRA.map((x) => `<li><span>${escapeHtml(x.label)}</span>${x.keys.map(kb).join('')}${x.keys2 ? ' / ' + x.keys2.map(kb).join('') : ''}</li>`).join('')}
       </ul>
       <button class="primary-btn" id="open-shortcuts">Customize at chrome://extensions/shortcuts</button>`
    : `<h3>Privacy</h3>
       <ul class="bullets">
        <li>The page tools run locally in your browser.</li>
        <li>No analytics or tracking.</li>
        <li>The Site Analyzer reads the website you scan. Domain Authority asks your own server on this computer.</li>
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

/** Opens a tool that lives on its own page, with the current website's domain already filled in. */
async function openToolPage(page) {
  const domain = state.tab && !state.restricted ? normalizeDomain(state.tab.url) : '';
  await chrome.tabs.create({ url: chrome.runtime.getURL(page) + (domain ? `?domain=${encodeURIComponent(domain)}` : '') });
  window.close();
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
  // Everything the first paint needs is fetched in parallel; the page itself is never waited for.
  const [settings, history, last] = await Promise.all([getSettings(), getHistory(), getLast(), loadTab()]);
  state.settings = settings;
  applyTheme(document.documentElement, settings.theme); // before the first paint
  state.history = history;
  state.last = last;
  renderHeader($('#header'), { onSettings: () => chrome.runtime.openOptionsPage() });
  renderFooter();
  if (state.restricted) renderNotice('Chrome blocks extensions on this page (browser pages, the Web Store, or unsupported URLs). Open a regular website to start.');
  renderActions();
  wireKeys();
  renderFormat();
  renderStatus();
  renderActivity();
  $('#clear-all').addEventListener('click', async () => { await clearHistory(); state.history = []; renderActivity(); });
  onStorageChange(async () => {
    [state.settings, state.history, state.last] = await Promise.all([getSettings(), getHistory(), getLast()]);
    applyTheme(document.documentElement, state.settings.theme);
    renderFormat(); renderStatus(); renderActivity();
  });
  refreshMode();
}

init().catch((e) => { console.error(e); renderNotice('Something went wrong: ' + (e && e.message)); });
