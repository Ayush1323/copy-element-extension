import { logger } from '../../utils/logger.js';

function legacyCopy(text, html) {
  const doc = document;
  const prevActive = doc.activeElement;
  const sel = doc.getSelection();
  const saved = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
  const ta = doc.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0;pointer-events:none;';
  const handler = (e) => {
    e.clipboardData.setData('text/plain', text);
    if (html) e.clipboardData.setData('text/html', html);
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  let ok = false;
  try {
    (doc.body || doc.documentElement).appendChild(ta);
    ta.select();
    window.addEventListener('copy', handler, true);
    ok = doc.execCommand('copy');
  } catch (e) {
    logger.warn('execCommand copy failed', e);
  } finally {
    window.removeEventListener('copy', handler, true);
    ta.remove();
    if (saved && sel) { sel.removeAllRanges(); sel.addRange(saved); }
    if (prevActive && prevActive.focus) try { prevActive.focus({ preventScroll: true }); } catch (_) { /* noop */ }
  }
  return ok;
}

/**
 * Write plain text (+ optional HTML) to the clipboard.
 * 1. async Clipboard API with a ClipboardItem carrying both representations
 * 2. navigator.clipboard.writeText
 * 3. legacy execCommand('copy') (works without a user gesture thanks to the clipboardWrite permission)
 * @returns {Promise<{ok: boolean, method: string, error?: string}>}
 */
export async function writeClipboard({ text, html }) {
  const plain = String(text == null ? '' : text);
  try {
    if (html && typeof ClipboardItem !== 'undefined' && navigator.clipboard && navigator.clipboard.write) {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/plain': new Blob([plain], { type: 'text/plain' }),
          'text/html': new Blob([html], { type: 'text/html' }),
        }),
      ]);
      return { ok: true, method: 'clipboard-item' };
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(plain);
      return { ok: true, method: 'write-text' };
    }
  } catch (e) {
    logger.debug('async clipboard unavailable, falling back', e && e.name);
  }
  if (legacyCopy(plain, html)) return { ok: true, method: 'exec-command' };
  return { ok: false, method: 'none', error: 'The browser blocked clipboard access. Click the page once and try again.' };
}
