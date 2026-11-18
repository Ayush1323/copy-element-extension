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
