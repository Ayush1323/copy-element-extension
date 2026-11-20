import { h } from './shadow-root-ui.js';
import { icon } from '../../shared/icons.js';
import { truncate } from '../../shared/helpers.js';
import { LINK_PANEL_W } from './placement.js';
import { linkSignature, previewDecision } from '../core/link-info.js';
import { MSG } from '../../shared/message-types.js';

const HIDE_DELAY = 400; // grace period: time to travel from the link into the panel
const TOOLBAR_CLEAR = 28; // the element toolbar's handle sits right above the target
const NONE = 'Not specified';
const PREVIEW_DELAY = 900; // dwell before the destination is actually requested
const VIEW_W = 1024; // the preview renders a desktop-sized page and scales it down

/** Floating attribute panel for the hovered <a>. All values are written with textContent (never innerHTML). */
export function createLinkPanel(ui, { onCopy, onLeave, onEnableFull }) {
  const el = h('div', 'linkp', `
    <div class="lp-head"><span class="lp-chip">LINK</span><span class="lp-sub">Attributes</span></div>
    <dl class="lp-list"></dl>
    <div class="lp-prev" hidden>
      <div class="lp-frame"><div class="lp-ph"></div><button type="button" class="lp-frame-click" data-open title="Open in a new tab" aria-label="Open link in a new tab"></button></div>
      <div class="lp-prev-bar"><span class="lp-prev-note"></span><button type="button" class="lp-enable" data-enable hidden>Enable full previews</button><button type="button" class="lp-open" data-open>${icon('globe', 12)}<span>Open in new tab</span></button></div>
    </div>`);
  el.hidden = true;
  ui.layer.appendChild(el);
  const list = el.querySelector('.lp-list');
  const prev = el.querySelector('.lp-prev');
  const frame = el.querySelector('.lp-frame');
  const ph = el.querySelector('.lp-ph');
  const note = el.querySelector('.lp-prev-note');
  let prevHref = '';
  let prevTimer = 0;
  let prevFrame = null;
  let openHref = '';
  let pointer = null;
  let anySite = false;
  const enableBtn = el.querySelector('.lp-enable');
  let lastPt = null;

  let sig = '';
  let timer = 0;
  let anchorRect = null;

  const copyBtn = (kind, label) => {
    const b = h('button', 'lp-copy', icon('copy', 12));
    b.type = 'button';
    b.dataset.copy = kind;
    b.title = label;
    b.setAttribute('aria-label', label);
    return b;
  };

  function row(name, valueNode, missing, copy) {
    const wrap = h('div', 'lp-row');
    const dt = h('dt', 'lp-k');
    dt.textContent = name;
    const dd = h('dd', 'lp-v' + (missing ? ' none' : ''));
    if (typeof valueNode === 'string') dd.textContent = valueNode;
    else dd.appendChild(valueNode);
    wrap.append(dt, dd);
    if (copy) wrap.appendChild(copyBtn(copy[0], copy[1]));
    list.appendChild(wrap);
  }

  function attrRow(name, val) {
    if (val == null) return row(name, NONE, true);
    if (val === '') return row(name, 'Empty', true);
    return row(name, val, false);
  }

  function render(info) {
    list.textContent = '';
    row('Text', info.text ? truncate(info.text, 140) : NONE, !info.text);
    row('href', info.href || NONE, !info.href, info.href ? ['url', 'Copy URL'] : null);
    attrRow('target', info.target);
    if (info.relTokens.length) {
      const chips = h('span', 'lp-chips');
      for (const t of info.relTokens) {
        const c = h('span', 'lp-rel');
        c.textContent = t;
        chips.appendChild(c);
      }
      row('rel', chips, false, ['rel', 'Copy rel values']);
    } else attrRow('rel', info.rel);
    attrRow('title', info.title);
    if (info.download == null) row('download', NONE, true);
    else row('download', info.download || 'Present (no filename)', !info.download);
    attrRow('aria-label', info.ariaLabel);
    const foot = h('div', 'lp-foot');
    const html = h('button', 'lp-html', `${icon('copy', 12)}<span>Copy HTML</span>`);
    html.type = 'button';
    html.dataset.copy = 'html';
    foot.appendChild(html);
    list.appendChild(foot);
  }

  /**
   * Position the panel so that it ALWAYS touches its link (or is bridged to it) and never sits on the pointer:
   * below, above, then beside the link, and only as a last resort docked to the far side of the screen.
   * It stays fully interactive; `data-edge` tells the CSS which side needs an invisible bridge for the pointer.
   */
  function place() {
    if (!anchorRect) return;
    const pad = 6;
    const vw = document.documentElement.clientWidth || window.innerWidth;
    const vh = window.innerHeight;
    const w = Math.min(LINK_PANEL_W, vw - 12);
    el.style.width = `${w}px`;
    const hgt = Math.min(el.offsetHeight || 200, vh - 2 * pad);
    const r = anchorRect;
    const cl = (v, lo, hi) => Math.min(Math.max(v, lo), Math.max(lo, hi));
    // strictly inside: the pointer legitimately touches the panel's edge when travelling from the link into it
    const hit = (p) => pointer && pointer.x > p.left && pointer.x < p.left + w && pointer.y > p.top && pointer.y < p.top + hgt;
    const left0 = cl(r.left, pad, vw - w - pad);
    const sideTop = cl(r.top - 6, pad, vh - hgt - pad);
    const cands = [];
    if (r.bottom + hgt <= vh - pad) cands.push({ left: left0, top: r.bottom, edge: 'top', gap: 8 });
    if (r.top - TOOLBAR_CLEAR - hgt >= pad) cands.push({ left: left0, top: r.top - TOOLBAR_CLEAR - hgt, edge: 'bottom', gap: TOOLBAR_CLEAR });
    if (r.right + 4 + w <= vw - pad) cands.push({ left: r.right + 4, top: sideTop, edge: 'left', gap: 8 });
    if (r.left - 4 - w >= pad) cands.push({ left: r.left - 4 - w, top: sideTop, edge: 'right', gap: 8 });
    let pos = cands.find((c) => !hit(c));
    if (!pos) {
      // nowhere adjacent: far side of the screen from the pointer (reachable: the pointer keeps hovering the link meanwhile)
      const onLeft = pointer ? pointer.x > vw / 2 : true;
      pos = { left: onLeft ? pad : Math.max(pad, vw - w - pad), top: cl(pointer && pointer.y > vh / 2 ? pad : vh - hgt - pad, pad, vh - hgt - pad), edge: 'none', gap: 0 };
    }
    el.dataset.edge = pos.edge;
    el.style.setProperty('--gap', `${pos.gap}px`);
    el.style.transform = `translate(${Math.round(pos.left)}px, ${Math.round(pos.top)}px)`;
  }

  function clearPreview() {
    clearTimeout(prevTimer);
    prevTimer = 0;
    prevHref = '';
    lastPt = null;
    if (prevFrame) { prevFrame.src = 'about:blank'; prevFrame.remove(); prevFrame = null; }
  }

  /** With "preview sites that block embedding" on, the frame goes through the extension's preview page. */
  async function frameSrc(url) {
    if (!anySite) return url;
    try {
      const r = await chrome.runtime.sendMessage({ type: MSG.PREVIEW_TOKEN });
      if (r && r.token) return `${chrome.runtime.getURL('preview/preview.html')}?u=${encodeURIComponent(url)}&t=${encodeURIComponent(r.token)}`;
    } catch (_) { /* fall back to a plain frame */ }
    return url;
  }

  function loadFrame(url) {
    const f = document.createElement('iframe');
    f.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms'); // no popups, no top navigation
    f.referrerPolicy = 'no-referrer';
    f.tabIndex = -1;
    f.setAttribute('aria-hidden', 'true');
    f.style.transform = `scale(${(frame.clientWidth || 300) / VIEW_W})`;
    f.addEventListener('load', () => { if (f.getAttribute('src')) ph.hidden = true; });
    prevFrame = f;
    try { frame.insertBefore(f, ph); } catch (e) { console.warn('[LinkLens] preview failed', e); }
    frameSrc(url).then((src) => { if (prevFrame === f) f.src = src; });
  }

  /** Keep the preview section in step with the hovered link (called on every hover update; cheap when unchanged). */
  function syncPreview(info, enabled) {
    openHref = info.href || '';
    if (!enabled || !openHref) { clearPreview(); prev.hidden = true; return; }
    const d = previewDecision(info);
    if (!d.ok) {
      // not loaded on purpose: just say why, in one line
      clearPreview();
      frame.hidden = true;
      enableBtn.hidden = true;
      note.textContent = d.reason || '';
      prev.hidden = !d.reason;
      return;
    }
    const moved = pointer && lastPt && Math.hypot(pointer.x - lastPt.x, pointer.y - lastPt.y) > 3;
    if (pointer) lastPt = pointer;
    if (d.url === prevHref) {
      // same destination: keep what is loading / loaded; if it has not started yet, a moving pointer restarts the dwell
      if (prevTimer && moved) startDwell(d);
      return;
    }
    clearPreview();
    prevHref = d.url;
    prev.hidden = true; // the panel stays compact until the pointer has rested on the link
    startDwell(d);
  }

  /** The destination is only requested once the pointer has rested on the link: sweeping across links loads nothing. */
  function startDwell(d) {
    clearTimeout(prevTimer);
    prevTimer = setTimeout(() => {
      prevTimer = 0;
      if (prevHref !== d.url) return;
      frame.hidden = false;
      ph.hidden = false;
      ph.textContent = 'Loading preview…';
      note.textContent = d.cross && !anySite ? 'Blank? This site may block embedding.' : '';
      enableBtn.hidden = !(d.cross && !anySite);
      prev.hidden = false;
      loadFrame(d.url);
      place(); // the panel just grew
    }, PREVIEW_DELAY);
  }

  function cancelHide() { clearTimeout(timer); timer = 0; }

  el.addEventListener('mouseenter', cancelHide);
  el.addEventListener('mouseleave', (e) => { hideSoon(); if (onLeave) onLeave(e); }); // onLeave re-checks the pointer: it may be resting on the link again
  el.addEventListener('mousedown', (e) => e.preventDefault()); // keep page focus/selection
  el.addEventListener('click', (e) => {
    const en = e.target.closest && e.target.closest('[data-enable]');
    if (en) { e.preventDefault(); e.stopPropagation(); if (onEnableFull) onEnableFull(); return; }
    const o = e.target.closest && e.target.closest('[data-open]');
    if (o) {
      e.preventDefault();
      e.stopPropagation();
      if (openHref) window.open(openHref, '_blank', 'noopener,noreferrer');
      return;
    }
    const b = e.target.closest && e.target.closest('[data-copy]');
    if (!b) return;
    e.preventDefault();
    e.stopPropagation();
    Promise.resolve(onCopy(b.dataset.copy)).then((ok) => {
      if (!ok) return;
      b.classList.add('ok');
      setTimeout(() => b.classList.remove('ok'), 700);
    });
  });

  function hideNow() { cancelHide(); clearPreview(); el.hidden = true; sig = ''; anchorRect = null; }
  function hideSoon() {
    if (el.hidden || timer) return;
    timer = setTimeout(hideNow, HIDE_DELAY);
  }

  return {
    el,
    /** Show (or refresh in place) for a link; unchanged content is not re-rendered. */
    show(info, rect, { preview = false, pointer: pt = null, anySite: any = false } = {}) {
      cancelHide();
      anchorRect = rect;
      pointer = pt;
      anySite = any;
      const s = linkSignature(info);
      if (s !== sig) { sig = s; render(info); }
      el.hidden = false;
      syncPreview(info, preview);
      place();
    },
    reposition(rect) { if (!el.hidden) { anchorRect = rect; place(); } },
    hideSoon,
    hideNow,
    cancelHide,
    isVisible: () => !el.hidden,
  };
}
