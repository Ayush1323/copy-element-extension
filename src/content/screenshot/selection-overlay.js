import { h } from '../ui/shadow-root-ui.js';
import { icon } from '../../shared/icons.js';

const MIN = 8;
const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const CURSOR = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize' };

/**
 * Same-screen selection layer: the frozen capture is shown exactly where the page is, dimmed; the user drags out
 * an area, then moves / resizes it. The live page is never touched.
 *
 * @param {object} ui shadow ui (layer)
 * @param {{frame: {bitmap: ImageBitmap, cssW: number, cssH: number}, canFullPage: boolean,
 *          onConfirm: (r: {x,y,w,h}) => void, onVisible: () => void, onFullPage: () => void, onCancel: () => void}} o
 */
export function createSelection(ui, { frame, canFullPage, onConfirm, onVisible, onFullPage, onCancel }) {
  const { cssW, cssH } = frame;
  const scale = frame.scaleX || 1; // device pixels per CSS pixel: what the exported image really contains
  const root = h('div', 'ss-sel', `
    <canvas class="ss-frozen"></canvas>
    <div class="ss-dim"></div>
    <div class="ss-box" hidden>
      <div class="ss-dims"></div>
      ${HANDLES.map((k) => `<i class="ss-h" data-h="${k}"></i>`).join('')}
    </div>
    <div class="ss-confirm" hidden>
      <button class="ss-btn ss-primary wide" data-act="confirm" aria-label="Capture selected area">${icon('check', 15)}<span>Capture</span></button>
      <button class="ss-btn" data-act="cancel" aria-label="Cancel screenshot" data-tip="Cancel (Esc)">${icon('x', 16)}</button>
    </div>
    <div class="ss-top">
      <div class="ss-hint">Drag to select an area</div>
      <div class="ss-pill" role="toolbar" aria-label="Capture mode">
        <button class="ss-chip" data-act="confirm" disabled>${icon('crop', 15)}<span>Selected area</span></button>
        <button class="ss-chip" data-act="visible">${icon('scan', 15)}<span>Visible screen</span></button>
        <button class="ss-chip" data-act="full" ${canFullPage ? '' : 'disabled title="This page does not scroll"'}>${icon('fullpage', 15)}<span>Full page</span></button>
        <i class="ss-sep"></i>
        <button class="ss-chip danger" data-act="cancel">${icon('x', 15)}<span>Cancel</span><kbd>Esc</kbd></button>
      </div>
    </div>`);
  ui.layer.appendChild(root);

  const canvas = root.querySelector('.ss-frozen');
  canvas.width = frame.bitmap.width; canvas.height = frame.bitmap.height;
  canvas.style.width = `${cssW}px`; canvas.style.height = `${cssH}px`;
  canvas.getContext('2d').drawImage(frame.bitmap, 0, 0);

  const dim = root.querySelector('.ss-dim');
  const box = root.querySelector('.ss-box');
  const dims = root.querySelector('.ss-dims');
  const confirm = root.querySelector('.ss-confirm');
  const hint = root.querySelector('.ss-hint');
  const pillConfirm = root.querySelector('.ss-pill [data-act="confirm"]');

  let rect = null; // {x,y,w,h} in css px
  let drag = null;
  let alive = true;
  let locked = false;

  const clampRect = (r) => {
    const x = Math.min(Math.max(r.x, 0), cssW - MIN), y = Math.min(Math.max(r.y, 0), cssH - MIN);
    return { x, y, w: Math.min(r.w, cssW - x), h: Math.min(r.h, cssH - y) };
  };

  function paint() {
    if (!rect || rect.w < 1) { box.hidden = true; confirm.hidden = true; dim.hidden = false; pillConfirm.disabled = true; hint.hidden = false; return; }
    dim.hidden = true; box.hidden = false; hint.hidden = true;
    box.style.transform = `translate(${rect.x}px, ${rect.y}px)`;
    box.style.width = `${rect.w}px`; box.style.height = `${rect.h}px`;
    dims.textContent = `${Math.round(rect.w)} × ${Math.round(rect.h)}` + (Math.abs(scale - 1) > 0.02 ? `  ·  ${Math.round(rect.w * scale)} × ${Math.round(rect.h * scale)} px` : '');
    dims.classList.toggle('in', rect.y < 30);
    const ok = rect.w >= MIN && rect.h >= MIN;
    pillConfirm.disabled = !ok;
    confirm.hidden = !ok || !!(drag && drag.kind === 'new');
    if (!confirm.hidden) {
      const cw = confirm.offsetWidth || 150, ch = confirm.offsetHeight || 40;
      let x = rect.x + rect.w - cw, y = rect.y + rect.h + 10;
      if (y + ch > cssH - 6) y = rect.y - ch - 10;
      if (y < 6) y = Math.min(rect.y + rect.h - ch - 10, cssH - ch - 6);
      confirm.style.transform = `translate(${Math.round(Math.min(Math.max(x, 6), cssW - cw - 6))}px, ${Math.round(Math.max(y, 6))}px)`;
    }
  }

  const pt = (e) => ({ x: Math.min(Math.max(e.clientX, 0), cssW), y: Math.min(Math.max(e.clientY, 0), cssH) });

  function onDown(e) {
    if (locked || e.button !== 0) return;
    if (e.target.closest('.ss-top, .ss-confirm')) return;
    e.preventDefault();
    const p = pt(e);
    root.setPointerCapture(e.pointerId);
    const handle = e.target.closest && e.target.closest('.ss-h');
    if (handle && rect) drag = { kind: 'resize', h: handle.dataset.h, orig: { ...rect } };
    else if (rect && p.x >= rect.x && p.x <= rect.x + rect.w && p.y >= rect.y && p.y <= rect.y + rect.h) drag = { kind: 'move', off: { x: p.x - rect.x, y: p.y - rect.y } };
    else { drag = { kind: 'new', start: p }; rect = { x: p.x, y: p.y, w: 0, h: 0 }; }
    paint();
  }

  function onMove(e) {
    if (locked || !drag) return;
    const p = pt(e);
    if (drag.kind === 'new') {
      rect = { x: Math.min(drag.start.x, p.x), y: Math.min(drag.start.y, p.y), w: Math.abs(p.x - drag.start.x), h: Math.abs(p.y - drag.start.y) };
    } else if (drag.kind === 'move') {
      rect = { ...rect, x: Math.min(Math.max(p.x - drag.off.x, 0), cssW - rect.w), y: Math.min(Math.max(p.y - drag.off.y, 0), cssH - rect.h) };
    } else {
      const o = drag.orig;
      let l = o.x, r = o.x + o.w, t = o.y, b = o.y + o.h;
      if (drag.h.includes('w')) l = p.x;
      if (drag.h.includes('e')) r = p.x;
      if (drag.h.includes('n')) t = p.y;
      if (drag.h.includes('s')) b = p.y;
      rect = { x: Math.min(l, r), y: Math.min(t, b), w: Math.abs(r - l), h: Math.abs(b - t) };
    }
    paint();
  }

  function onUp(e) {
    if (!drag) return;
    try { root.releasePointerCapture(e.pointerId); } catch (_) { /* released */ }
    const wasNew = drag.kind === 'new';
    drag = null;
    if (rect && (rect.w < MIN || rect.h < MIN) && wasNew) rect = null; // a click, not a drag
    paint();
  }

  function onHover(e) {
    if (locked || drag) return;
    const hnd = e.target.closest && e.target.closest('.ss-h');
    if (hnd) { root.style.cursor = CURSOR[hnd.dataset.h]; return; }
    const p = pt(e);
    root.style.cursor = rect && p.x >= rect.x && p.x <= rect.x + rect.w && p.y >= rect.y && p.y <= rect.y + rect.h ? 'move' : 'crosshair';
  }

  function act(a) {
    if (a === 'cancel') onCancel();
    else if (a === 'visible') onVisible();
    else if (a === 'full') onFullPage();
    else if (a === 'confirm' && rect && rect.w >= MIN && rect.h >= MIN) onConfirm(clampRect(rect));
  }

  root.addEventListener('pointerdown', onDown);
  root.addEventListener('pointermove', (e) => { onMove(e); onHover(e); });
  root.addEventListener('pointerup', onUp);
  root.addEventListener('pointercancel', onUp);
  root.addEventListener('dblclick', (e) => { if (!locked && rect && e.target.closest('.ss-box, .ss-dim, .ss-frozen')) act('confirm'); });
  root.addEventListener('contextmenu', (e) => e.preventDefault());
  root.addEventListener('wheel', (e) => e.preventDefault(), { passive: false }); // the page stays where the capture was taken
  root.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('[data-act]');
    if (b && !b.disabled) { e.stopPropagation(); act(b.dataset.act); }
  });

  paint();
  return {
    el: root,
    getRect: () => (rect && rect.w >= MIN && rect.h >= MIN ? clampRect(rect) : null),
    confirm: () => act('confirm'),
    /** Editing started: keep the dimmed capture behind the editor, drop all selection controls. */
    lock(r) { locked = true; drag = null; rect = { ...r }; root.classList.add('locked'); paint(); confirm.hidden = true; },
    setBusy(msg) { hint.hidden = false; hint.textContent = msg; root.classList.add('busy'); },
    destroy() {
      if (!alive) return;
      alive = false;
      canvas.width = canvas.height = 0;
      root.remove();
    },
  };
}
