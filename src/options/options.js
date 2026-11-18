import { DEFAULT_SETTINGS } from '../shared/constants.js';
import { getSettings, saveSettings, resetSettings, getHistory, clearHistory } from '../shared/storage.js';
import { LOGO_SVG_LG as LOGO_SVG } from '../shared/icons.js';

const PRESETS = ['#2563EB', '#7C3AED', '#0891B2', '#16A34A', '#F59E0B', '#E11D48'];
const $ = (s, r = document) => r.querySelector(s);
let settings = { ...DEFAULT_SETTINGS };
let savedTimer;

function flashSaved(msg = 'Saved') {
  const s = $('#saved');
  s.textContent = '✓ ' + msg;
  s.classList.add('show');
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => s.classList.remove('show'), 1400);
}

async function update(patch) {
  settings = await saveSettings(patch);
  render();
  flashSaved();
}

function render() {
  document.querySelectorAll('input[type=checkbox][data-key]').forEach((i) => { i.checked = !!settings[i.dataset.key]; });
  document.querySelectorAll('.seg[data-key]').forEach((seg) => {
    seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === settings[seg.dataset.key]));
  });
  const colors = $('#colors');
  colors.textContent = '';
  PRESETS.forEach((c) => {
    const b = document.createElement('button');
    b.style.background = c;
    b.title = c;
    b.setAttribute('aria-label', 'Use colour ' + c);
    if (c.toLowerCase() === String(settings.highlightColor).toLowerCase()) b.className = 'on';
    b.addEventListener('click', () => update({ highlightColor: c }));
    colors.appendChild(b);
  });
  const custom = document.createElement('input');
  custom.type = 'color';
  custom.value = /^#[0-9a-f]{6}$/i.test(settings.highlightColor) ? settings.highlightColor : '#2563EB';
  custom.title = 'Custom colour';
  custom.addEventListener('change', () => update({ highlightColor: custom.value.toUpperCase() }));
  colors.appendChild(custom);
}

async function refreshHistory() {
  const h = await getHistory();
  $('#histCount').textContent = h.length ? `${h.length} saved ${h.length === 1 ? 'item' : 'items'}` : 'No saved items';
}

async function init() {
  $('#logo').innerHTML = LOGO_SVG;
  $('#ver').textContent = 'v' + chrome.runtime.getManifest().version;
  settings = await getSettings();
  render();
  refreshHistory();
  document.querySelectorAll('input[type=checkbox][data-key]').forEach((i) => i.addEventListener('change', () => update({ [i.dataset.key]: i.checked })));
  document.querySelectorAll('.seg[data-key]').forEach((seg) => seg.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) update({ [seg.dataset.key]: b.dataset.v });
  }));
  $('#clearHistory').addEventListener('click', async () => { await clearHistory(); refreshHistory(); flashSaved('History cleared'); });
  $('#reset').addEventListener('click', async () => { settings = await resetSettings(); render(); flashSaved('Settings reset'); });
  $('#shortcutsLink').addEventListener('click', (e) => { e.preventDefault(); chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }); });
  chrome.storage.onChanged.addListener(() => refreshHistory());
}
init();
