import { MSG } from '../shared/message-types.js';
import { MODES } from '../shared/constants.js';
import { isRestrictedUrl } from '../shared/helpers.js';

const CONTENT_FILE = 'content/index.js';

async function isInjected(tabId) {
  try {
    const res = await chrome.tabs.sendMessage(tabId, { type: MSG.PING });
    return !!(res && res.ok);
  } catch (_) {
    return false;
  }
}

/** Inject the content script into every accessible frame of the tab (idempotent). */
export async function ensureInjected(tabId) {
  if (await isInjected(tabId)) return;
  await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: [CONTENT_FILE] });
}

async function setBadge(tabId, mode) {
  try {
    await chrome.action.setBadgeText({ tabId, text: mode ? 'ON' : '' });
    if (mode) await chrome.action.setBadgeBackgroundColor({ tabId, color: '#2563EB' });
  } catch (_) { /* tab gone */ }
}

/** Activate (or toggle off) a mode on a tab. Returns { ok, error? }. */
export async function activate(tabId, mode, { toggle = true } = {}) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (isRestrictedUrl(tab.url || tab.pendingUrl)) {
      return { ok: false, error: 'Chrome does not allow extensions to run on this page.' };
    }
    await ensureInjected(tabId);
    await chrome.tabs.sendMessage(tabId, { type: MSG.SET_MODE, mode, toggle, broadcast: false });
    let state = null;
    try { state = await chrome.tabs.sendMessage(tabId, { type: MSG.GET_STATE }); } catch (_) { /* noop */ }
    await setBadge(tabId, state ? state.mode : mode);
    return { ok: true, mode: state ? state.mode : mode };
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

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return false;
  if (msg.type === MSG.ACTIVATE) {
    activate(msg.tabId, msg.mode, { toggle: msg.toggle !== false }).then(sendResponse);
    return true;
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
  else if (command === 'copy-hovered') {
    try { await chrome.tabs.sendMessage(tab.id, { type: MSG.COPY_HOVERED }); } catch (_) { /* picker not active */ }
  }
});

// A navigation tears the picker down with the page: clear the badge.
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === 'loading') setBadge(tabId, null);
});
