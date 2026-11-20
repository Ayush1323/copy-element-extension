import { MODES, DEFAULT_SETTINGS } from '../../shared/constants.js';
import { MSG } from '../../shared/message-types.js';
import { getSettings, onStorageChange } from '../../shared/storage.js';
import { rafThrottle, truncate } from '../../shared/helpers.js';
import { logger } from '../../utils/logger.js';
import { errorMessage } from '../../utils/error-handler.js';
import { isEditable, hasLayout, rectOf, tagOf, resetCaches } from './dom-utils.js';
import { detectRaw, describeElement } from './element-detector.js';
import { findCard } from './card-extractor.js';
import { findSection } from './section-extractor.js';
import { buildPayload, payloadFromSelection, commitCopy } from './copy-service.js';
import { writeClipboard } from '../clipboard/clipboard-manager.js';
import { elementMode } from '../modes/element-mode.js';
import { cardMode } from '../modes/card-mode.js';
import { sectionMode } from '../modes/section-mode.js';
import { textMode } from '../modes/text-mode.js';
import { imagesMode } from '../modes/images-mode.js';
import { createShadowUI } from '../ui/shadow-root-ui.js';
import { createHighlight } from '../ui/selection-highlight.js';
import { createToolbar } from '../ui/floating-toolbar.js';
import { createToaster } from '../ui/toast.js';
import { createIndicator } from '../ui/indicator.js';
import { createSelectionButton } from '../ui/selection-button.js';
import { createPreview } from '../ui/preview-panel.js';
import { createLinkPanel } from '../ui/link-panel.js';
import { createImageTip } from '../ui/image-inspector.js';
import { imageTargetAt, clearImageCaches, startImageIndex, stopImageIndex } from './image-info.js';
import { findLinkAt, readLinkInfo } from './link-info.js';

const MODE_DEFS = { element: elementMode, card: cardMode, section: sectionMode, text: textMode, images: imagesMode };
const SWALLOWED = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'dblclick', 'auxclick', 'touchstart', 'touchend'];
const IS_TOP = (() => { try { return window.top === window; } catch (_) { return true; } })();

export function createPickerController() {
  let settings = { ...DEFAULT_SETTINGS };
  let mode = null; // 'element' | 'card' | 'section' | 'text' | null
  let ui = null;
  let parts = null;
  let hovered = null; // { raw, list, index }
  let last = { x: -1, y: -1 };
  let overUI = false;
  let mouseDown = null;
  let lastPayload = null;
  let lastCopyAt = 0;
  let cursorStyle = null;
  let mo = null;
  let ro = null;
  let rafId = 0;
  let lastRectKey = '';
  let lastMutationUpdate = 0;
  let handleState = null; // { el, hovered } — the target the visible toolbar handle belongs to
  let handleTimer = 0;
  let imageHover = null; // { el, kind, url } under the pointer in Inspect Images mode
  let linkEl = null; // anchor whose attribute panel is showing
  let unsubStorage = null;
  let listeners = [];

  const def = () => MODE_DEFS[mode];
  const hoverOn = () => !!mode && def().hover;

  /* ---------------- lifecycle ---------------- */

  async function ensureSettings() {
    try { settings = await getSettings(); } catch (_) { /* keep defaults */ }
  }

  function buildUI() {
    ui = createShadowUI();
    ui.mount();
    ui.setAccent(settings.highlightColor);
    parts = {
      highlight: createHighlight(ui),
      linkPanel: createLinkPanel(ui, { onCopy: copyLinkPart, onEnableFull: () => { try { chrome.runtime.sendMessage({ type: MSG.OPEN_OPTIONS }); } catch (_) { /* context invalidated */ } }, onLeave: (e) => { overUI = false; last = { x: e.clientX, y: e.clientY }; scheduleUpdate(); } }), // before the toolbar so the toolbar menu stacks above it
      imageTip: createImageTip(ui),
      toolbar: createToolbar(ui, { onAction: onToolbarAction }),
      toaster: createToaster(ui, () => settings.toastEnabled),
      selection: createSelectionButton(ui, { onCopy: copySelection }),
      preview: createPreview(ui, {
        onCopyAll: async (f) => copyPayload(lastPayload, f === 'default' ? settings.defaultFormat : f, true),
        onCopyPart: async (text) => {
          const r = await writeClipboard({ text });
          toast(r.ok ? 'Copied part' : r.error, r.ok ? 'success' : 'error');
          return r.ok;
        },
        onClose: () => parts.preview.close(),
      }),
      indicator: IS_TOP ? createIndicator(ui, { onMode: (m) => setMode(m), onExit: () => setMode(null) }) : null,
    };
  }

  function on(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    listeners.push(() => target.removeEventListener(type, fn, opts));
  }

  function attach() {
    // selection feature first, so it runs before the swallowing handlers below
    on(window, 'pointerdown', (e) => { if (!ui.owns(e)) mouseDown = { x: e.clientX, y: e.clientY }; }, true);
    on(window, 'pointerup', () => { setTimeout(() => { mouseDown = null; updateSelectionButton(); }, 0); }, true);
    on(document, 'selectionchange', scheduleSelection);
    on(window, 'scroll', rafThrottle(() => { updateSelectionButton(); }), { capture: true, passive: true });
    on(window, 'keydown', onKeyDown, true);

    if (mode === MODES.IMAGES) {
      on(window, 'pointermove', onImageMove, { capture: true, passive: true });
      on(window, 'scroll', scheduleImage, { capture: true, passive: true });
      on(window, 'resize', scheduleImage, { passive: true });
      on(document, 'mouseleave', () => clearImage());
    }

    if (hoverOn()) {
      on(window, 'pointermove', onMove, { capture: true, passive: true });
      on(window, 'mousemove', onMove, { capture: true, passive: true });
      for (const t of SWALLOWED) on(window, t, onSwallow, { capture: true, passive: true });
      on(window, 'click', onClick, true);
      on(window, 'resize', () => { renderHover(); updateSelectionButton(); }, { passive: true });
      on(document, 'mouseleave', () => { if (!overUI) clearHover(); });

      mo = new MutationObserver(onMutation);
      mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'open'] });
      ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => renderHover()) : null;

      cursorStyle = document.createElement('style');
      cursorStyle.setAttribute('data-linklens', 'cursor');
      cursorStyle.textContent = 'html *:not(linklens-root){cursor:crosshair !important;}';
      document.documentElement.appendChild(cursorStyle);
    }
  }

  function detach() {
    listeners.forEach((off) => off());
    listeners = [];
    if (mo) mo.disconnect();
    if (ro) ro.disconnect();
    mo = ro = null;
    cancelAnimationFrame(rafId);
    rafId = 0;
    clearTimeout(handleTimer);
    handleTimer = 0;
    handleState = null;
    hideLinkNow();
    imageHover = null;
    stopImageIndex();
    if (parts) { parts.imageTip.hide(); parts.highlight.hide(); }
    if (cursorStyle) cursorStyle.remove();
    cursorStyle = null;
  }

  function teardownUI() {
    if (parts) {
      parts.highlight.hide();
      parts.toolbar.hide();
      parts.linkPanel.hideNow();
      parts.imageTip.hide();
      parts.preview.close();
      parts.selection.hide();
      if (parts.indicator) parts.indicator.hide();
    }
    if (ui) ui.unmount();
    ui = parts = null;
  }

  async function setMode(next, { broadcast = true } = {}) {
    if (next === mode) return mode;
    if (mode) { detach(); hovered = null; }
    mode = next;
    if (!mode) {
      teardownUI();
      if (unsubStorage) unsubStorage();
      unsubStorage = null;
    } else {
      await ensureSettings();
      if (!ui) buildUI();
      else { ui.setAccent(settings.highlightColor); parts.highlight.hide(); parts.toolbar.hide(); }
      attach();
      if (!unsubStorage) {
        unsubStorage = onStorageChange(async () => {
          await ensureSettings();
          if (ui) { ui.setAccent(settings.highlightColor); renderHover(); }
        });
      }
      if (parts.indicator) parts.indicator.show(mode);
      if (mode === MODES.IMAGES) { clearImageCaches(); startImageIndex(); }
    }
    if (broadcast) notify();
    return mode;
  }

  function notify() {
    try {
      chrome.runtime.sendMessage({ type: MSG.MODE_CHANGED, mode, origin: 'content' }).catch(() => {});
    } catch (_) { /* context invalidated */ }
  }

  /* ---------------- hover detection ---------------- */

  function onMove(e) {
    if (ui.owns(e)) {
      overUI = true;
      // Pointer reached the toolbar handle: snap back to the element it belongs to (hover "intent" grace).
      if (handleState && hovered !== handleState.hovered && handleState.el.isConnected && parts.toolbar.hit(e.clientX, e.clientY)) {
        clearTimeout(handleTimer);
        handleTimer = 0;
        hovered = handleState.hovered;
        renderHover(true);
      }
      return;
    }
    overUI = false;
    last = { x: e.clientX, y: e.clientY };
    scheduleUpdate();
  }

  const scheduleUpdate = rafThrottle(() => update());

  function update() {
    if (!hoverOn() || overUI || last.x < 0) return;
    let raw = null;
    try { raw = detectRaw(last.x, last.y); } catch (err) { logger.warn('detect failed', err); }
    if (!raw || ['BODY', 'HTML'].includes(tagOf(raw.el))) { clearHover(); return; }
    syncLink(raw);
    const res = def().candidates(raw);
    const next = { raw, list: res.list, index: res.index, base: res.index, label: res.label || '', kind: res.kind || '' };
    if (hovered && hovered.list[hovered.index] === next.list[next.index]) {
      hovered.raw = raw; // same target: keep the user's ArrowUp/Down level
    } else hovered = next;
    renderHover(true);
  }

  /* ---------------- image inspector (Inspect Images mode) ---------------- */

  function clearImage() {
    imageHover = null;
    if (!parts) return;
    parts.highlight.hide();
    parts.imageTip.hide();
  }

  function renderImage() {
    if (mode !== MODES.IMAGES || !parts) return;
    const t = last.x >= 0 ? imageTargetAt(last.x, last.y) : null;
    if (!t) { clearImage(); return; }
    const r = rectOf(t.el);
    if (r.width === 0 && r.height === 0) { clearImage(); return; }
    imageHover = t;
    parts.highlight.show(r, t.kind === 'bg' ? 'BACKGROUND IMAGE' : 'IMAGE', { showLabel: true });
    parts.imageTip.show(t, r, last);
  }

  const scheduleImage = rafThrottle(() => renderImage());

  function onImageMove(e) {
    if (!parts) return;
    if (ui.owns(e)) { clearImage(); return; }
    last = { x: e.clientX, y: e.clientY };
    scheduleImage();
  }

  async function copyImageUrl() {
    if (!imageHover) return false;
    const r = await writeClipboard({ text: imageHover.url });
    toast(r.ok ? `Copied ${imageHover.kind === 'bg' ? 'background image' : 'image'} URL` : r.error, r.ok ? 'success' : 'error');
    if (r.ok) lastCopyAt = Date.now();
    return r.ok;
  }

  /* ---------------- link attribute panel (Element Picker only) ---------------- */

  function linkRect(a) {
    const rects = Array.from(a.getClientRects()).filter((r) => r.width > 0 && r.height > 0);
    // wrapped inline links: anchor the panel to the line box under the pointer
    return rects.find((r) => last.x >= r.left && last.x <= r.right && last.y >= r.top && last.y <= r.bottom) || rects[0] || rectOf(a);
  }

  /** Hover intent: a link panel appears only once the pointer has stayed on the link for a moment, so sweeping the
   *  pointer across a line of links never flashes panels that then land on the thing you are aiming at. */
  const LINK_INTENT_MS = 140;
  let linkIntentEl = null;
  let linkIntentTimer = 0;

  function cancelLinkIntent() {
    clearTimeout(linkIntentTimer);
    linkIntentTimer = 0;
    linkIntentEl = null;
  }

  function showLinkPanel(a) {
    if (!parts) return;
    const r = linkRect(a);
    if (r.width === 0 && r.height === 0) { parts.linkPanel.hideSoon(); return; }
    linkEl = a;
    parts.linkPanel.show(readLinkInfo(a), r, { preview: !!settings.linkPreview, anySite: !!settings.linkPreviewAnySite, pointer: last.x >= 0 ? { x: last.x, y: last.y } : null });
  }

  function syncLink(raw) {
    if (!parts || mode !== MODES.ELEMENT) return;
    let a = null;
    try { a = findLinkAt(raw.el, last.x, last.y); } catch (_) { /* ignore */ }
    if (!a) { cancelLinkIntent(); parts.linkPanel.hideSoon(); return; }
    // already showing (this or another link): update immediately, no delay
    if (parts.linkPanel.isVisible()) { cancelLinkIntent(); showLinkPanel(a); return; }
    if (linkIntentEl === a) return; // still waiting for the pointer to settle
    cancelLinkIntent();
    linkIntentEl = a;
    linkIntentTimer = setTimeout(() => {
      linkIntentTimer = 0;
      const want = linkIntentEl;
      linkIntentEl = null;
      if (!want || !parts || mode !== MODES.ELEMENT || overUI) return;
      let now = null;
      try { now = findLinkAt(null, last.x, last.y); } catch (_) { /* ignore */ }
      if (now === want) showLinkPanel(want);
    }, LINK_INTENT_MS);
  }

  function hideLinkNow() {
    cancelLinkIntent();
    linkEl = null;
    if (parts && parts.linkPanel) parts.linkPanel.hideNow();
  }

  function trackLink() {
    if (!linkEl || !parts) return;
    if (!linkEl.isConnected) { hideLinkNow(); return; }
    parts.linkPanel.reposition(linkRect(linkEl));
  }

  async function copyLinkPart(kind) {
    if (!linkEl) return false;
    const info = readLinkInfo(linkEl);
    const text = kind === 'url' ? info.href : kind === 'rel' ? info.rel || '' : linkEl.outerHTML;
    if (!text) return false;
    const r = await writeClipboard({ text });
    toast(r.ok ? `Copied ${kind === 'url' ? 'URL' : kind === 'rel' ? 'rel values' : 'link HTML'}` : r.error, r.ok ? 'success' : 'error');
    return r.ok;
  }

  function targetEl() { return hovered ? hovered.list[hovered.index] : null; }

  function rectFor(el) {
    let r = rectOf(el);
    if (r.width === 0 && r.height === 0) {
      for (const c of el.children) { if (hasLayout(c)) { r = rectOf(c); break; } }
    }
    return r;
  }

  function renderHover(retarget = false) {
    const el = targetEl();
    if (!el || !el.isConnected || !parts) { if (el && !el.isConnected) { clearHover(); } return; }
    const r = rectFor(el);
    if (r.width === 0 && r.height === 0) { clearHover(); return; }
    trackLink();
    const label = labelFor(el);
    parts.highlight.show(r, label, { showLabel: settings.showLabels && (!settings.toolbarEnabled || (!!handleState && handleState.el !== el)) });
    if (!settings.toolbarEnabled) hideToolbarNow();
    else if (!handleState || handleState.el === el || !parts.toolbar.isVisible()) {
      clearTimeout(handleTimer);
      handleTimer = 0;
      applyToolbar();
    } else deferToolbar(applyToolbar); // new target: give the pointer time to travel to the old handle
    if (ro && retarget) { ro.disconnect(); ro.observe(el); }
    startPoll();
  }

  function labelFor(el) {
    if (hovered && hovered.label && hovered.index === hovered.base && hovered.list[hovered.index] === el) return hovered.label;
    return describeElement(el, mode === MODES.CARD || mode === MODES.SECTION ? mode : 'element');
  }

  function applyToolbar() {
    const el = targetEl();
    if (!el || !el.isConnected || !parts || !settings.toolbarEnabled) { hideToolbarNow(); return; }
    const r = rectFor(el);
    handleState = { el, hovered };
    parts.toolbar.show({
      rect: r,
      label: settings.showLabels ? labelFor(el) : 'SELECTED',
      preview: (el.textContent || '').trim().slice(0, 400),
      meta: `${Math.round(r.width)}×${Math.round(r.height)}`,
      primary: def().primary,
    });
  }

  function hideToolbarNow() {
    clearTimeout(handleTimer);
    handleTimer = 0;
    handleState = null;
    if (parts) parts.toolbar.hide();
  }

  function deferToolbar(fn) {
    clearTimeout(handleTimer);
    handleTimer = setTimeout(() => {
      handleTimer = 0;
      if (!overUI) fn();
    }, 300);
  }

  function clearHover() {
    hovered = null;
    lastRectKey = '';
    if (!parts) return;
    parts.highlight.hide();
    parts.linkPanel.hideSoon(); // linkEl is kept so the panel's copy buttons still work while the pointer travels to it
    cancelAnimationFrame(rafId);
    rafId = 0;
    if (handleState && parts.toolbar.isVisible()) deferToolbar(hideToolbarNow);
    else hideToolbarNow();
  }

  /** Keep the outline glued to the element through scroll, animation and layout shifts. */
  function startPoll() {
    if (rafId) return;
    const tick = () => {
      rafId = 0;
      const el = targetEl();
      if (!el || !hoverOn() || !parts) return;
      if (!el.isConnected) { clearHover(); scheduleUpdate(); return; }
      const r = rectFor(el);
      const key = `${r.left | 0},${r.top | 0},${r.width | 0},${r.height | 0}`;
      if (key !== lastRectKey) { lastRectKey = key; renderHover(); }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
  }

  function onMutation(muts) {
    if (!hoverOn()) return;
    if (muts.every((m) => ui && ui.host && (m.target === ui.host || ui.host.contains(m.target) || m.target === cursorStyle))) return;
    const now = performance.now();
    if (now - lastMutationUpdate < 120) return;
    lastMutationUpdate = now;
    scheduleUpdate();
  }

  /* ---------------- page interception (force copy) ---------------- */

  function suppressible(e) {
    if (!hoverOn() || !ui) return false;
    if (ui.owns(e)) return false; // our own toolbar / panel keeps working
    if (isEditable(e.target)) return false; // never break typing / caret placement
    return true;
  }

  function onSwallow(e) {
    if (!suppressible(e)) return;
    // Hide the press from site handlers (SPA routers, sliders, tracking) but keep default text selection.
    e.stopImmediatePropagation();
  }

  function onClick(e) {
    if (!suppressible(e)) return;
    e.preventDefault(); // no navigation, no form submits
    e.stopImmediatePropagation(); // no site click handlers
    if (e.button !== 0) return;
    const dragged = mouseDown && Math.hypot(e.clientX - mouseDown.x, e.clientY - mouseDown.y) > 5;
    const sel = window.getSelection();
    if (dragged || (sel && !sel.isCollapsed && sel.toString().trim())) return; // user was selecting text
    if (e.clientX >= 0 && (e.clientX !== last.x || e.clientY !== last.y || !hovered)) {
      last = { x: e.clientX, y: e.clientY };
      update();
    }
    primaryAction();
  }

  /* ---------------- actions ---------------- */

  function toast(msg, type = 'success', detail = '') {
    if (parts) parts.toaster.show(msg, { type, detail });
  }

  function elementForKind(kind) {
    if (!hovered) return null;
    const raw = hovered.raw.el;
    if (kind === 'card') return mode === MODES.CARD || (hovered.kind === 'card' && hovered.index === hovered.base) ? targetEl() : findCard(raw);
    if (kind === 'section') return mode === MODES.SECTION ? targetEl() : findSection(raw);
    return mode === MODES.ELEMENT ? targetEl() : raw; // 'text' | 'element'
  }

  async function copyPayload(payload, format, fromPreview = false) {
    if (!payload) return false;
    const res = await commitCopy(payload, format, settings);
    if (res.ok) {
      const how = format === 'markdown' && !res.markdown ? ' as plain text' : res.markdown ? ' as Markdown' : format === 'rich' && !res.rich ? ' as plain text' : res.rich ? ' (rich)' : '';
      toast(`Copied ${payload.type.toLowerCase()}${how}`, 'success', `${res.chars.toLocaleString('en-US')} chars`);
      if (parts && parts.preview.isOpen()) parts.preview.markCopied();
      lastCopyAt = Date.now();
    } else toast(res.error || 'Copy failed', 'error');
    void fromPreview;
    return res.ok;
  }

  async function perform(kind, { preview = false } = {}) {
    const el = elementForKind(kind);
    if (!el) { toast('Hover over an element first', 'error'); return; }
    let payload;
    try {
      payload = buildPayload(kind, el, settings);
    } catch (err) {
      logger.error(err);
      toast(`Could not extract: ${errorMessage(err)}`, 'error');
      return;
    }
    if (!payload.text) { toast('No visible text found here', 'error'); return; }
    lastPayload = payload;
    if (preview) {
      parts.preview.open(payload, kind === 'text' ? 'TEXT' : kind === 'element' ? describeElement(el, 'element') : kind.toUpperCase());
      return;
    }
    // 'Copy Text' is exact plain text, unless Markdown is chosen: then links are kept as [text](url)
    const ok = await copyPayload(payload, kind === 'text' && settings.defaultFormat !== 'markdown' ? 'plain' : settings.defaultFormat);
    if (ok && parts) parts.toolbar.flash(kind);
  }

  function primaryAction() {
    // element mode on empty card space acts on the whole card
    const kind = mode === MODES.ELEMENT && hovered && hovered.kind && hovered.index === hovered.base ? hovered.kind : def().primary;
    const wantsPreview = (kind === 'card' || kind === 'section') && settings.extractionBehavior === 'preview';
    return perform(kind, { preview: wantsPreview });
  }

  function onToolbarAction(action) {
    if (action === 'preview') return perform(def().primary === 'selection' ? 'element' : def().primary, { preview: true });
    return perform(action);
  }

  async function copySelection() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return;
    const payload = payloadFromSelection(sel, settings);
    if (!payload.text) return;
    const res = await commitCopy(payload, settings.defaultFormat, settings);
    if (res.ok) {
      parts.selection.flashOk();
      toast(res.markdown ? 'Copied selection as Markdown' : 'Copied selection', 'success', `${res.chars.toLocaleString('en-US')} chars`);
    } else toast(res.error || 'Copy failed', 'error');
  }

  /** Alt+C / command: copy whatever is highlighted right now. */
  async function copyHovered() {
    if (!mode) return false;
    if (Date.now() - lastCopyAt < 250) return true;
    if (mode === MODES.IMAGES) return imageHover ? copyImageUrl() : false;
    if (mode === MODES.TEXT || !hovered) {
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed) { await copySelection(); return true; }
      return false;
    }
    await primaryAction();
    return true;
  }

  /* ---------------- selection button ---------------- */

  const scheduleSelection = (() => {
    let t = 0;
    return () => { clearTimeout(t); t = setTimeout(updateSelectionButton, 140); };
  })();

  function updateSelectionButton() {
    if (!parts || !mode) return;
    const sel = window.getSelection();
    if (mouseDown || !sel || sel.isCollapsed || !sel.toString().trim() || sel.rangeCount === 0) { parts.selection.hide(); return; }
    const anchor = sel.anchorNode && (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement);
    if (anchor && tagOf(anchor) === 'LINKLENS-ROOT') return;
    if (anchor && isEditable(anchor)) { parts.selection.hide(); return; }
    const range = sel.getRangeAt(sel.rangeCount - 1);
    const rects = range.getClientRects();
    const r = rects.length ? rects[rects.length - 1] : range.getBoundingClientRect();
    if (!r || (r.width === 0 && r.height === 0)) { parts.selection.hide(); return; }
    parts.selection.show(r);
  }

  /* ---------------- keyboard ---------------- */

  function onKeyDown(e) {
    if (!mode) return;
    if (e.key === 'Escape') {
      if (parts.preview.isOpen()) { parts.preview.close(); e.preventDefault(); e.stopImmediatePropagation(); return; }
      e.preventDefault();
      e.stopImmediatePropagation();
      setMode(null);
      return;
    }
    if (e.altKey && !e.ctrlKey && !e.metaKey) {
      if (e.code === 'KeyC' && (hoverOn() || mode === MODES.IMAGES)) { e.preventDefault(); copyHovered(); return; }
      if (e.code === 'KeyE') { e.preventDefault(); setMode(MODES.ELEMENT); return; }
      if (e.code === 'KeyS') { e.preventDefault(); setMode(MODES.SECTION); return; }
      if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && hoverOn() && hovered) {
        e.preventDefault();
        const d = e.key === 'ArrowUp' ? 1 : -1;
        hovered.index = Math.min(Math.max(hovered.index + d, 0), hovered.list.length - 1);
        renderHover(true);
      }
    }
  }

  return {
    setMode,
    copyHovered,
    getMode: () => mode,
    hasHover: () => !!hovered,
    _debug: { get hovered() { return hovered; }, get settings() { return settings; }, update, resetCaches, truncate },
  };
}
