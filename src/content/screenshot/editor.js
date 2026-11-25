import {
  TOOLS, newId, clone, drawAnnotation, pick, bounds, getHandles, handleAt, applyHandle, translate, snap45,
  nextNumber, textLayout, HANDLE_CURSOR, LINE_H,
} from './annotations.js';

const HISTORY_LIMIT = 120;
const SHORTCUTS = { v: 'select', p: 'pencil', a: 'arrow', l: 'line', r: 'rect', o: 'ellipse', h: 'highlighter', t: 'text', n: 'number', b: 'blur', x: 'eraser' };
const STROKE_TOOLS = new Set(['pencil', 'highlighter', 'line', 'arrow', 'rect', 'ellipse']);
const CURSORS = { select: 'default', text: 'text', eraser: 'crosshair' };

/**
 * Layered canvas editor: [base screenshot canvas] + [annotation canvas] + [UI overlay canvas].
 * The base canvas keeps every captured pixel; the annotation layer is only as big as what is on screen (so a 40 000 px page
 * costs no second full-size canvas) and export draws the annotations once more, straight onto a full-resolution copy.
 * Annotations live in image CSS pixels, so zooming/resizing never moves them; the screenshot itself is never modified.
 *
 * @param {{base: HTMLCanvasElement, cssW: number, cssH: number, prefs: object, onChange: Function}} o
 */
export function createEditor({ base, cssW, cssH, prefs, onChange }) {
  const dpr = () => window.devicePixelRatio || 1;
  const stage = document.createElement('div');
  stage.className = 'ss-stage';
  base.className = 'ss-layer ss-base';
  const annot = document.createElement('canvas');
  annot.className = 'ss-layer ss-annot';
  const over = document.createElement('canvas');
  over.className = 'ss-layer ss-over';
  over.tabIndex = -1;
  stage.append(base, annot, over);
  const actx = annot.getContext('2d');
  const octx = over.getContext('2d');
  const MAX_LAYER = 8192; // canvas side limit for the on-screen annotation / overlay layers

  let tool = TOOLS.includes(prefs.tool) ? prefs.tool : 'arrow';
  const props = {
    color: prefs.color, width: prefs.width, fontSize: prefs.fontSize, textBg: prefs.textBg || '', blurMode: prefs.blurMode, blurStrength: prefs.blurStrength,
  };
  let annotations = [];
  let selectedId = null;
  let history = [clone(annotations)];
  let hIndex = 0;
  let zoom = 1;
  let draft = null;
  let drag = null; // { kind: 'draw'|'move'|'resize'|'erase', ... }
  let hover = null; // { id, handle }
  let editing = null; // { id, isNew, orig, ta }
  let rafId = 0;
  let destroyed = false;

  const scratchCanvas = document.createElement('canvas');
  const env = {
    base, cssW, cssH,
    scratch(w, h) { if (scratchCanvas.width !== w || scratchCanvas.height !== h) { scratchCanvas.width = w; scratchCanvas.height = h; } return scratchCanvas; },
    skipId: null,
  };

  const selected = () => annotations.find((a) => a.id === selectedId) || null;

  function emit() {
    stage.dataset.tool = tool;
    stage.dataset.count = String(annotations.length);
    stage.dataset.undo = String(hIndex > 0);
    stage.dataset.redo = String(hIndex < history.length - 1);
    stage.dataset.selected = selectedId ? (selected() || {}).type || '' : '';
    if (onChange) onChange(api.state());
  }

  /* ------------------------------- rendering ------------------------------- */

  function render() {
    rafId = 0;
    if (destroyed) return;
    env.skipId = editing ? editing.id : null;
    sizeLayers();
    actx.setTransform(1, 0, 0, 1, 0, 0);
    actx.clearRect(0, 0, annot.width, annot.height);
    actx.setTransform(annot.width / cssW, 0, 0, annot.height / cssH, 0, 0);
    for (const a of annotations) drawAnnotation(actx, a, env);
    if (draft) drawAnnotation(actx, draft, env);
    renderOverlay();
  }
  const schedule = () => { if (!rafId && !destroyed) rafId = requestAnimationFrame(render); };

  /** Annotation + UI layers match what is displayed (zoom x device pixel ratio), so they stay crisp at any zoom. */
  function sizeLayers() {
    const k = Math.min(zoom * dpr(), MAX_LAYER / Math.max(cssW, cssH));
    const w = Math.max(1, Math.round(cssW * k)), h = Math.max(1, Math.round(cssH * k));
    for (const c of [annot, over]) if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  }

  function renderOverlay() {
    const k = over.width / cssW;
    octx.setTransform(1, 0, 0, 1, 0, 0);
    octx.clearRect(0, 0, over.width, over.height);
    octx.setTransform(k, 0, 0, k, 0, 0);
    const u = 1 / zoom; // one screen CSS px in image units
    const accent = getComputedStyle(stage).getPropertyValue('--accent').trim() || '#637545';
    const outline = (a, color, dash = true) => {
      const b = bounds(a);
      octx.save();
      octx.strokeStyle = color; octx.lineWidth = 1.5 * u;
      if (dash) octx.setLineDash([5 * u, 3 * u]);
      octx.strokeRect(b.x - 2 * u, b.y - 2 * u, b.w + 4 * u, b.h + 4 * u);
      octx.restore();
    };
    const sel = selected();
    if (sel && tool === 'select' && !(editing && editing.id === sel.id)) {
      outline(sel, accent);
      for (const hnd of getHandles(sel)) {
        const s = 8 * u;
        octx.fillStyle = '#fff'; octx.strokeStyle = accent; octx.lineWidth = 1.5 * u;
        octx.beginPath(); octx.rect(hnd.x - s / 2, hnd.y - s / 2, s, s); octx.fill(); octx.stroke();
      }
    }
    if (hover && hover.id && hover.id !== selectedId) {
      const a = annotations.find((x) => x.id === hover.id);
      if (a) outline(a, tool === 'eraser' ? '#EF4444' : 'rgba(37,99,235,.55)', tool === 'eraser');
    }
  }

  /* ------------------------------- history -------------------------------- */

  function pushHistory() {
    history = history.slice(0, hIndex + 1);
    history.push(clone(annotations));
    if (history.length > HISTORY_LIMIT) history.shift();
    hIndex = history.length - 1;
  }

  function restore(i) {
    commitText();
    hIndex = i;
    annotations = clone(history[hIndex]);
    if (selectedId && !selected()) selectedId = null;
    emit(); schedule();
  }

  /* --------------------------------- coords -------------------------------- */

  function toImage(e) {
    const r = over.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * cssW) / (r.width || 1), y: ((e.clientY - r.top) * cssH) / (r.height || 1) };
  }
  const clampPt = (p) => ({ x: Math.min(Math.max(p.x, 0), cssW), y: Math.min(Math.max(p.y, 0), cssH) });

  /* ------------------------------ text editing ----------------------------- */

  function placeTextarea() {
    if (!editing) return;
    const a = annotations.find((x) => x.id === editing.id);
    if (!a) return;
    const t = textLayout({ ...a, text: editing.ta.value || ' ' });
    const s = editing.ta.style;
    s.left = `${a.x * zoom}px`; s.top = `${a.y * zoom}px`;
    s.font = `500 ${a.size * zoom}px "Inter", ui-sans-serif, system-ui, sans-serif`;
    s.lineHeight = String(LINE_H);
    s.color = a.color;
    s.padding = `${t.pad * zoom}px`;
    s.background = a.bg || 'rgba(255,255,255,.0)';
    s.width = `${Math.max(t.w + a.size, 60) * zoom}px`;
    s.height = `${Math.max(t.h, a.size * LINE_H + t.pad * 2) * zoom}px`;
  }

  function startText(a, isNew) {
    commitText();
    editing = { id: a.id, isNew, orig: a.text, ta: document.createElement('textarea') };
    const ta = editing.ta;
    ta.className = 'ss-textarea';
    ta.value = a.text || '';
    ta.spellcheck = false;
    ta.rows = 1;
    ta.setAttribute('aria-label', 'Annotation text');
    ta.addEventListener('input', () => { a.text = ta.value; placeTextarea(); });
    ta.addEventListener('blur', () => { if (editing && editing.ta === ta) commitText(); });
    stage.appendChild(ta);
    placeTextarea();
    selectedId = a.id;
    schedule();
    requestAnimationFrame(() => { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); });
    emit();
  }

  /** Finish the text box that is being edited. cancel=true restores the previous text (or removes a new empty box). */
  function commitText(cancel = false) {
    if (!editing) return;
    const { id, isNew, orig, ta } = editing;
    editing = null;
    const a = annotations.find((x) => x.id === id);
    ta.remove();
    if (!a) { schedule(); return; }
    if (cancel) a.text = orig;
    const empty = !String(a.text || '').trim();
    if (empty) {
      annotations = annotations.filter((x) => x.id !== id);
      if (selectedId === id) selectedId = null;
      if (!isNew && !cancel) pushHistory();
    } else if (isNew || a.text !== orig) pushHistory();
    emit(); schedule();
  }

  /* ------------------------------ pointer input ---------------------------- */

  function styleFor(type) {
    const base_ = { id: newId(), type, color: props.color };
    if (STROKE_TOOLS.has(type)) base_.width = props.width;
    return base_;
  }

  function startDraw(p) {
    const t = tool;
    if (t === 'pencil' || t === 'highlighter') draft = { ...styleFor(t), points: [[p.x, p.y]] };
    else if (t === 'line' || t === 'arrow') draft = { ...styleFor(t), x1: p.x, y1: p.y, x2: p.x, y2: p.y };
    else if (t === 'rect' || t === 'ellipse') draft = { ...styleFor(t), x: p.x, y: p.y, w: 0, h: 0 };
    else if (t === 'blur') draft = { id: newId(), type: 'blur', x: p.x, y: p.y, w: 0, h: 0, mode: props.blurMode, strength: props.blurStrength };
    drag = { kind: 'draw', start: p };
  }

  function updateDraw(p, shift) {
    if (!draft) return;
    const s = drag.start;
    if (draft.type === 'pencil' || draft.type === 'highlighter') {
      const last = draft.points[draft.points.length - 1];
      if (Math.hypot(p.x - last[0], p.y - last[1]) >= 0.6) draft.points.push([p.x, p.y]);
    } else if (draft.type === 'line' || draft.type === 'arrow') {
      const q = shift ? snap45(s.x, s.y, p.x, p.y) : p;
      draft.x2 = q.x; draft.y2 = q.y;
    } else {
      let w = p.x - s.x, h = p.y - s.y;
      if (shift && draft.type !== 'blur') { const m = Math.max(Math.abs(w), Math.abs(h)); w = Math.sign(w || 1) * m; h = Math.sign(h || 1) * m; }
      draft.w = w; draft.h = h;
    }
  }

  function finishDraw() {
    const d = draft;
    draft = null;
    if (!d) return;
    let keep = true;
    if (d.type === 'line' || d.type === 'arrow') keep = Math.hypot(d.x2 - d.x1, d.y2 - d.y1) >= 3;
    else if (d.type === 'blur') keep = Math.abs(d.w) >= 4 && Math.abs(d.h) >= 4;
    else if (d.type === 'rect' || d.type === 'ellipse') keep = Math.max(Math.abs(d.w), Math.abs(d.h)) >= 4;
    if (d.type === 'pencil' || d.type === 'highlighter') { if (d.points.length === 1) d.points.push([d.points[0][0] + 0.01, d.points[0][1]]); }
    if (keep) { annotations.push(d); pushHistory(); }
    emit();
  }

  function onDown(e) {
    if (e.button !== 0 || destroyed) return;
    e.preventDefault();
    over.focus({ preventScroll: true });
    commitText();
    const p = toImage(e);
    over.setPointerCapture(e.pointerId);
    const u = 1 / zoom;
    if (tool === 'select') {
      const sel = selected();
      const hnd = sel ? handleAt(sel, p.x, p.y, 8 * u) : null;
      if (sel && hnd) { drag = { kind: 'resize', handle: hnd, orig: clone(sel), moved: false }; return; }
      const hit = pick(annotations, p.x, p.y, 5 * u);
      selectedId = hit ? hit.id : null;
      if (hit) drag = { kind: 'move', last: p, moved: false };
      emit(); schedule();
      return;
    }
    if (tool === 'eraser') {
      drag = { kind: 'erase', erased: false };
      eraseAt(p);
      return;
    }
    if (tool === 'text') {
      const hit = pick(annotations, p.x, p.y, 5 * u);
      if (hit && hit.type === 'text') { startText(hit, false); return; }
      const a = { id: newId(), type: 'text', x: p.x, y: p.y, text: '', color: props.color, size: props.fontSize, bg: props.textBg || '' };
      annotations.push(a);
      startText(a, true);
      return;
    }
    if (tool === 'number') {
      annotations.push({ id: newId(), type: 'number', x: p.x, y: p.y, n: nextNumber(annotations), color: props.color, size: props.fontSize });
      pushHistory(); emit(); schedule();
      return;
    }
    selectedId = null;
    startDraw(clampPt(p));
    emit(); schedule();
  }

  function eraseAt(p) {
    const hit = pick(annotations, p.x, p.y, 5 / zoom);
    if (hit) { annotations = annotations.filter((a) => a.id !== hit.id); if (selectedId === hit.id) selectedId = null; drag.erased = true; emit(); }
    hover = null;
    schedule();
  }

  function onMove(e) {
    if (destroyed) return;
    const p = toImage(e);
    const u = 1 / zoom;
    if (!drag) {
      // hover feedback
      let id = null, cur = CURSORS[tool] || 'crosshair';
      if (tool === 'select') {
        const sel = selected();
        const hnd = sel ? handleAt(sel, p.x, p.y, 8 * u) : null;
        if (hnd) cur = HANDLE_CURSOR[hnd];
        else { const h = pick(annotations, p.x, p.y, 5 * u); id = h ? h.id : null; if (h) cur = 'move'; }
      } else if (tool === 'eraser') { const h = pick(annotations, p.x, p.y, 5 * u); id = h ? h.id : null; }
      if (over.style.cursor !== cur) over.style.cursor = cur;
      const prev = hover && hover.id;
      hover = id ? { id } : null;
      if (prev !== id) schedule();
      return;
    }
    if (drag.kind === 'draw') { updateDraw(clampPt(p), e.shiftKey); schedule(); }
    else if (drag.kind === 'move') {
      const sel = selected();
      if (sel) { translate(sel, p.x - drag.last.x, p.y - drag.last.y); drag.last = p; drag.moved = true; schedule(); }
    } else if (drag.kind === 'resize') {
      const sel = selected();
      if (sel) { applyHandle(sel, drag.handle, clampPt(p).x, clampPt(p).y, drag.orig, e.shiftKey); drag.moved = true; schedule(); }
    } else if (drag.kind === 'erase') eraseAt(p);
  }

  function onUp(e) {
    if (!drag) return;
    const d = drag;
    drag = null;
    try { over.releasePointerCapture(e.pointerId); } catch (_) { /* already released */ }
    if (d.kind === 'draw') finishDraw();
    else if ((d.kind === 'move' || d.kind === 'resize') && d.moved) { pushHistory(); emit(); }
    else if (d.kind === 'erase' && d.erased) { pushHistory(); emit(); }
    schedule();
  }

  function onDouble(e) {
    if (tool !== 'select') return;
    const p = toImage(e);
    const hit = pick(annotations, p.x, p.y, 5 / zoom);
    if (hit && hit.type === 'text') { selectedId = hit.id; startText(hit, false); }
  }

  over.addEventListener('pointerdown', onDown);
  over.addEventListener('pointermove', onMove);
  over.addEventListener('pointerup', onUp);
  over.addEventListener('pointercancel', onUp);
  over.addEventListener('dblclick', onDouble);
  over.addEventListener('pointerleave', () => { if (!drag && hover) { hover = null; schedule(); } });
  over.addEventListener('contextmenu', (e) => e.preventDefault());

  /* ---------------------------------- API ---------------------------------- */

  function applyToSelected(fn) {
    const sel = selected();
    if (!sel) return;
    fn(sel);
    pushHistory();
  }

  const api = {
    el: stage,
    base,
    annot,
    cssW,
    cssH,
    state() {
      const sel = selected();
      return {
        tool, props: { ...props }, canUndo: hIndex > 0, canRedo: hIndex < history.length - 1, count: annotations.length,
        selectedType: sel ? sel.type : '', zoom, editing: !!editing,
        selProps: sel ? { type: sel.type, color: sel.color, width: sel.width, size: sel.size, bg: sel.bg, mode: sel.mode, strength: sel.strength } : null,
      };
    },
    setTool(t) {
      if (!TOOLS.includes(t)) return;
      commitText();
      tool = t;
      if (t !== 'select') selectedId = null;
      hover = null;
      over.style.cursor = CURSORS[t] || 'crosshair';
      emit(); schedule();
    },
    /** patch: color | width | fontSize | textBg | blurMode | blurStrength. Applies to the selected annotation too. */
    setProps(patch) {
      Object.assign(props, patch);
      const sel = selected();
      if (sel) {
        if ('color' in patch) sel.color = patch.color;
        if ('width' in patch && 'width' in sel) sel.width = patch.width;
        if ('fontSize' in patch && (sel.type === 'text' || sel.type === 'number')) sel.size = patch.fontSize;
        if ('textBg' in patch && sel.type === 'text') sel.bg = patch.textBg || '';
        if ('blurMode' in patch && sel.type === 'blur') sel.mode = patch.blurMode;
        if ('blurStrength' in patch && sel.type === 'blur') sel.strength = patch.blurStrength;
        pushHistory();
        placeTextarea();
      }
      emit(); schedule();
    },
    undo() { if (hIndex > 0) restore(hIndex - 1); },
    redo() { if (hIndex < history.length - 1) restore(hIndex + 1); },
    clearAll() {
      commitText();
      if (!annotations.length) return;
      annotations = []; selectedId = null; pushHistory(); emit(); schedule();
    },
    deleteSelected() {
      commitText();
      const sel = selected();
      if (!sel) return;
      annotations = annotations.filter((a) => a.id !== sel.id);
      selectedId = null; pushHistory(); emit(); schedule();
    },
    setZoom(z) {
      zoom = Math.min(Math.max(z, 0.05), 8);
      // At 100% every canvas pixel lands on exactly one device pixel (crisp even at 125% / 150% display scaling)
      const nw = base.width / dpr(), nh = base.height / dpr();
      const natW = Math.abs(nw - cssW) <= 1.5 ? nw : cssW, natH = Math.abs(nh - cssH) <= 1.5 ? nh : cssH;
      stage.style.width = `${natW * zoom}px`;
      stage.style.height = `${natH * zoom}px`;
      placeTextarea(); emit(); schedule();
    },
    isEditingText: () => !!editing,
    /** Screenshot + annotations at the screenshot's full native resolution (the untouched base itself when nothing was drawn). */
    exportCanvas() {
      commitText();
      if (!annotations.length) return base;
      const out = document.createElement('canvas');
      out.width = base.width; out.height = base.height;
      const c = out.getContext('2d');
      c.drawImage(base, 0, 0);
      c.setTransform(out.width / cssW, 0, 0, out.height / cssH, 0, 0);
      const saved = env.skipId;
      env.skipId = null;
      for (const a of annotations) drawAnnotation(c, a, env);
      env.skipId = saved;
      return out;
    },
    /** Keyboard handling for the editor. Returns true when the key was consumed. */
    handleKey(e) {
      const mod = e.ctrlKey || e.metaKey;
      if (editing) {
        if (e.key === 'Escape') { e.preventDefault(); commitText(true); return true; }
        if (e.key === 'Enter' && mod) { e.preventDefault(); commitText(); return true; }
        return 'typing'; // let the textarea receive it
      }
      const k = e.key.toLowerCase();
      if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) api.redo(); else api.undo(); return true; }
      if (mod && k === 'y') { e.preventDefault(); api.redo(); return true; }
      if (k === 'delete' || k === 'backspace') { if (selected()) { e.preventDefault(); api.deleteSelected(); return true; } return false; }
      if (e.key === 'Escape' && selectedId) { selectedId = null; emit(); schedule(); return true; }
      if (!mod && !e.altKey && SHORTCUTS[k] && e.key.length === 1) { e.preventDefault(); api.setTool(SHORTCUTS[k]); return true; }
      return false;
    },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(rafId);
      if (editing) { editing.ta.remove(); editing = null; }
      over.replaceWith(); annot.width = annot.height = 0; over.width = over.height = 0;
      scratchCanvas.width = scratchCanvas.height = 0;
      stage.remove();
    },
  };
  api.setZoom(1);
  emit(); schedule();
  return api;
}
