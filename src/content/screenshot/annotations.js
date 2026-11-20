// Annotation model for the screenshot editor: plain data objects in image-space CSS pixels, plus pure geometry
// (hit-testing, bounds, handles, resizing) and canvas drawing. Nothing here touches the page.

export const TOOLS = ['select', 'pencil', 'arrow', 'line', 'rect', 'ellipse', 'highlighter', 'text', 'number', 'blur', 'eraser'];

let seq = 1;
export const newId = () => `a${seq++}`;

const FONT = '"Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
let measureCtx = null;
function mctx() {
  if (measureCtx === undefined) return null;
  if (!measureCtx) {
    try { measureCtx = document.createElement('canvas').getContext('2d'); } catch (_) { measureCtx = undefined; }
    if (!measureCtx) { measureCtx = undefined; return null; }
  }
  return measureCtx;
}

export const clone = (v) => (typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v)));

/* ------------------------------ text metrics ------------------------------ */

export const LINE_H = 1.3;
export const TEXT_PAD = 6;

export function textLayout(a) {
  const lines = String(a.text || '').split('\n');
  const c = mctx();
  let w = 0;
  if (c) {
    c.font = `500 ${a.size}px ${FONT}`;
    for (const l of lines) w = Math.max(w, c.measureText(l || ' ').width);
  } else {
    for (const l of lines) w = Math.max(w, (l.length || 1) * a.size * 0.56); // headless fallback (unit tests)
  }
  const pad = a.bg ? TEXT_PAD : 2;
  return { lines, w: w + pad * 2, h: lines.length * a.size * LINE_H + pad * 2, pad };
}

export const numberRadius = (a) => Math.max(11, a.size * 0.85);

/* --------------------------------- bounds --------------------------------- */

export function rectOf(a) {
  const x = Math.min(a.x, a.x + a.w), y = Math.min(a.y, a.y + a.h);
  return { x, y, w: Math.abs(a.w), h: Math.abs(a.h) };
}

export function bounds(a) {
  switch (a.type) {
    case 'pencil':
    case 'highlighter': {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const [x, y] of a.points) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
      const r = strokeWidth(a) / 2;
      return { x: x0 - r, y: y0 - r, w: x1 - x0 + 2 * r, h: y1 - y0 + 2 * r };
    }
    case 'line':
    case 'arrow': {
      const r = a.width / 2 + (a.type === 'arrow' ? a.width * 2 : 0);
      const x = Math.min(a.x1, a.x2) - r, y = Math.min(a.y1, a.y2) - r;
      return { x, y, w: Math.abs(a.x2 - a.x1) + 2 * r, h: Math.abs(a.y2 - a.y1) + 2 * r };
    }
    case 'rect':
    case 'ellipse': {
      const r = rectOf(a), p = a.width / 2;
      return { x: r.x - p, y: r.y - p, w: r.w + a.width, h: r.h + a.width };
    }
    case 'blur': return rectOf(a);
    case 'text': { const t = textLayout(a); return { x: a.x, y: a.y, w: t.w, h: t.h }; }
    case 'number': { const r = numberRadius(a); return { x: a.x - r, y: a.y - r, w: 2 * r, h: 2 * r }; }
    default: return { x: 0, y: 0, w: 0, h: 0 };
  }
}

export const strokeWidth = (a) => (a.type === 'highlighter' ? Math.max(14, a.width * 3.2) : a.width);

/* -------------------------------- hit testing ------------------------------- */

function distSeg(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - x1) * dx + (py - y1) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

const inRect = (b, x, y, pad = 0) => x >= b.x - pad && x <= b.x + b.w + pad && y >= b.y - pad && y <= b.y + b.h + pad;

export function hitTest(a, x, y, tol = 4) {
  switch (a.type) {
    case 'pencil':
    case 'highlighter': {
      const r = strokeWidth(a) / 2 + tol;
      const pts = a.points;
      if (pts.length === 1) return Math.hypot(x - pts[0][0], y - pts[0][1]) <= r;
      for (let i = 1; i < pts.length; i++) if (distSeg(x, y, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]) <= r) return true;
      return false;
    }
    case 'line':
    case 'arrow': return distSeg(x, y, a.x1, a.y1, a.x2, a.y2) <= a.width / 2 + tol + 1;
    case 'rect': {
      const r = rectOf(a), t = a.width / 2 + tol;
      if (!inRect(r, x, y, t)) return false;
      return !inRect({ x: r.x + t, y: r.y + t, w: Math.max(0, r.w - 2 * t), h: Math.max(0, r.h - 2 * t) }, x, y) || r.w <= 2 * t || r.h <= 2 * t;
    }
    case 'ellipse': {
      const r = rectOf(a);
      const rx = r.w / 2, ry = r.h / 2;
      if (rx < 1 || ry < 1) return inRect(r, x, y, tol);
      const dx = (x - (r.x + rx)) / rx, dy = (y - (r.y + ry)) / ry;
      const d = Math.hypot(dx, dy); // 1 on the outline
      const t = (a.width / 2 + tol) / Math.min(rx, ry);
      return Math.abs(d - 1) <= t;
    }
    case 'blur': return inRect(rectOf(a), x, y);
    case 'text':
    case 'number': return inRect(bounds(a), x, y, tol);
    default: return false;
  }
}

/** Topmost annotation under the point (later = on top). */
export function pick(list, x, y, tol) {
  for (let i = list.length - 1; i >= 0; i--) if (hitTest(list[i], x, y, tol)) return list[i];
  return null;
}

/* ---------------------------- handles & transforms --------------------------- */

const RECT_LIKE = new Set(['rect', 'ellipse', 'blur']);
export const isRectLike = (a) => RECT_LIKE.has(a.type);

export function getHandles(a) {
  if (isRectLike(a)) {
    const r = rectOf(a);
    const xs = { w: r.x, c: r.x + r.w / 2, e: r.x + r.w };
    const ys = { n: r.y, c: r.y + r.h / 2, s: r.y + r.h };
    return [
      ['nw', xs.w, ys.n], ['n', xs.c, ys.n], ['ne', xs.e, ys.n], ['e', xs.e, ys.c],
      ['se', xs.e, ys.s], ['s', xs.c, ys.s], ['sw', xs.w, ys.s], ['w', xs.w, ys.c],
    ].map(([id, x, y]) => ({ id, x, y }));
  }
  if (a.type === 'line' || a.type === 'arrow') return [{ id: 'p1', x: a.x1, y: a.y1 }, { id: 'p2', x: a.x2, y: a.y2 }];
  return [];
}

export const HANDLE_CURSOR = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', p1: 'crosshair', p2: 'crosshair' };

export function handleAt(a, x, y, radius) {
  for (const h of getHandles(a)) if (Math.hypot(h.x - x, h.y - y) <= radius) return h.id;
  return null;
}

export function translate(a, dx, dy) {
  switch (a.type) {
    case 'pencil': case 'highlighter': a.points = a.points.map(([x, y]) => [x + dx, y + dy]); break;
    case 'line': case 'arrow': a.x1 += dx; a.y1 += dy; a.x2 += dx; a.y2 += dy; break;
    default: a.x += dx; a.y += dy;
  }
  return a;
}

/** Resize `a` in place by dragging `handle` to (x, y); `orig` is the annotation as it was when the drag began. */
export function applyHandle(a, handle, x, y, orig, shift = false) {
  if (a.type === 'line' || a.type === 'arrow') {
    const ax = handle === 'p1' ? orig.x2 : orig.x1, ay = handle === 'p1' ? orig.y2 : orig.y1;
    let nx = x, ny = y;
    if (shift) ({ x: nx, y: ny } = snap45(ax, ay, x, y));
    if (handle === 'p1') { a.x1 = nx; a.y1 = ny; } else { a.x2 = nx; a.y2 = ny; }
    return a;
  }
  const o = rectOf(orig);
  let l = o.x, r = o.x + o.w, t = o.y, b = o.y + o.h;
  if (handle.includes('w')) l = x;
  if (handle.includes('e')) r = x;
  if (handle.includes('n')) t = y;
  if (handle.includes('s')) b = y;
  if (shift && handle.length === 2 && o.w > 0 && o.h > 0) {
    const ratio = o.w / o.h;
    const w = Math.abs(r - l), h = Math.abs(b - t);
    if (w / (h || 1) > ratio) { const nh = w / ratio; if (handle.includes('n')) t = b - Math.sign(b - t || 1) * nh; else b = t + Math.sign(b - t || 1) * nh; }
    else { const nw = h * ratio; if (handle.includes('w')) l = r - Math.sign(r - l || 1) * nw; else r = l + Math.sign(r - l || 1) * nw; }
  }
  a.x = l; a.y = t; a.w = r - l; a.h = b - t;
  return a;
}

/** Constrain (x, y) so the segment from (ax, ay) is horizontal, vertical or 45°. */
export function snap45(ax, ay, x, y) {
  const dx = x - ax, dy = y - ay;
  const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
  const len = Math.hypot(dx, dy);
  return { x: ax + Math.cos(ang) * len, y: ay + Math.sin(ang) * len };
}

export const nextNumber = (list) => list.reduce((m, a) => (a.type === 'number' ? Math.max(m, a.n) : m), 0) + 1;

/* ---------------------------------- drawing --------------------------------- */

function smoothPath(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  if (pts.length === 1) { ctx.lineTo(pts[0][0] + 0.01, pts[0][1]); return; }
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
    ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
  }
  const last = pts[pts.length - 1];
  ctx.lineTo(last[0], last[1]);
}

function drawArrow(ctx, a) {
  const ang = Math.atan2(a.y2 - a.y1, a.x2 - a.x1);
  const head = Math.max(10, a.width * 4.2);
  const spread = Math.PI / 7.5;
  // shorten the shaft so the round cap does not poke through the head
  const sx = a.x2 - Math.cos(ang) * head * 0.6, sy = a.y2 - Math.sin(ang) * head * 0.6;
  ctx.beginPath(); ctx.moveTo(a.x1, a.y1); ctx.lineTo(sx, sy); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(a.x2, a.y2);
  ctx.lineTo(a.x2 - head * Math.cos(ang - spread), a.y2 - head * Math.sin(ang - spread));
  ctx.lineTo(a.x2 - head * Math.cos(ang + spread), a.y2 - head * Math.sin(ang + spread));
  ctx.closePath(); ctx.fill();
}

/** Pixelate or blur a region of the ORIGINAL screenshot (never of other annotations). */
function drawBlur(ctx, a, env) {
  const r = rectOf(a);
  if (r.w < 1 || r.h < 1 || !env.base) return;
  const kx = env.base.width / env.cssW, ky = env.base.height / env.cssH;
  ctx.save();
  ctx.beginPath(); ctx.rect(r.x, r.y, r.w, r.h); ctx.clip();
  if (a.mode === 'blur') {
    ctx.filter = `blur(${Math.max(2, a.strength)}px)`;
    const m = a.strength * 2; // sample beyond the edge so the blur does not fade out at the border
    ctx.drawImage(env.base, (r.x - m) * kx, (r.y - m) * ky, (r.w + 2 * m) * kx, (r.h + 2 * m) * ky, r.x - m, r.y - m, r.w + 2 * m, r.h + 2 * m);
    ctx.filter = 'none';
  } else {
    const b = Math.max(3, a.strength);
    const tw = Math.max(1, Math.ceil(r.w / b)), th = Math.max(1, Math.ceil(r.h / b));
    const tmp = env.scratch(tw, th);
    const tctx = tmp.getContext('2d');
    tctx.imageSmoothingEnabled = true;
    tctx.clearRect(0, 0, tw, th);
    tctx.drawImage(env.base, r.x * kx, r.y * ky, r.w * kx, r.h * ky, 0, 0, tw, th);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tmp, 0, 0, tw, th, r.x, r.y, tw * b, th * b);
    ctx.imageSmoothingEnabled = true;
  }
  ctx.restore();
}

/**
 * Draw one annotation. ctx is already scaled so 1 unit = 1 image CSS px.
 * env: { base: HTMLCanvasElement, cssW, cssH, scratch(w,h) -> canvas, skipId?: string }
 */
export function drawAnnotation(ctx, a, env) {
  if (env.skipId && a.id === env.skipId) return;
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = a.color; ctx.fillStyle = a.color;
  switch (a.type) {
    case 'pencil':
      ctx.lineWidth = a.width; smoothPath(ctx, a.points); ctx.stroke(); break;
    case 'highlighter':
      ctx.globalAlpha = 0.38; ctx.lineCap = 'butt'; ctx.lineJoin = 'round';
      ctx.lineWidth = strokeWidth(a); smoothPath(ctx, a.points); ctx.stroke(); break;
    case 'line':
      ctx.lineWidth = a.width; ctx.beginPath(); ctx.moveTo(a.x1, a.y1); ctx.lineTo(a.x2, a.y2); ctx.stroke(); break;
    case 'arrow':
      ctx.lineWidth = a.width; drawArrow(ctx, a); break;
    case 'rect': {
      const r = rectOf(a); ctx.lineWidth = a.width; ctx.lineJoin = 'miter'; ctx.strokeRect(r.x, r.y, r.w, r.h); break;
    }
    case 'ellipse': {
      const r = rectOf(a); ctx.lineWidth = a.width;
      ctx.beginPath(); ctx.ellipse(r.x + r.w / 2, r.y + r.h / 2, Math.max(0.5, r.w / 2), Math.max(0.5, r.h / 2), 0, 0, Math.PI * 2); ctx.stroke(); break;
    }
    case 'blur': drawBlur(ctx, a, env); break;
    case 'text': {
      const t = textLayout(a);
      if (a.bg) {
        ctx.fillStyle = a.bg; const rr = 5; const w = t.w, h = t.h;
        ctx.beginPath(); ctx.moveTo(a.x + rr, a.y); ctx.arcTo(a.x + w, a.y, a.x + w, a.y + h, rr); ctx.arcTo(a.x + w, a.y + h, a.x, a.y + h, rr);
        ctx.arcTo(a.x, a.y + h, a.x, a.y, rr); ctx.arcTo(a.x, a.y, a.x + w, a.y, rr); ctx.closePath(); ctx.fill();
      }
      ctx.fillStyle = a.color; ctx.font = `500 ${a.size}px ${FONT}`; ctx.textBaseline = 'top';
      t.lines.forEach((l, i) => ctx.fillText(l, a.x + t.pad, a.y + t.pad + i * a.size * LINE_H + (a.size * LINE_H - a.size) / 2));
      break;
    }
    case 'number': {
      const r = numberRadius(a);
      ctx.beginPath(); ctx.arc(a.x, a.y, r, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.font = `700 ${Math.round(r * 1.1)}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(a.n), a.x, a.y + r * 0.06);
      break;
    }
    default: break;
  }
  ctx.restore();
}
