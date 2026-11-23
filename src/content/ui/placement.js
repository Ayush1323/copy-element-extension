import { clamp } from '../../shared/helpers.js';

export const TOOLBAR_W = 292;

/** Pure placement: keeps the toolbar fully inside the viewport and flush against the target. */
export function placeToolbar(rect, w, hgt, vw, vh) {
  const pad = 6;
  const r = {
    left: Math.max(rect.left, 0), top: Math.max(rect.top, 0),
    right: Math.min(rect.right, vw), bottom: Math.min(rect.bottom, vh),
  };
  const left = clamp(r.left, pad, Math.max(pad, vw - w - pad));
  if (r.top - hgt >= pad) return { left, top: r.top - hgt, side: 'above' };
  if (r.bottom + hgt <= vh - pad) return { left, top: r.bottom, side: 'below' };
  return { left, top: clamp(r.top + 8, pad, Math.max(pad, vh - hgt - pad)), side: 'inside' };
}

export const LINK_PANEL_W = 320;

/**
 * Link info panel: flush below the link (so the pointer can travel into it), else above it
 * (clearing the toolbar handle), else inside the viewport. Always fully visible.
 */
export function placeLinkPanel(rect, w, hgt, vw, vh, topClear = 28) {
  const pad = 6;
  const left = clamp(rect.left, pad, Math.max(pad, vw - w - pad));
  if (rect.bottom + hgt <= vh - pad) return { left, top: Math.max(rect.bottom, pad), side: 'below' };
  if (rect.top - topClear - hgt >= pad) return { left, top: rect.top - topClear - hgt, side: 'above' };
  return { left, top: clamp(vh - hgt - pad, pad, Math.max(pad, vh - hgt - pad)), side: 'inside' };
}

/**
 * Where an INTERACTIVE hover panel goes so that it always touches its anchor (or is bridged to it by `gap`) and never
 * sits under the pointer: below, above, beside, and only as a last resort docked to the far side of the screen.
 * Returns { left, top, edge, gap }: `edge` is the side that faces the anchor (the CSS bridges the gap there).
 */
export function placeBeside(r, pointer, w, hgt, vw, vh, topClear = 28, sideFirst = false) {
  const pad = 6;
  const cl = (v, lo, hi) => Math.min(Math.max(v, lo), Math.max(lo, hi));
  // strictly inside: the pointer legitimately touches the panel's edge when travelling from the anchor into it
  const hit = (p) => pointer && pointer.x > p.left && pointer.x < p.left + w && pointer.y > p.top && pointer.y < p.top + hgt;
  const left0 = cl(r.left, pad, vw - w - pad);
  const sideTop = cl(r.top - 6, pad, vh - hgt - pad);
  const below = r.bottom + hgt <= vh - pad ? { left: left0, top: r.bottom, edge: 'top', gap: 8 } : null;
  const above = r.top - topClear - hgt >= pad ? { left: left0, top: r.top - topClear - hgt, edge: 'bottom', gap: topClear } : null;
  const right = r.right + 4 + w <= vw - pad ? { left: r.right + 4, top: sideTop, edge: 'left', gap: 8 } : null;
  const left = r.left - 4 - w >= pad ? { left: r.left - 4 - w, top: sideTop, edge: 'right', gap: 8 } : null;
  // sideFirst: for running text, a panel below or above would hide the very lines the reader wants to point at next
  const cands = (sideFirst ? [right, left, below, above] : [below, above, right, left]).filter(Boolean);
  const pos = cands.find((c) => !hit(c));
  if (pos) return pos;
  // nowhere adjacent: far side of the screen from the pointer (reachable: the pointer keeps hovering the anchor meanwhile)
  const onLeft = pointer ? pointer.x > vw / 2 : true;
  return { left: onLeft ? pad : Math.max(pad, vw - w - pad), top: cl(pointer && pointer.y > vh / 2 ? pad : vh - hgt - pad, pad, vh - hgt - pad), edge: 'none', gap: 0 };
}
