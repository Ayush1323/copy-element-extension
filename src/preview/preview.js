// Extension-owned page that hosts the link-preview frame (see service-worker.js for the header rule).
//
// Why a wrapper page: only requests *initiated by this extension page* get the frame-blocking headers relaxed
// (declarativeNetRequest `initiatorDomains: [extension id]`). A frame created directly in the website would not
// qualify and we would never want to weaken headers for the page's own traffic.
//
// A random per-browser-session token (known only to our content scripts and this page, via the service worker)
// is required, so other websites cannot use this page to load arbitrary URLs.
import { MSG } from '../shared/message-types.js';

(async function run() {
  try {
    const q = new URLSearchParams(location.search);
    const target = new URL(q.get('u') || '');
    if (!/^https?:$/.test(target.protocol)) return;
    const res = await chrome.runtime.sendMessage({ type: MSG.PREVIEW_CHECK, token: q.get('t') || '' });
    if (!res || !res.ok) return;
    const f = document.createElement('iframe');
    f.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms'); // no popups, no top navigation
    f.referrerPolicy = 'no-referrer';
    f.src = target.href;
    document.body.appendChild(f);
  } catch (_) { /* invalid input: render nothing */ }
})();
