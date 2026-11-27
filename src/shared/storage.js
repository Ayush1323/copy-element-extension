import { DEFAULT_SETTINGS, STORAGE_KEYS, HISTORY_LIMIT, HISTORY_ENTRY_MAX_CHARS, SHOT_DEFAULTS, SITE_SCAN_LIMIT } from './constants.js';
import { uid } from './helpers.js';

const area = () => chrome.storage.local;

export async function getSettings() {
  const res = await area().get(STORAGE_KEYS.SETTINGS);
  const stored = { ...(res[STORAGE_KEYS.SETTINGS] || {}) };
  if (/^#(2563eb|637545)$/i.test(stored.highlightColor || '')) delete stored.highlightColor; // the colours that used to be the default: now "follow the theme"
  return { ...DEFAULT_SETTINGS, ...stored };
}

export async function saveSettings(patch) {
  const next = { ...(await getSettings()), ...patch };
  await area().set({ [STORAGE_KEYS.SETTINGS]: next });
  return next;
}

export async function resetSettings() {
  await area().set({ [STORAGE_KEYS.SETTINGS]: { ...DEFAULT_SETTINGS } });
  return { ...DEFAULT_SETTINGS };
}

export async function getHistory() {
  const res = await area().get(STORAGE_KEYS.HISTORY);
  return Array.isArray(res[STORAGE_KEYS.HISTORY]) ? res[STORAGE_KEYS.HISTORY] : [];
}

/** entry: { text, html?, type, domain } — stored locally only. */
export async function addHistory(entry) {
  const item = {
    id: uid(),
    at: Date.now(),
    ...entry,
    text: String(entry.text || '').slice(0, HISTORY_ENTRY_MAX_CHARS),
    html: entry.html ? String(entry.html).slice(0, HISTORY_ENTRY_MAX_CHARS * 2) : '',
  };
  const list = (await getHistory()).filter((h) => !(h.text === item.text && h.domain === item.domain));
  list.unshift(item);
  await area().set({ [STORAGE_KEYS.HISTORY]: list.slice(0, HISTORY_LIMIT) });
  return item;
}

export async function removeHistory(id) {
  const list = (await getHistory()).filter((h) => h.id !== id);
  await area().set({ [STORAGE_KEYS.HISTORY]: list });
  return list;
}

export async function clearHistory() {
  await area().set({ [STORAGE_KEYS.HISTORY]: [] });
}

/** Metadata only (no content) — powers the "last copied" status even if history is off. */
export async function setLast(meta) {
  await area().set({ [STORAGE_KEYS.LAST]: { ...meta, at: Date.now() } });
}

export async function getLast() {
  const res = await area().get(STORAGE_KEYS.LAST);
  return res[STORAGE_KEYS.LAST] || null;
}

export function onStorageChange(cb) {
  // An orphaned content script (the extension was reloaded while the page stayed open) has no chrome.storage any more.
  if (!(typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged)) return () => {};
  const fn = (changes, areaName) => {
    if (areaName === 'local') cb(changes);
  };
  chrome.storage.onChanged.addListener(fn);
  return () => chrome.storage.onChanged.removeListener(fn);
}

export async function getShotPrefs() {
  try {
    const res = await area().get(STORAGE_KEYS.SHOT_PREFS);
    return { ...SHOT_DEFAULTS, ...(res[STORAGE_KEYS.SHOT_PREFS] || {}) };
  } catch (_) { return { ...SHOT_DEFAULTS }; }
}

export async function saveShotPrefs(prefs) {
  try { await area().set({ [STORAGE_KEYS.SHOT_PREFS]: { ...SHOT_DEFAULTS, ...prefs } }); } catch (_) { /* extension context invalidated */ }
}

export async function getSeoPos() {
  try { return (await area().get(STORAGE_KEYS.SEO_POS))[STORAGE_KEYS.SEO_POS] || null; } catch (_) { return null; }
}

export async function saveSeoPos(pos) {
  try { await area().set({ [STORAGE_KEYS.SEO_POS]: { x: Number(pos.x) || 0, y: Number(pos.y) || 0 } }); } catch (_) { /* extension context invalidated */ }
}

export async function getUtilsPos() {
  try { return (await area().get(STORAGE_KEYS.UTILS_POS))[STORAGE_KEYS.UTILS_POS] || null; } catch (_) { return null; }
}

export async function saveUtilsPos(pos) {
  try { await area().set({ [STORAGE_KEYS.UTILS_POS]: { x: Number(pos.x) || 0, y: Number(pos.y) || 0 } }); } catch (_) { /* extension context invalidated */ }
}

/* ---------- Site Analyzer ---------- */

export async function getSiteLimit() {
  return (await area().get(STORAGE_KEYS.SITE_LIMIT))[STORAGE_KEYS.SITE_LIMIT] || 0;
}

export async function saveSiteLimit(limit) {
  await area().set({ [STORAGE_KEYS.SITE_LIMIT]: Number(limit) || 0 });
}

/** Saved sites, most recently scanned first: [{ domain, score, at }]. */
export async function listSiteScans() {
  return (await area().get(STORAGE_KEYS.SITE_INDEX))[STORAGE_KEYS.SITE_INDEX] || [];
}

/** { report, history } of a site, or null. */
export async function getSiteScan(domain) {
  const key = STORAGE_KEYS.SITE_SCAN + domain;
  return (await area().get(key))[key] || null;
}

/** Keeps the newest few sites: older reports are removed so storage never fills up. */
export async function saveSiteScan(domain, scan) {
  const list = [{ domain, score: scan.report.score, at: scan.report.at }, ...(await listSiteScans()).filter((s) => s.domain !== domain)];
  const dropped = list.slice(SITE_SCAN_LIMIT).map((s) => STORAGE_KEYS.SITE_SCAN + s.domain);
  if (dropped.length) await area().remove(dropped);
  await area().set({ [STORAGE_KEYS.SITE_SCAN + domain]: scan, [STORAGE_KEYS.SITE_INDEX]: list.slice(0, SITE_SCAN_LIMIT) });
}
