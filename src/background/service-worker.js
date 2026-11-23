import { MSG } from '../shared/message-types.js';
import { MODES } from '../shared/constants.js';
import { isRestrictedUrl } from '../shared/helpers.js';
import { STORAGE_KEYS } from '../shared/constants.js';
import { shareBase, sameOriginLink, MAX_UPLOAD_BYTES, UPLOAD_TIMEOUT_MS } from '../shared/share.js';

const CONTENT_FILE = 'content/index.js';

async function setBadge(tabId, mode) {
  try {
    await chrome.action.setBadgeText({ tabId, text: mode ? 'ON' : '' });
    if (mode) await chrome.action.setBadgeBackgroundColor({ tabId, color: '#2563EB' });
  } catch (_) { /* tab gone */ }
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

/**
 * Uploads the screenshot to the one built-in share API. Only called after the user pressed Link.
 * Nothing is logged or stored about the image; the API address is a build-time constant, there is no secret here.
 */
async function uploadShot(msg) {
  const base = shareBase();
  if (!base) return { ok: false, code: 'not_configured', error: 'Link sharing is not available in this build yet.' };
  if (typeof msg.dataUrl !== 'string' || !/^data:image\/(png|jpeg);base64,/.test(msg.dataUrl)) return { ok: false, error: 'Invalid image.' };
  const blob = await (await fetch(msg.dataUrl)).blob();
  if (blob.size > MAX_UPLOAD_BYTES * 1.5) return { ok: false, error: 'The image is too large to upload.' };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), UPLOAD_TIMEOUT_MS);
  let res;
  try { res = await fetch(base + '/upload', { method: 'POST', headers: { 'Content-Type': blob.type }, body: blob, credentials: 'omit', cache: 'no-store', signal: ctl.signal }); }
  catch (e) { return { ok: false, error: e && e.name === 'AbortError' ? 'The upload took too long. Check your connection and try again.' : 'Could not reach the sharing service. Check your connection and try again.' }; }
  finally { clearTimeout(timer); }
  if (res.status === 429) return { ok: false, error: 'Too many uploads in a short time. Wait a minute and try again.' };
  if (res.status === 413) return { ok: false, error: 'The sharing service says the image is too large.' };
  if (!res.ok) return { ok: false, error: `The sharing service had a problem (${res.status}). Try again in a moment.` };
  let data = null;
  try { data = await res.json(); } catch (_) { /* handled below */ }
  const url = data && sameOriginLink(data.url, base);
  if (!url) return { ok: false, error: 'The sharing service sent an unexpected answer.' };
  return { ok: true, url, expiresAt: data.expiresAt || null };
}

async function previewToken() {
  const got = await chrome.storage.session.get('miPreviewToken');
  if (got.miPreviewToken) return got.miPreviewToken;
  const t = crypto.randomUUID();
  await chrome.storage.session.set({ miPreviewToken: t });
  return t;
}

syncPreviewRule();
chrome.runtime.onInstalled.addListener(() => syncPreviewRule({ force: true }));
chrome.runtime.onStartup.addListener(() => syncPreviewRule());
chrome.permissions.onAdded.addListener(() => syncPreviewRule());
chrome.permissions.onRemoved.addListener(() => syncPreviewRule());
chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes[STORAGE_KEYS.SETTINGS]) syncPreviewRule(); });

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
  if (msg.type === MSG.UPLOAD_SHOT && sender.tab) {
    uploadShot(msg).then(sendResponse, (e) => sendResponse({ ok: false, error: String((e && e.message) || e) }));
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
  if (command === 'activate-element-picker') await activate(tab.id, MODES.ELEMENT);
  else if (command === 'activate-section-picker') await activate(tab.id, MODES.SECTION);
  else if (command === 'capture-screenshot') await activate(tab.id, MODES.SCREENSHOT);
  else if (command === 'copy-hovered') {
    try { await chrome.tabs.sendMessage(tab.id, { type: MSG.COPY_HOVERED }); } catch (_) { /* picker not active */ }
  }
});

// A navigation tears the picker down with the page: clear the badge.
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === 'loading') setBadge(tabId, null);
});
