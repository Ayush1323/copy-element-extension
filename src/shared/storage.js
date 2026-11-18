import { DEFAULT_SETTINGS, STORAGE_KEYS, HISTORY_LIMIT, HISTORY_ENTRY_MAX_CHARS } from './constants.js';
import { uid } from './helpers.js';

const area = () => chrome.storage.local;

export async function getSettings() {
  const res = await area().get(STORAGE_KEYS.SETTINGS);
  return { ...DEFAULT_SETTINGS, ...(res[STORAGE_KEYS.SETTINGS] || {}) };
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
  const fn = (changes, areaName) => {
    if (areaName === 'local') cb(changes);
  };
  chrome.storage.onChanged.addListener(fn);
  return () => chrome.storage.onChanged.removeListener(fn);
}
