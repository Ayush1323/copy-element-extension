import { h } from '../ui/shadow-root-ui.js';
import { icon } from '../../shared/icons.js';
import { getShotPrefs, saveShotPrefs } from '../../shared/storage.js';
import { MSG } from '../../shared/message-types.js';
import { expiryText, MAX_UPLOAD_BYTES } from '../../shared/share.js';
import { captureVisible, captureFullPage, canStitch } from './capture-service.js';
import { createSelection } from './selection-overlay.js';
import { createEditor } from './editor.js';
import { createToolbars } from './toolbars.js';
import { canvasToBlob, blobToDataUrl, copyText, copyImage, downloadBlob, saveBlob, defaultFilename, sanitizeFilename } from './export-service.js';

/**
 * One screenshot session, entirely on the current page: capture → select → edit → copy / download / save.
 * No tab, window or extension page is ever opened. Everything it adds lives in the extension's shadow DOM host and is
 * removed again by destroy().
 *
 * @param {{ui: object, toast: Function, onExit: Function}} o
 */
export function createShotSession({ ui, toast, onExit }) {
  let phase = 'idle'; // idle | capturing | selecting | stitching | editing
  let destroyed = false;
  let cancelStitch = false;
  let frame = null;
  let sel = null;
  let editor = null;
  let bars = null;
  let host = null; // element that holds the stage (in-place box or workspace)
  let workspace = false;
  let area = null; // in-place selection rect
  let popover = null;
  let prefs = null;
  let saveTimer = 0;
  let busy = false;

  const hideUi = () => ui.host.style.setProperty('visibility', 'hidden', 'important');
  const showUi = () => ui.host.style.removeProperty('visibility');
  const fail = (msg) => toast(msg, 'error');

  /* ------------------------------- lifecycle -------------------------------- */

  async function start() {
    phase = 'capturing';
    try {
      const prefsReady = getShotPrefs(); // read while the page is being captured
      frame = await captureVisible({ hide: hideUi, show: showUi });
      prefs = await prefsReady;
    } catch (e) {
      showUi();
      if (!destroyed) { fail((e && e.message) || 'Could not capture this page.'); onExit(); }
      return;
    }
    if (destroyed) { frame.bitmap.close(); return; }
    showSelection();
  }

  function showSelection() {
    phase = 'selecting';
    sel = createSelection(ui, {
      frame,
      canFullPage: canStitch(),
      onConfirm: (r) => openInPlace(r),
      onVisible: () => openInPlace({ x: 0, y: 0, w: frame.cssW, h: frame.cssH }),
      onFullPage: fullPage,
      onCancel: () => onExit(),
    });
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    cancelStitch = true;
    clearTimeout(saveTimer);
    closePopover();
    window.removeEventListener('resize', onResize);
    if (editor) editor.destroy();
    if (bars) bars.destroy();
    if (sel) sel.destroy();
    if (host) host.remove();
    if (frame) { try { frame.bitmap.close(); } catch (_) { /* already closed */ } }
    showUi();
    editor = bars = sel = host = frame = null;
  }

  /* ---------------------------------- editor -------------------------------- */

  function persist(state) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveShotPrefs({ tool: state.tool, ...state.props }), 400);
  }

  function mountEditor(base, cssW, cssH) {
    editor = createEditor({
      base, cssW, cssH, prefs,
      onChange: (st) => { if (bars) bars.update({ ...st, sel: st.selProps }); persist(st); },
    });
    bars = createToolbars(ui, {
      workspace,
      editor,
      actions: { copy: doCopy, download: doDownload, share: doShare, save: openSavePopover, close: () => onExit(), zoom: zoomBy },
    });
    host.appendChild(editor.el);
    bars.update({ ...editor.state(), sel: editor.state().selProps });
    editor.setTool(prefs.tool);
    relayout();
    window.addEventListener('resize', onResize);
    phase = 'editing';
    requestAnimationFrame(() => { if (!destroyed && editor) editor.el.querySelector('.ss-over').focus({ preventScroll: true }); });
  }

  function openInPlace(r) {
    const base = document.createElement('canvas');
    const x = Math.round(r.x * frame.scaleX), y = Math.round(r.y * frame.scaleY);
    base.width = Math.max(1, Math.round(r.w * frame.scaleX));
    base.height = Math.max(1, Math.round(r.h * frame.scaleY));
    base.getContext('2d').drawImage(frame.bitmap, x, y, base.width, base.height, 0, 0, base.width, base.height);
    sel.lock(r); // keep the dimmed capture behind; the page itself is untouched underneath
    area = r;
    workspace = false;
    host = h('div', 'ss-inplace');
    const dpr = window.devicePixelRatio || 1;
    const snap = (v) => Math.round(v * dpr) / dpr; // sit exactly on a device pixel: no resampling blur at 125% / 150% scaling
    host.style.transform = `translate(${snap(r.x)}px, ${snap(r.y)}px)`;
    host.style.width = `${r.w}px`; host.style.height = `${r.h}px`;
    ui.layer.appendChild(host);
    frame.bitmap.close(); // the cropped canvas is all we need from here on
    mountEditor(base, r.w, r.h);
  }

  async function fullPage() {
    if (phase !== 'selecting') return;
    phase = 'stitching';
    cancelStitch = false;
    const progress = h('div', 'ss-progress', `<span class="ss-spin"></span><span class="ss-ptext">Capturing full page…</span><button class="ss-chip danger" data-act="stop">Cancel</button>`);
    ui.layer.appendChild(progress);
    progress.querySelector('[data-act="stop"]').addEventListener('click', () => { cancelStitch = true; });
    let res = null;
    try {
      res = await captureFullPage({
        hide: hideUi, show: showUi,
        onProgress: (i, n) => { const t = progress.querySelector('.ss-ptext'); if (t) t.textContent = `Capturing full page… ${i}/${n}`; },
        isCancelled: () => cancelStitch || destroyed,
      });
    } catch (e) {
      progress.remove();
      if (!destroyed) { fail((e && e.message) || 'Full-page capture failed.'); phase = 'selecting'; }
      return;
    }
    progress.remove();
    if (destroyed) return;
    if (!res) { phase = 'selecting'; toast('Full-page capture cancelled', 'error'); return; }
    sel.destroy(); sel = null;
    frame.bitmap.close();
    workspace = true;
    host = h('div', 'ss-work');
    const scroll = h('div', 'ss-scroll');
    host.appendChild(scroll);
    host.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });
    ui.layer.appendChild(host);
    mountEditor(res.canvas, res.cssW, res.cssH);
    scroll.appendChild(editor.el);
    fitZoom();
    relayout();
    toast(`Captured ${res.canvas.width} × ${res.canvas.height} px. The preview is scaled to fit; the saved image is full size.`, 'success');
    res.notes.forEach((n) => toast(n, 'success'));
  }

  /* ---------------------------------- zoom ---------------------------------- */

  function fitZoom() {
    const avail = (document.documentElement.clientWidth || window.innerWidth) - 120;
    setZoom(Math.min(1, Math.max(0.1, avail / editor.cssW)));
  }
  function setZoom(z) { editor.setZoom(z); bars.setZoomLabel(editor.state().zoom); }
  function zoomBy(kind) {
    if (!editor) return;
    if (kind === 'fit') return fitZoom();
    const z = editor.state().zoom;
    setZoom(kind === 'in' ? z * 1.25 : z / 1.25);
  }

  function relayout() { if (bars) bars.layout(workspace ? null : area); }
  function onResize() { relayout(); if (workspace && editor) fitZoom(); }

  /* ---------------------------------- export -------------------------------- */

  async function withBusy(action, fn) {
    if (busy || !editor) return;
    busy = true; bars.setBusy(action, true);
    try { await fn(); } catch (e) { fail((e && e.message) || 'Something went wrong.'); } finally { busy = false; if (bars) bars.setBusy(action, false); }
  }

  const doCopy = () => withBusy('copy', async () => {
    const canvas = editor.exportCanvas();
    await copyImage(await canvasToBlob(canvas));
    bars.flash('copy');
    toast(`Screenshot copied · ${canvas.width} × ${canvas.height} px`, 'success');
  });

  const doDownload = () => withBusy('download', async () => {
    const name = defaultFilename('png');
    const canvas = editor.exportCanvas();
    downloadBlob(await canvasToBlob(canvas), name);
    bars.flash('download');
    toast(`Downloaded ${name} · ${canvas.width} × ${canvas.height} px`, 'success');
  });

  function closePopover() { if (popover) { popover.remove(); popover = null; } }

  /** Puts the open popover under the actions bar (or above it when there is no room), inside the screen. */
  function placePopover(pw, fallbackH) {
    ui.layer.appendChild(popover);
    const r = bars.acts.getBoundingClientRect();
    const ph = popover.offsetHeight || fallbackH;
    const vh = window.innerHeight, vw = document.documentElement.clientWidth || window.innerWidth;
    const below = r.bottom + 8 + ph <= vh - 6;
    popover.style.transform = `translate(${Math.round(Math.min(Math.max(r.right - pw, 6), vw - pw - 6))}px, ${Math.round(below ? r.bottom + 8 : Math.max(6, r.top - ph - 8))}px)`;
  }

  /* ----------------------------- shareable link ----------------------------- */
  // Ready → Uploading → Link ready | Failed. Upload happens only when the user presses Link; the screenshot is never lost on failure.

  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  const doShare = () => withBusy('share', async () => {
    closePopover();
    bars.setUploading(true);
    try {
      const canvas = editor.exportCanvas();
      let blob = await canvasToBlob(canvas);
      let note = '';
      if (blob.size > MAX_UPLOAD_BYTES) { blob = await canvasToBlob(canvas, 'image/jpeg', 0.92); note = 'Large image: uploaded as JPEG to keep it small.'; }
      let res;
      try { res = await chrome.runtime.sendMessage({ type: MSG.UPLOAD_SHOT, dataUrl: await blobToDataUrl(blob) }); }
      catch (_) { throw new Error('The extension was reloaded. Refresh this page and try again (your screenshot here is kept until then).'); }
      if (destroyed || !bars) return; // the editor was closed while uploading
      if (!res || !res.ok) throw new Error((res && res.error) || 'Upload failed.');
      const copied = await copyText(res.url);
      bars.flash('share');
      toast(copied ? 'Screenshot link copied!' : 'Screenshot link ready', 'success');
      openLinkPopover(res.url, res.expiresAt, copied, note);
    } catch (e) {
      if (destroyed || !bars) return;
      openFailPopover((e && e.message) || 'Upload failed.');
    } finally {
      if (bars) bars.setUploading(false);
    }
  });

  function openLinkPopover(url, expiresAt, copied, note) {
    closePopover();
    const exp = expiryText(expiresAt);
    popover = h('div', 'ss-pop ss-share', `
      <div class="ss-pop-title ss-okt">${icon('check', 15)}<span>${copied ? 'Screenshot link copied!' : 'Your screenshot link is ready'}</span></div>
      <input type="text" class="ss-url" readonly value="${esc(url)}" aria-label="Screenshot link" spellcheck="false">
      <small class="ss-note">Anyone with this link can view this screenshot${exp ? ` · it is deleted after ${exp}` : ''}.${note ? ' ' + esc(note) : ''}</small>
      <div class="ss-pop-actions">
        <button class="ss-btn ss-primary wide" data-p="primary">${icon('copy', 15)}<span>Copy Link</span></button>
        <button class="ss-btn wide" data-p="open">${icon('link', 15)}<span>Open Link</span></button>
        <button class="ss-btn wide" data-p="download">${icon('download', 15)}<span>Download</span></button>
        <button class="ss-btn wide" data-p="cancel">Close</button>
      </div>`);
    placePopover(340, 150);
    const input = popover.querySelector('.ss-url');
    popover.addEventListener('mousedown', (e) => { if (!e.target.closest('input')) e.preventDefault(); });
    popover.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-p]');
      if (!b) return;
      if (b.dataset.p === 'cancel') closePopover();
      else if (b.dataset.p === 'open') window.open(url, '_blank', 'noopener');
      else if (b.dataset.p === 'download') doDownload();
      else if (await copyText(url)) { toast('Screenshot link copied!', 'success'); bars.flash('share'); }
      else { input.focus(); input.select(); toast('Press Ctrl+C to copy the selected link', 'success'); }
    });
    input.focus(); input.select();
  }

  function openFailPopover(message) {
    closePopover();
    popover = h('div', 'ss-pop ss-share', `
      <div class="ss-pop-title ss-badt">${icon('x', 15)}<span>Upload failed</span></div>
      <small class="ss-note ss-err">${esc(message)}</small>
      <small class="ss-note">Your screenshot is still in the editor. Nothing was lost.</small>
      <div class="ss-pop-actions">
        <button class="ss-btn wide" data-p="cancel">Close</button>
        <button class="ss-btn ss-primary wide" data-p="primary">${icon('redo', 15)}<span>Retry</span></button>
      </div>`);
    placePopover(340, 150);
    popover.addEventListener('mousedown', (e) => e.preventDefault());
    popover.addEventListener('click', (e) => {
      const b = e.target.closest('[data-p]');
      if (!b) return;
      if (b.dataset.p === 'cancel') closePopover(); else doShare();
    });
  }

  function openSavePopover() {
    if (!editor) return;
    if (popover) { closePopover(); return; }
    const stem = defaultFilename('png').replace(/\.png$/, '');
    popover = h('div', 'ss-pop', `
      <div class="ss-pop-title">Save screenshot</div>
      <label class="ss-field"><span>File name</span><input type="text" class="ss-name" value="${stem}" spellcheck="false" maxlength="120" aria-label="File name"></label>
      <div class="ss-field"><span>Format</span><div class="ss-seg"><button data-fmt="png" class="on">PNG</button><button data-fmt="jpeg">JPEG</button></div><small class="ss-note">PNG keeps every pixel exactly. JPEG is smaller but lossy.</small></div>
      <div class="ss-pop-actions">
        <button class="ss-btn wide" data-p="cancel">Cancel</button>
        ${typeof window.showSaveFilePicker === 'function' ? `<button class="ss-btn wide" data-p="saveas">${icon('save', 15)}<span>Choose location…</span></button>` : ''}
        <button class="ss-btn ss-primary wide" data-p="save">${icon('download', 15)}<span>Save</span></button>
      </div>`);
    placePopover(340, 190);
    let fmt = 'png';
    const input = popover.querySelector('.ss-name');
    popover.addEventListener('mousedown', (e) => { if (!e.target.closest('input')) e.preventDefault(); });
    popover.addEventListener('click', async (e) => {
      const f = e.target.closest('[data-fmt]');
      if (f) { fmt = f.dataset.fmt; popover.querySelectorAll('[data-fmt]').forEach((b) => b.classList.toggle('on', b === f)); return; }
      const b = e.target.closest('[data-p]');
      if (!b) return;
      if (b.dataset.p === 'cancel') { closePopover(); return; }
      const ext = fmt === 'jpeg' ? 'jpg' : 'png';
      const name = sanitizeFilename(input.value, ext);
      closePopover();
      await withBusy('save', async () => {
        const blob = await canvasToBlob(editor.exportCanvas(), fmt === 'jpeg' ? 'image/jpeg' : 'image/png', 1);
        if (b.dataset.p === 'saveas') {
          const res = await saveBlob(blob, name);
          if (res.cancelled) return;
          toast(`Saved ${res.name}`, 'success');
        } else { downloadBlob(blob, name); toast(`Saved ${name}`, 'success'); }
        bars.flash('save');
      });
    });
    input.focus(); input.select();
  }

  /* ---------------------------------- keys ---------------------------------- */

  /** Called from the page-level keydown handler. Returns true when the key belongs to the screenshot UI. */
  function onKeyDown(e) {
    if (destroyed) return false;
    if (phase === 'capturing' || phase === 'stitching') {
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); if (phase === 'stitching') cancelStitch = true; else onExit(); return true; }
      return false;
    }
    if (phase === 'selecting') {
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); onExit(); return true; }
      if (e.key === 'Enter') { e.preventDefault(); sel.confirm(); return true; }
      return false;
    }
    if (phase !== 'editing' || !editor) return false;
    const inField = e.composedPath && e.composedPath()[0] && /^(INPUT|TEXTAREA)$/.test(e.composedPath()[0].tagName || '');
    if (popover) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePopover(); return true; }
      if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); popover.querySelector('[data-p="save"], [data-p="primary"]').click(); return true; }
      e.stopPropagation();
      return true; // typing a file name
    }
    const r = editor.handleKey(e);
    if (r === 'typing') { e.stopPropagation(); return true; }
    if (r) { e.stopPropagation(); return true; }
    if (inField) return true;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); onExit(); return true; }
    if (mod && k === 'c') { e.preventDefault(); e.stopPropagation(); doCopy(); return true; }
    if (mod && k === 's') { e.preventDefault(); e.stopPropagation(); openSavePopover(); return true; }
    if (mod && k === 'd') { e.preventDefault(); e.stopPropagation(); doDownload(); return true; }
    if (e.key === 'Enter') { e.preventDefault(); return true; }
    return false;
  }

  return { start, destroy, onKeyDown, get phase() { return phase; } };
}
