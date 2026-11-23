// Screenshot "Link": one developer-configured upload API. Users never see or set an address.
//
// The address is fixed at BUILD time (scripts/build.mjs holds the production default; override with
//   LINKLENS_SHARE_API=https://your-worker.workers.dev npm run build ). See server/share-worker/README.md.
// The placeholder below is only what plain `node` (unit tests) sees; sharing then reports "not available".

export const SHARE_API_PLACEHOLDER = 'https://linklens-share.invalid';
/* global __SHARE_API__ */
export const SHARE_API = typeof __SHARE_API__ !== 'undefined' ? __SHARE_API__ : SHARE_API_PLACEHOLDER;

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // larger images are uploaded as JPEG
export const UPLOAD_TIMEOUT_MS = 60000;

/** Returns the clean base URL (no trailing slash, no query) or '' when the text is not a usable server address. */
export function normalizeEndpoint(raw) {
  let u;
  try { u = new URL(String(raw || '').trim()); } catch (_) { return ''; }
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]';
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) return '';
  if (u.username || u.password) return '';
  return (u.origin + u.pathname).replace(/\/+$/, '');
}

/** The usable upload API base, or '' while the placeholder (no backend deployed yet) is still in place. */
export function shareBase(api = SHARE_API) {
  const base = normalizeEndpoint(api);
  return base && !new URL(base).hostname.endsWith('.invalid') ? base : '';
}

/** The server must answer with a link on its own origin: it can never send the user somewhere else. */
export function sameOriginLink(link, base) {
  try { const u = new URL(link); return u.origin === new URL(base).origin && /^https?:$/.test(u.protocol) ? u.href : ''; } catch (_) { return ''; }
}

/** "30 days" / "1 day" / "less than a day" from an absolute expiry time (ms), or '' when the link never expires. */
export function expiryText(expiresAt, now = Date.now()) {
  if (!expiresAt) return '';
  const d = Math.round((Number(expiresAt) - now) / 86400000);
  return d >= 2 ? `${d} days` : d === 1 ? '1 day' : 'less than a day';
}
