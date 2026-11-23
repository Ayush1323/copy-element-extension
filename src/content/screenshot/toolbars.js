import { h } from '../ui/shadow-root-ui.js';
import { icon } from '../../shared/icons.js';

export const TOOL_DEFS = [
  ['select', 'pointer', 'Select & move', 'V'],
  ['pencil', 'pencil', 'Pencil', 'P'],
  ['arrow', 'arrow', 'Arrow', 'A'],
  ['line', 'line', 'Line', 'L'],
  ['rect', 'square', 'Rectangle', 'R'],
  ['ellipse', 'circle', 'Ellipse', 'O'],
  ['highlighter', 'highlighter', 'Highlighter', 'H'],
  ['text', 'type', 'Text', 'T'],
  ['number', 'number', 'Numbered step', 'N'],
  ['blur', 'blur', 'Blur / pixelate', 'B'],
  ['eraser', 'eraser', 'Eraser', 'X'],
];
export const COLORS = ['#EF4444', '#F59E0B', '#FACC15', '#22C55E', '#2563EB', '#8B5CF6', '#111827', '#FFFFFF'];
const TEXT_BGS = [['', 'No background'], ['#FFFFFF', 'White'], ['#FEF08A', 'Yellow'], ['#111827', 'Dark']];
const FONT_SIZES = [14, 18, 24, 32, 48];
const STROKE = new Set(['pencil', 'highlighter', 'line', 'arrow', 'rect', 'ellipse']);

const mod = /Mac|iPhone|iPad/.test(navigator.platform || '') ? '⌘' : 'Ctrl';

/**
 * The three floating toolbars (tools / options / actions) of the in-page editor.
 * @param {object} ui shadow ui
 * @param {{workspace: boolean, editor: object, actions: {copy: Function, download: Function, save: Function, close: Function, zoom?: Function}}} o
 */
export function createToolbars(ui, { workspace, editor, actions }) {
  const grip = `<span class="ss-grip" title="Drag to move" aria-hidden="true">${icon('grip', 14)}</span>`;
  const tools = h('div', 'ss-tb ss-tools', `${grip}
    ${TOOL_DEFS.map(([id, ic, label, key]) => `<button class="ss-btn" data-tool="${id}" data-tip="${label} (${key})" aria-label="${label}" aria-pressed="false">${icon(ic, 18)}</button>`).join('')}
    <i class="ss-hsep"></i>
    <button class="ss-btn" data-act="undo" data-tip="Undo (${mod}+Z)" aria-label="Undo">${icon('undo', 18)}</button>
    <button class="ss-btn" data-act="redo" data-tip="Redo (${mod}+Y)" aria-label="Redo">${icon('redo', 18)}</button>`);
  tools.setAttribute('role', 'toolbar'); tools.setAttribute('aria-label', 'Drawing tools'); tools.setAttribute('aria-orientation', 'vertical');

  const options = h('div', 'ss-tb ss-options', `${grip}
    <div class="ss-opt" data-g="color">${COLORS.map((c) => `<button class="ss-sw" data-color="${c}" style="--c:${c}" aria-label="Color ${c}" data-tip="${c}"></button>`).join('')}
      <label class="ss-sw custom" data-tip="Custom color"><input type="color" aria-label="Custom color" value="#EF4444"></label></div>
    <div class="ss-opt" data-g="stroke"><span class="ss-lab">Size</span><input type="range" min="1" max="16" step="1" aria-label="Stroke thickness" data-r="width"><span class="ss-val" data-v="width"></span></div>
    <div class="ss-opt" data-g="font"><span class="ss-lab">Text</span><div class="ss-seg">${FONT_SIZES.map((s) => `<button data-font="${s}" aria-label="Font size ${s}">${s}</button>`).join('')}</div></div>
    <div class="ss-opt" data-g="bg"><span class="ss-lab">Back</span>${TEXT_BGS.map(([c, n]) => `<button class="ss-sw bg ${c ? '' : 'none'}" data-bg="${c}" style="--c:${c || 'transparent'}" aria-label="${n}" data-tip="${n}"></button>`).join('')}</div>
    <div class="ss-opt" data-g="blur"><span class="ss-lab">Mode</span><div class="ss-seg"><button data-blurmode="pixelate">Pixelate</button><button data-blurmode="blur">Blur</button></div>
      <input type="range" min="4" max="40" step="1" aria-label="Blur strength" data-r="blurStrength"></div>
    <i class="ss-sep" data-g="sep"></i>
    <button class="ss-btn sm" data-act="delete" data-tip="Delete selected (Del)" aria-label="Delete selected annotation">${icon('trash', 16)}</button>
    <button class="ss-btn sm txt" data-act="clear" data-tip="Remove all annotations" aria-label="Clear all annotations"><span>Clear all</span></button>`);
  options.setAttribute('role', 'toolbar'); options.setAttribute('aria-label', 'Tool options');

  const zoomBits = workspace
    ? `<div class="ss-zoom"><button class="ss-btn sm" data-act="zoomout" data-tip="Zoom out" aria-label="Zoom out">${icon('zoomout', 16)}</button><button class="ss-zval" data-act="zoomfit" data-tip="Fit to screen" aria-label="Fit to screen">100%</button><button class="ss-btn sm" data-act="zoomin" data-tip="Zoom in" aria-label="Zoom in">${icon('zoomin', 16)}</button></div><i class="ss-sep"></i>`
    : '';
  const acts = h('div', 'ss-tb ss-actions', `${grip}${zoomBits}
    <button class="ss-btn ss-primary wide" data-act="copy" data-tip="Copy to clipboard (${mod}+C)" aria-label="Copy screenshot">${icon('copy', 16)}<span>Copy</span></button>
    <button class="ss-btn wide" data-act="download" data-tip="Download PNG (${mod}+D)" aria-label="Download screenshot">${icon('download', 16)}<span>Download</span></button>
    <button class="ss-btn wide" data-act="share" data-tip="Upload and get a link · anyone with the link can view it" aria-label="Copy shareable link">${icon('link', 16)}<span>Link</span></button>
    <button class="ss-btn wide" data-act="save" data-tip="Save as… (${mod}+S)" aria-label="Save screenshot">${icon('save', 16)}<span>Save</span></button>
    <i class="ss-sep"></i>
    <button class="ss-btn" data-act="close" data-tip="Close (Esc)" aria-label="Close editor">${icon('x', 17)}</button>`);
  acts.setAttribute('role', 'toolbar'); acts.setAttribute('aria-label', 'Screenshot actions');

  const bars = [tools, options, acts];
  bars.forEach((b) => { b.dataset.ss = ''; ui.layer.appendChild(b); });
  const offsets = new Map(bars.map((b) => [b, { x: 0, y: 0 }]));
  const bases = new Map(bars.map((b) => [b, { x: 0, y: 0 }]));

  /* ---------------------------------- events ---------------------------------- */

  const on = (el, ev, fn) => el.addEventListener(ev, fn);
  bars.forEach((b) => on(b, 'mousedown', (e) => { if (!e.target.closest('input')) e.preventDefault(); })); // keep text-box focus / selection
  on(tools, 'click', (e) => {
    const t = e.target.closest('[data-tool]');
    if (t) { editor.setTool(t.dataset.tool); return; }
    const a = e.target.closest('[data-act]');
    if (a) { if (a.dataset.act === 'undo') editor.undo(); else if (a.dataset.act === 'redo') editor.redo(); }
  });
  on(options, 'click', (e) => {
    const c = e.target.closest('[data-color]');
    if (c) return editor.setProps({ color: c.dataset.color });
    const f = e.target.closest('[data-font]');
    if (f) return editor.setProps({ fontSize: Number(f.dataset.font) });
    const bg = e.target.closest('[data-bg]');
    if (bg) return editor.setProps({ textBg: bg.dataset.bg });
    const bm = e.target.closest('[data-blurmode]');
    if (bm) return editor.setProps({ blurMode: bm.dataset.blurmode });
    const a = e.target.closest('[data-act]');
    if (a && a.dataset.act === 'delete') editor.deleteSelected();
    if (a && a.dataset.act === 'clear') editor.clearAll();
  });
  const colorInput = options.querySelector('input[type=color]');
  on(colorInput, 'input', () => editor.setProps({ color: colorInput.value.toUpperCase() }));
  options.querySelectorAll('input[type=range]').forEach((r) => on(r, 'input', () => editor.setProps({ [r.dataset.r]: Number(r.value) })));
  on(acts, 'click', (e) => {
    const a = e.target.closest('[data-act]');
    if (!a) return;
    const fn = { copy: actions.copy, download: actions.download, share: actions.share, save: actions.save, close: actions.close, zoomin: () => actions.zoom('in'), zoomout: () => actions.zoom('out'), zoomfit: () => actions.zoom('fit') }[a.dataset.act];
    if (fn) fn();
  });

  /* --------------------------------- dragging --------------------------------- */

  function applyPos(b) {
    const base = bases.get(b), off = offsets.get(b);
    const vw = document.documentElement.clientWidth || window.innerWidth, vh = window.innerHeight;
    const w = b.offsetWidth, hh = b.offsetHeight;
    const x = Math.min(Math.max(base.x + off.x, 6), Math.max(6, vw - w - 6));
    const y = Math.min(Math.max(base.y + off.y, 6), Math.max(6, vh - hh - 6));
    off.x = x - base.x; off.y = y - base.y;
    b.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }

  bars.forEach((b) => {
    const g = b.querySelector('.ss-grip');
    let st = null;
    on(g, 'pointerdown', (e) => { if (e.button !== 0) return; e.preventDefault(); g.setPointerCapture(e.pointerId); st = { x: e.clientX, y: e.clientY, o: { ...offsets.get(b) } }; b.classList.add('moving'); });
    on(g, 'pointermove', (e) => { if (!st) return; offsets.set(b, { x: st.o.x + e.clientX - st.x, y: st.o.y + e.clientY - st.y }); applyPos(b); });
    const end = () => { st = null; b.classList.remove('moving'); };
    on(g, 'pointerup', end); on(g, 'pointercancel', end);
  });

  /* ---------------------------------- layout ---------------------------------- */

  let lastRect;
  const size = (el) => ({ w: el.offsetWidth, h: el.offsetHeight });

  /** rect: selection area in viewport px (in-place mode) or null (workspace mode). Re-run whenever a bar changes size. */
  function layout(rect) {
    lastRect = rect;
    const vw = document.documentElement.clientWidth || window.innerWidth, vh = window.innerHeight;
    const gap = 10, pad = 6;
    const set = (b, x, y) => { bases.get(b).x = x; bases.get(b).y = y; applyPos(b); };
    // the tool column folds into two columns when the window is too short for one
    tools.classList.remove('two-col');
    let T = size(tools);
    if (T.h > vh - 2 * pad) { tools.classList.add('two-col'); T = size(tools); }
    options.style.maxWidth = `${vw - 2 * pad}px`;
    let A = size(acts), O = size(options);
    if (!rect) { // workspace: tools left, actions top-right, options bottom-centre
      set(tools, 14, Math.max(pad, (vh - T.h) / 2));
      set(acts, vw - A.w - 14, 14);
      set(options, Math.max(pad, (vw - O.w) / 2), vh - O.h - 14);
      tools.dataset.tipSide = 'right';
      return;
    }
    // tools: beside the selection (right, else left, else inside)
    let tx, side;
    if (rect.x + rect.w + gap + T.w <= vw - pad) { tx = rect.x + rect.w + gap; side = 'right'; }
    else if (rect.x - gap - T.w >= pad) { tx = rect.x - gap - T.w; side = 'left'; }
    else { tx = vw - T.w - pad; side = 'inside'; }
    tools.dataset.tipSide = side === 'left' ? 'right' : 'left';
    const ty = Math.min(Math.max(rect.y, pad), Math.max(pad, vh - T.h - pad));
    set(tools, tx, ty);
    // actions + options are stacked below the selection (else above, else inside at the bottom) and never run into the tools
    for (let pass = 0; pass < 2; pass++) {
      const stackH = A.h + O.h + 8;
      let y0;
      if (rect.y + rect.h + gap + stackH <= vh - pad) y0 = rect.y + rect.h + gap;
      else if (rect.y - gap - stackH >= pad) y0 = rect.y - gap - stackH;
      else y0 = Math.max(pad, Math.min(vh - stackH - pad, rect.y + rect.h - stackH - gap));
      const overlapsTools = y0 < ty + T.h + gap && y0 + stackH > ty - gap;
      let lo = pad, hi = vw - pad;
      if (overlapsTools) { if (side === 'left') lo = tx + T.w + gap; else hi = tx - gap; }
      options.style.maxWidth = `${Math.max(260, hi - lo)}px`;
      O = size(options);
      const right = Math.min(Math.max(rect.x + rect.w, lo + A.w), hi);
      set(acts, right - A.w, y0);
      set(options, Math.max(lo, Math.min(right - O.w, hi - O.w)), y0 + A.h + 8);
      if (pass === 0) { A = size(acts); O = size(options); }
    }
  }

  /* ---------------------------------- state ----------------------------------- */

  const q = (sel, root = options) => root.querySelector(sel);
  function update(s) {
    const sel = s.sel;
    const type = s.selectedType || (s.tool === 'select' || s.tool === 'eraser' ? '' : s.tool);
    tools.querySelectorAll('[data-tool]').forEach((b) => { const on_ = b.dataset.tool === s.tool; b.classList.toggle('on', on_); b.setAttribute('aria-pressed', String(on_)); });
    q('[data-act="undo"]', tools).disabled = !s.canUndo;
    q('[data-act="redo"]', tools).disabled = !s.canRedo;
    const color = (sel ? sel.color : s.props.color) || s.props.color;
    const width = sel && sel.width ? sel.width : s.props.width;
    const size = sel && sel.size ? sel.size : s.props.fontSize;
    const bg = sel && sel.type === 'text' ? sel.bg || '' : s.props.textBg || '';
    const strength = sel && sel.strength ? sel.strength : s.props.blurStrength;
    const mode = sel && sel.mode ? sel.mode : s.props.blurMode;
    const show = (g, v) => { const el = q(`[data-g="${g}"]`); if (el) el.hidden = !v; };
    show('color', type && type !== 'blur');
    show('stroke', STROKE.has(type));
    show('font', type === 'text' || type === 'number');
    show('bg', type === 'text');
    show('blur', type === 'blur');
    options.querySelectorAll('.ss-sw[data-color]').forEach((b) => b.classList.toggle('on', b.dataset.color.toLowerCase() === String(color).toLowerCase()));
    const custom = q('.ss-sw.custom'); const known = COLORS.some((c) => c.toLowerCase() === String(color).toLowerCase());
    custom.classList.toggle('on', !known); custom.style.setProperty('--c', known ? 'transparent' : color);
    if (/^#[0-9a-f]{6}$/i.test(color)) colorInput.value = color;
    q('[data-r="width"]').value = String(width); q('[data-v="width"]').textContent = String(width);
    q('[data-r="blurStrength"]').value = String(strength);
    options.querySelectorAll('[data-font]').forEach((b) => b.classList.toggle('on', Number(b.dataset.font) === Number(size)));
    options.querySelectorAll('[data-bg]').forEach((b) => b.classList.toggle('on', b.dataset.bg.toLowerCase() === String(bg).toLowerCase()));
    options.querySelectorAll('[data-blurmode]').forEach((b) => b.classList.toggle('on', b.dataset.blurmode === mode));
    q('[data-act="delete"]').hidden = !s.selectedType;
    q('[data-act="clear"]').disabled = !s.count;
    q('[data-g="sep"]').hidden = false;
    // the options bar changes size with its groups: re-anchor everything
    if (lastRect !== undefined) layout(lastRect);
  }

  function setZoomLabel(z) { const l = acts.querySelector('.ss-zval'); if (l) l.textContent = `${Math.round(z * 100)}%`; }
  function flash(action, cls = 'ok') {
    const b = acts.querySelector(`[data-act="${action}"]`);
    if (!b) return;
    b.classList.add(cls); setTimeout(() => b.classList.remove(cls), 900);
  }
  /** The Link button's Uploading state: spinner + label, disabled so a second click cannot start a second upload. */
  function setUploading(on) {
    const b = acts.querySelector('[data-act="share"]');
    if (!b) return;
    b.classList.toggle('uploading', on);
    b.querySelector('span:not(.ss-spin)').textContent = on ? 'Uploading…' : 'Link';
    const old = b.querySelector('.ss-spin');
    if (on && !old) b.insertBefore(h('span', 'ss-spin dark'), b.firstChild);
    if (!on && old) old.remove();
    b.querySelector('svg')?.toggleAttribute('hidden', on);
  }
  function setBusy(action, busy) { const b = acts.querySelector(`[data-act="${action}"]`); if (b) b.disabled = busy; }

  return {
    tools, options, acts, layout, update, setZoomLabel, flash, setBusy, setUploading,
    destroy() { bars.forEach((b) => b.remove()); },
  };
}
