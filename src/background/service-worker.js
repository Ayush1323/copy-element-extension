import { MSG } from '../shared/message-types.js';
import { MODES } from '../shared/constants.js';
import { isRestrictedUrl } from '../shared/helpers.js';
import { STORAGE_KEYS, DEFAULT_SETTINGS } from '../shared/constants.js';
import { themeById, DEFAULT_THEME } from '../shared/themes.js';
import { toolByCommand } from '../shared/shortcuts.js';

const CONTENT_FILE = 'content/index.js';

async function currentTheme() {
  try {
    const res = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
    return themeById((res[STORAGE_KEYS.SETTINGS] && res[STORAGE_KEYS.SETTINGS].theme) || DEFAULT_SETTINGS.theme);
  } catch (_) { return themeById(DEFAULT_THEME); }
}

async function setBadge(tabId, mode) {
  try {
    await chrome.action.setBadgeText({ tabId, text: mode ? 'ON' : '' });
    if (mode) await chrome.action.setBadgeBackgroundColor({ tabId, color: (await currentTheme()).primary });
  } catch (_) { /* tab gone */ }
}

/** The toolbar icon is one PNG set per theme (see scripts/make-icons.mjs). */
async function syncThemeIcon() {
  try {
    const t = await currentTheme();
    const path = Object.fromEntries([16, 32, 48, 128].map((s) => [s, `icons/themes/${t.id}/icon${s}.png`]));
    await chrome.action.setIcon({ path });
  } catch (_) { /* icons unavailable: the manifest's icons stay */ }
}

/** Latest activation per tab, so a slow follow-up for the sub-frames never overrides a newer toggle. */
const frameSync = new Map();

/**
 * Everything below the top frame (iframes, ads, embeds) is handled AFTER the top frame is already working:
 * a page with dozens of frames must never delay the picker for the part the user is looking at.
 */
async function syncFrames(tabId, mode) {
  const n = (frameSync.get(tabId) || 0) + 1;
  frameSync.set(tabId, n);
  try {
    if (mode) await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: [CONTENT_FILE] }); // idempotent
    if (frameSync.get(tabId) !== n) return;
    await chrome.tabs.sendMessage(tabId, { type: MSG.SET_MODE, mode, toggle: false, broadcast: false });
  } catch (_) { /* frames that cannot be scripted are simply left out */ }
}

/** Activate (or toggle off) a mode on a tab. Returns { ok, error? } as soon as the top frame is running. */
export async function activate(tabId, mode, { toggle = true } = {}) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (isRestrictedUrl(tab.url || tab.pendingUrl)) {
      return { ok: false, error: 'Chrome does not allow extensions to run on this page.' };
    }
    const msg = { type: MSG.SET_MODE, mode, toggle, broadcast: false };
    let res;
    try {
      res = await chrome.tabs.sendMessage(tabId, msg, { frameId: 0 }); // already injected: one round trip
    } catch (_) {
      await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, files: [CONTENT_FILE] });
      res = await chrome.tabs.sendMessage(tabId, msg, { frameId: 0 });
    }
    if (res && res.ok === false) throw new Error(res.error || 'Could not start on this page.');
    const active = res && 'mode' in res ? res.mode : mode;
    await setBadge(tabId, active);
    syncFrames(tabId, active); // deliberately not awaited
    return { ok: true, mode: active };
  } catch (e) {
    return { ok: false, error: friendly(e) };
  }
}

function friendly(e) {
  const m = (e && e.message) || String(e);
  if (/cannot access|extensions gallery|chrome:\/\/|Cannot access contents|showing error page/i.test(m)) {
    return 'Chrome does not allow extensions to run on this page.';
  }
  if (/activeTab|permission|host/i.test(m)) return 'Open the extension from the toolbar (or use its shortcut) on this tab to grant access.';
  return m;
}

/* ---------- link preview of sites that forbid embedding ----------
 * Opt-in: needs the optional all-sites permission (asked in Settings) and the "linkPreviewAnySite" setting.
 * The rule only ever matches sub-frame requests *initiated by this extension's own preview page*, so normal
 * browsing keeps every site's X-Frame-Options / CSP protections. */

const PREVIEW_RULE_ID = 4101;
const PREVIEW_RULE = {
  id: PREVIEW_RULE_ID,
  priority: 1,
  action: {
    type: 'modifyHeaders',
    responseHeaders: [
      { header: 'x-frame-options', operation: 'remove' },
      { header: 'content-security-policy', operation: 'remove' },
      { header: 'content-security-policy-report-only', operation: 'remove' },
    ],
  },
  condition: { initiatorDomains: [chrome.runtime.id], resourceTypes: ['sub_frame'], regexFilter: '^https?://' },
};

export async function syncPreviewRule({ force = false } = {}) {
  try {
    const res = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
    const enabled = !!(res[STORAGE_KEYS.SETTINGS] && res[STORAGE_KEYS.SETTINGS].linkPreviewAnySite);
    let allowed = false;
    try { allowed = await chrome.permissions.contains({ origins: ['<all_urls>'] }); } catch (_) { /* noop */ }
    const want = enabled && allowed;
    // every service-worker start runs this: skip the rule rewrite when nothing changed
    if (!force) {
      const have = (await chrome.declarativeNetRequest.getDynamicRules()).some((r) => r.id === PREVIEW_RULE_ID);
      if (have === want) return;
    }
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [PREVIEW_RULE_ID], addRules: want ? [PREVIEW_RULE] : [] });
  } catch (_) { /* DNR unavailable: previews fall back to plain frames */ }
}

/** HTTP status of a link on any site, for the SEO panel's optional link check. Only with the all-sites permission; nothing is stored. */
async function checkUrl(url) {
  let u;
  try { u = new URL(url); } catch (_) { return { ok: false, error: 'Invalid URL' }; }
  if (!/^https?:$/.test(u.protocol)) return { ok: false, error: 'Not an http(s) link' };
  let allowed = false;
  try { allowed = await chrome.permissions.contains({ origins: ['<all_urls>'] }); } catch (_) { /* noop */ }
  if (!allowed) return { ok: false, error: 'no_permission' };
  for (const method of ['HEAD', 'GET']) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 10000);
    try {
      const res = await fetch(u.href, { method, credentials: 'omit', cache: 'no-store', redirect: 'follow', signal: ctl.signal });
      if ((res.status === 405 || res.status === 501) && method === 'HEAD') continue;
      return { ok: true, status: res.status, redirected: res.redirected };
    } catch (_) { if (method === 'GET') return { ok: false, error: 'Could not be reached' }; } finally { clearTimeout(timer); }
  }
  return { ok: false, error: 'Could not be reached' };
}

async function previewToken() {
  const got = await chrome.storage.session.get('miPreviewToken');
  if (got.miPreviewToken) return got.miPreviewToken;
  const t = crypto.randomUUID();
  await chrome.storage.session.set({ miPreviewToken: t });
  return t;
}

syncPreviewRule();
syncThemeIcon();
chrome.runtime.onInstalled.addListener(() => { syncPreviewRule({ force: true }); syncThemeIcon(); });
chrome.runtime.onStartup.addListener(() => { syncPreviewRule(); syncThemeIcon(); });
chrome.permissions.onAdded.addListener(() => syncPreviewRule());
chrome.permissions.onRemoved.addListener(() => syncPreviewRule());
chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes[STORAGE_KEYS.SETTINGS]) { syncPreviewRule(); syncThemeIcon(); } });

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return false;
  if (msg.type === MSG.ACTIVATE) {
    activate(msg.tabId, msg.mode, { toggle: msg.toggle !== false }).then(sendResponse);
    return true;
  }
  if (msg.type === MSG.PREVIEW_TOKEN && sender.tab) {
    previewToken().then((token) => sendResponse({ token }), () => sendResponse({ token: '' }));
    return true;
  }
  if (msg.type === MSG.PREVIEW_CHECK && sender.url && sender.url.startsWith(chrome.runtime.getURL('preview/preview.html'))) {
    previewToken().then((token) => sendResponse({ ok: !!msg.token && msg.token === token }), () => sendResponse({ ok: false }));
    return true;
  }
  if (msg.type === MSG.CAPTURE && sender.tab) {
    // lossless capture of the sender's tab (needs activeTab: granted by the toolbar click / shortcut that started the session)
    chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: 'png' }).then(
      (dataUrl) => sendResponse({ ok: true, dataUrl }),
      (e) => sendResponse({ ok: false, error: String((e && e.message) || e) }),
    );
    return true;
  }
  if (msg.type === MSG.CHECK_URL && sender.tab) {
    checkUrl(msg.url).then(sendResponse, () => sendResponse({ ok: false, error: 'Could not be reached' }));
    return true;
  }
  if (msg.type === MSG.OPEN_OPTIONS) {
    chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html#anysite') });
    return false;
  }
  if (msg.type === MSG.MODE_CHANGED && sender.tab) {
    const tabId = sender.tab.id;
    setBadge(tabId, msg.mode);
    // keep every frame of the tab in sync (e.g. Esc pressed inside an iframe)
    chrome.tabs.sendMessage(tabId, { type: MSG.SET_MODE, mode: msg.mode, broadcast: false }).catch(() => {});
    return false;
  }
  return false;
});

chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab || tab.id == null) return;
  const tool = toolByCommand(command); // every tool has a command (see src/shared/shortcuts.js)
  if (tool) await activate(tab.id, tool.mode);
  else if (command === 'copy-hovered') {
    try { await chrome.tabs.sendMessage(tab.id, { type: MSG.COPY_HOVERED }); } catch (_) { /* picker not active */ }
  }
});

// A navigation tears the picker down with the page: clear the badge.
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === 'loading') setBadge(tabId, null);
});
