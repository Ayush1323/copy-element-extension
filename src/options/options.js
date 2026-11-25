import { DEFAULT_SETTINGS } from '../shared/constants.js';
import { getSettings, saveSettings, resetSettings, getHistory, clearHistory } from '../shared/storage.js';
import { LOGO_SVG_LG as LOGO_SVG, icon } from '../shared/icons.js';
import { TOOLS, EXTRA } from '../shared/shortcuts.js';
import { THEMES, applyTheme, deriveColors, themeById, themeVars } from '../shared/themes.js';

const PRESETS = ['#E11D48', '#F59E0B', '#16A34A', '#0891B2', '#7C3AED', '#2563EB'];
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
  applyTheme(document.documentElement, settings.theme);
  renderThemes();
  const colors = $('#colors');
  colors.textContent = '';
  const auto = document.createElement('button');
  auto.className = 'auto' + (!settings.highlightColor ? ' on' : '');
  auto.title = 'Follow the theme';
  auto.setAttribute('aria-label', 'Highlight colour follows the theme');
  auto.innerHTML = '<span>Theme</span>';
  auto.addEventListener('click', () => update({ highlightColor: '' }));
  colors.appendChild(auto);
  PRESETS.forEach((c) => {
    const b = document.createElement('button');
    b.style.background = c;
    b.title = c;
    b.setAttribute('aria-label', 'Use colour ' + c);
    if (c.toLowerCase() === String(settings.highlightColor).toLowerCase()) b.className = 'on';
    b.addEventListener('click', () => update({ highlightColor: c }));
    colors.appendChild(b);
  });
  colors.appendChild(buildCustomColour());
}

const PALETTE = ['#EF4444', '#F97316', '#F59E0B', '#EAB308', '#84CC16', '#22C55E', '#10B981', '#14B8A6', '#06B6D4', '#0EA5E9', '#3B82F6', '#6366F1',
  '#8B5CF6', '#A855F7', '#D946EF', '#EC4899', '#F43F5E', '#B45309', '#047857', '#1D4ED8', '#7C3AED', '#78716C', '#64748B', '#0F172A'];
const normHex = (v) => { const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(v).trim()); if (!m) return ''; const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1]; return `#${h.toUpperCase()}`; };

/**
 * The "custom colour" control: a round swatch that opens a small popover INSIDE the page (a palette, a hex field, and the
 * browser's own picker as an extra). The browser's picker alone opens at the far edge of the window and can be cut off.
 */
function buildCustomColour() {
  const cur = settings.highlightColor;
  const isCustom = !!cur && !PRESETS.some((c) => c.toLowerCase() === cur.toLowerCase());
  const wrap = document.createElement('span');
  wrap.className = 'cc-wrap';
  const btn = document.createElement('button');
  btn.className = 'cc' + (isCustom ? ' on' : '');
  btn.title = 'Custom colour';
  btn.setAttribute('aria-label', 'Choose a custom highlight colour');
  btn.setAttribute('aria-haspopup', 'dialog');
  btn.setAttribute('aria-expanded', 'false');
  if (isCustom) btn.style.setProperty('--c', cur);
  wrap.appendChild(btn);

  let pop = null;
  const close = () => {
    if (!pop) return;
    pop.remove(); pop = null;
    btn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('mousedown', onOutside, true);
    document.removeEventListener('keydown', onKey, true);
  };
  const apply = (hex) => { close(); update({ highlightColor: hex }); };
  const onOutside = (e) => { if (pop && !pop.contains(e.target) && !btn.contains(e.target)) close(); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); btn.focus(); } };

  function open() {
    pop = document.createElement('div');
    pop.className = 'cpop';
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', 'Custom highlight colour');
    const start = isCustom ? cur.toUpperCase() : deriveColors(themeById(settings.theme)).primary;
    pop.innerHTML = `
      <div class="cp-top"><span class="cp-prev"></span><input class="cp-hex" type="text" maxlength="7" spellcheck="false" autocomplete="off" aria-label="Hex colour" placeholder="#RRGGBB"><button class="cp-ok" type="button">Use</button></div>
      <div class="cp-err" hidden>Enter a colour like #4F46E5</div>
      <div class="cp-grid">${PALETTE.map((c) => `<button type="button" class="cp-sw" style="background:${c}" data-c="${c}" title="${c}" aria-label="Use ${c}"></button>`).join('')}</div>
      <label class="cp-native"><input type="color" tabindex="-1">Open the browser's colour picker…</label>`;
    const hex = pop.querySelector('.cp-hex'), prev = pop.querySelector('.cp-prev'), err = pop.querySelector('.cp-err'), native = pop.querySelector('input[type=color]');
    hex.value = start; prev.style.background = start; native.value = start;
    hex.addEventListener('input', () => { const v = normHex(hex.value); err.hidden = true; if (v) { prev.style.background = v; native.value = v; } });
    const submit = () => { const v = normHex(hex.value); if (!v) { err.hidden = false; hex.focus(); return; } apply(v); };
    hex.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
    pop.querySelector('.cp-ok').addEventListener('click', submit);
    pop.querySelectorAll('.cp-sw').forEach((b) => b.addEventListener('click', () => apply(b.dataset.c)));
    native.addEventListener('input', () => { hex.value = native.value.toUpperCase(); prev.style.background = native.value; });
    native.addEventListener('change', () => apply(native.value.toUpperCase()));
    wrap.appendChild(pop);
    // always inside the window: open downwards, flip up when there is no room below
    const r = pop.getBoundingClientRect();
    if (r.bottom > window.innerHeight - 8 && btn.getBoundingClientRect().top > r.height + 16) pop.classList.add('up');
    btn.setAttribute('aria-expanded', 'true');
    document.addEventListener('mousedown', onOutside, true);
    document.addEventListener('keydown', onKey, true);
    hex.focus(); hex.select();
  }
  btn.addEventListener('click', () => (pop ? close() : open()));
  return wrap;
}

/** One card per theme. Each preview is drawn with that theme's own variables, so it is exactly what you will get. */
function renderThemes() {
  const cur = themeById(settings.theme).id;
  const box = $('#themes');
  box.textContent = '';
  for (const t of THEMES) {
    const c = deriveColors(t);
    const b = document.createElement('button');
    b.className = 'theme' + (t.id === cur ? ' on' : '');
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(t.id === cur));
    b.dataset.theme = t.id;
    for (const [k, v] of Object.entries(themeVars(t.id))) b.style.setProperty(k, v);
    b.innerHTML = `
      <span class="tp"><i class="tp-bar"><u></u><s></s><em></em></i><span class="tp-body"><i class="tp-tile"></i><i class="tp-tile"></i><i class="tp-tile"></i><i class="tp-line"></i></span></span>
      <span class="tn"><b></b><small></small></span>
      <span class="ts">${[c.primary, c.accent, c.mid, c['soft-b']].map((x) => `<i style="background:${x}"></i>`).join('')}</span>`;
    b.querySelector('b').textContent = t.name;
    b.querySelector('small').textContent = t.mood;
    b.addEventListener('click', () => update({ theme: t.id }));
    box.appendChild(b);
  }
}

/** Highlights the side-navigation entry of the section that is on screen. */
function setupNav() {
  const links = [...document.querySelectorAll('.nav a[data-nav]')];
  const mark = (id) => links.forEach((a) => { const on = a.dataset.nav === id; a.classList.toggle('on', on); if (on) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current'); });
  mark(links[0].dataset.nav);
  if (typeof IntersectionObserver === 'undefined') return;
  const seen = new Map();
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) seen.set(e.target.id, e.isIntersecting ? e.intersectionRatio : 0);
    const best = [...seen.entries()].sort((a, b) => b[1] - a[1])[0];
    if (best && best[1] > 0) mark(best[0]);
  }, { rootMargin: '-15% 0px -55% 0px', threshold: [0, 0.1, 0.3, 0.6, 1] });
  links.forEach((a) => { const sec = document.getElementById(a.dataset.nav); if (sec) io.observe(sec); });
  links.forEach((a) => a.addEventListener('click', () => mark(a.dataset.nav)));
}

async function refreshHistory() {
  const h = await getHistory();
  $('#histCount').textContent = h.length ? `${h.length} saved ${h.length === 1 ? 'item' : 'items'}` : 'No saved items';
}

function renderShortcuts() {
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const kb = (a) => `<kbd>${esc(a)}</kbd>`;
  $('#keysTools').innerHTML = TOOLS.map((t) => `<li><span>${esc(t.label)}</span>${t.keys.map(kb).join('')}${t.suggested ? '<em title="Works from anywhere without any setup">anywhere</em>' : ''}</li>`).join('');
  $('#keysExtra').innerHTML = EXTRA.map((x) => `<li><span>${esc(x.label)}</span>${x.keys.map(kb).join('')}${x.keys2 ? ' <i>/</i> ' + x.keys2.map(kb).join('') : ''}</li>`).join('');
}

async function init() {
  renderShortcuts();
  $('#logo').innerHTML = LOGO_SVG;
  document.querySelectorAll('[data-icon]').forEach((e) => { e.innerHTML = icon(e.dataset.icon, e.classList.contains('ci') ? 21 : 16); });
  setupNav();
  $('#ver').textContent = 'v' + chrome.runtime.getManifest().version;
  settings = await getSettings();
  applyTheme(document.documentElement, settings.theme);
  render();
  refreshHistory();
  document.querySelectorAll('input[type=checkbox][data-key]:not([data-perm])').forEach((i) => i.addEventListener('change', () => update({ [i.dataset.key]: i.checked })));
  const anySite = $('input[data-perm="all-sites"]');
  anySite.addEventListener('change', async () => {
    if (anySite.checked) {
      let granted = false;
      try { granted = await chrome.permissions.request({ origins: ['<all_urls>'] }); } catch (_) { /* noop */ }
      if (!granted) { await update({ linkPreviewAnySite: false }); flashSaved('Permission not granted'); return; }
      await update({ linkPreviewAnySite: true, linkPreview: true });
    } else {
      try { await chrome.permissions.remove({ origins: ['<all_urls>'] }); } catch (_) { /* noop */ }
      await update({ linkPreviewAnySite: false });
    }
  });
  // keep the switch honest if the permission was revoked from chrome://extensions
  try {
    const has = await chrome.permissions.contains({ origins: ['<all_urls>'] });
    if (settings.linkPreviewAnySite && !has) { settings = await saveSettings({ linkPreviewAnySite: false }); render(); }
  } catch (_) { /* noop */ }
  if (location.hash === '#anysite') {
    const row = $('#row-anysite');
    row.scrollIntoView({ block: 'center' });
    row.classList.add('flash');
  }
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
