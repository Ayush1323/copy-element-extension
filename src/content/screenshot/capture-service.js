import { MSG } from '../../shared/message-types.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const frames = (n = 2) => new Promise((r) => { const step = () => (--n <= 0 ? r() : requestAnimationFrame(step)); requestAnimationFrame(step); });

// Chrome allows ~2 captureVisibleTab calls per second.
const CAPTURE_GAP_MS = 560;
// Stay inside Chrome's canvas limits (32 767 px per side, ~268 M pixels in total).
const MAX_SIDE = 32000;
const MAX_AREA = 200e6;

async function requestCapture() {
  let lastError = 'Capture failed';
  for (let attempt = 0; attempt < 4; attempt++) {
    let res;
    try { res = await chrome.runtime.sendMessage({ type: MSG.CAPTURE }); } catch (e) { throw new Error('The extension was reloaded. Refresh this page and try again.'); }
    if (res && res.ok && res.dataUrl) return res.dataUrl;
    lastError = (res && res.error) || lastError;
    if (/MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND|quota/i.test(lastError)) { await sleep(CAPTURE_GAP_MS * 1.5); continue; }
    break;
  }
  throw new Error(friendlyCaptureError(lastError));
}

export function friendlyCaptureError(msg) {
  if (/activeTab|permission|cannot access|not been invoked/i.test(msg)) return 'Chrome did not allow capturing this page. Click the LinkLens icon (or use the shortcut) on this tab and try again.';
  if (/extensions gallery|chrome:\/\/|devtools|cannot be scripted/i.test(msg)) return 'Chrome does not allow screenshots of this page.';
  return msg || 'Could not capture the page.';
}

async function toBitmap(dataUrl) {
  const blob = await (await fetch(dataUrl)).blob();
  // 'none': keep the captured pixel values exactly as Chrome produced them (no colour-space conversion on wide-gamut screens)
  try { return await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' }); } catch (_) { return createImageBitmap(blob); }
}

/**
 * Capture the visible area of the tab. `hide`/`show` hide our own UI around the capture.
 * @returns {{bitmap: ImageBitmap, scaleX: number, scaleY: number, cssW: number, cssH: number}}
 */
export async function captureVisible({ hide, show }) {
  hide();
  try {
    await frames(3);
    await sleep(40);
    const dataUrl = await requestCapture();
    const bitmap = await toBitmap(dataUrl);
    const cssW = window.innerWidth, cssH = window.innerHeight;
    return { bitmap, scaleX: bitmap.width / cssW, scaleY: bitmap.height / cssH, cssW, cssH };
  } finally { show(); }
}

/** Page positions that follow the page's own scrolling element, or null if the page does not scroll as a document. */
function scroller() {
  const el = document.scrollingElement || document.documentElement;
  const total = Math.max(el.scrollHeight, document.body ? document.body.scrollHeight : 0);
  return { el, total, view: window.innerHeight };
}

export function canStitch() {
  const s = scroller();
  return s.total > s.view + 2;
}

/** Put every inline style attribute back exactly as it was (including "no style attribute at all"). */
export function restoreStyles(list) {
  for (const [el, attr] of list) {
    if (attr === null) el.removeAttribute('style');
    else el.setAttribute('style', attr);
  }
}

function fixedElements() {
  const out = [];
  for (const el of document.querySelectorAll('body *')) {
    if (el.localName === 'linklens-root') continue;
    let pos;
    try { pos = getComputedStyle(el).position; } catch (_) { continue; }
    if (pos === 'fixed' || pos === 'sticky') out.push(el);
  }
  return out;
}

/**
 * Scroll the page top to bottom, capture each viewport and stitch them.
 * Fixed / sticky elements (headers, chat bubbles…) are hidden after the first screen so they do not repeat,
 * and everything is restored afterwards. Returns null if cancelled.
 * @returns {{canvas: HTMLCanvasElement, cssW: number, cssH: number, scale: number, notes: string[]}|null}
 */
export async function captureFullPage({ hide, show, onProgress, isCancelled }) {
  const s = scroller();
  const startY = window.scrollY, startX = window.scrollX;
  const cssW = window.innerWidth, vh = s.view;
  const total = Math.max(vh, Math.min(s.total, 60000));
  const notes = [];
  if (s.total > total) notes.push('The page is extremely long: only the first 60,000 px were captured.');
  const stops = [];
  for (let y = 0; y < total; y += vh) stops.push(Math.min(y, total - vh));
  const uniq = [...new Set(stops)];

  hide();
  const hidden = []; // [element, original style attribute] - the only elements whose inline style we ever touch
  // (window.scrollTo with behavior 'instant' ignores the page's CSS scroll-behavior, so <html> is never modified)
  let canvas = null, ctx = null, scale = 1, outScale = 1;
  try {
    for (let i = 0; i < uniq.length; i++) {
      if (isCancelled()) return null;
      onProgress(i + 1, uniq.length);
      window.scrollTo({ left: 0, top: uniq[i], behavior: 'instant' });
      await frames(2);
      await sleep(i === 0 ? 80 : CAPTURE_GAP_MS); // lazy content + capture rate limit
      if (i === 1) for (const el of fixedElements()) { hidden.push([el, el.getAttribute('style')]); el.style.setProperty('visibility', 'hidden', 'important'); }
      const y = window.scrollY; // may differ from the request near the bottom
      const dataUrl = await requestCapture();
      const bmp = await toBitmap(dataUrl);
      if (!canvas) {
        scale = bmp.width / cssW;
        outScale = scale;
        const fullH = total;
        if (fullH * scale > MAX_SIDE || cssW * scale * fullH * scale > MAX_AREA) {
          outScale = Math.min(MAX_SIDE / fullH, Math.sqrt(MAX_AREA / (cssW * fullH)), scale);
          notes.push(`The page is very tall, so it was saved at reduced resolution (${Math.round((outScale / scale) * 100)}%).`);
        }
        canvas = document.createElement('canvas');
        canvas.width = Math.round(cssW * outScale);
        canvas.height = Math.round(fullH * outScale);
        ctx = canvas.getContext('2d', { alpha: false });
        ctx.imageSmoothingQuality = 'high';
      }
      // whole device pixels only: a fractional offset would resample (blur) the strip
      const dy = Math.round(y * outScale);
      if (outScale === scale) ctx.drawImage(bmp, 0, dy); // 1:1, no scaling at all
      else ctx.drawImage(bmp, 0, 0, bmp.width, bmp.height, 0, dy, canvas.width, Math.round((bmp.height / scale) * outScale));
      bmp.close();
    }
  } finally {
    restoreStyles(hidden);
    window.scrollTo({ left: startX, top: startY, behavior: 'instant' });
    await frames(2);
    show();
  }
  if (!canvas) return null;
  return { canvas, cssW, cssH: total, scale: outScale, notes };
}
