import { parentComposed, elementsStackAt, isElement, isOurs, SKIP_TAGS, tagOf } from './dom-utils.js';
import { getTextNodeAtPoint } from './text-node-detector.js';

/* ------------------------------------------------------------------ colour ------------------------------------------------------------------ */

const clamp255 = (n) => Math.min(255, Math.max(0, Math.round(n)));
const hex2 = (n) => clamp255(n).toString(16).padStart(2, '0').toUpperCase();
const trimNum = (n, d = 2) => String(+n.toFixed(d));

let probe = null;
/** Any CSS colour the browser understands (oklch, lab, color(display-p3 …) …) -> sRGB, through a 1×1 canvas. */
function viaCanvas(input) {
  try {
    if (!probe) {
      const c = document.createElement('canvas');
      c.width = c.height = 1;
      probe = c.getContext('2d', { willReadFrequently: true });
    }
    if (!probe) return null;
    probe.clearRect(0, 0, 1, 1);
    probe.fillStyle = '#010203';
    probe.fillStyle = input;
    if (probe.fillStyle === '#010203' && !/^#010203$/i.test(String(input).trim())) return null; // not a colour
    probe.fillRect(0, 0, 1, 1);
    const d = probe.getImageData(0, 0, 1, 1).data;
    return { r: d[0], g: d[1], b: d[2], a: +(d[3] / 255).toFixed(3) };
  } catch (_) { return null; }
}

/** Computed colour string -> { r, g, b, a } (0-255, alpha 0-1), or null. */
export function parseColor(input) {
  if (input == null) return null;
  const s = String(input).trim().toLowerCase();
  if (!s) return null;
  if (s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  let m = s.match(/^rgba?\(\s*([\d.]+)(%?)[\s,]+([\d.]+)(%?)[\s,]+([\d.]+)(%?)(?:\s*[,/]\s*([\d.]+)(%?))?\s*\)$/);
  if (m) {
    const ch = (v, pct) => (pct ? (parseFloat(v) / 100) * 255 : parseFloat(v));
    const a = m[7] === undefined ? 1 : m[8] ? parseFloat(m[7]) / 100 : parseFloat(m[7]);
    return { r: clamp255(ch(m[1], m[2])), g: clamp255(ch(m[3], m[4])), b: clamp255(ch(m[5], m[6])), a: Math.min(1, Math.max(0, a)) };
  }
  m = s.match(/^color\(\s*srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+)(%?))?\s*\)$/);
  if (m) {
    const a = m[4] === undefined ? 1 : m[5] ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return { r: clamp255(parseFloat(m[1]) * 255), g: clamp255(parseFloat(m[2]) * 255), b: clamp255(parseFloat(m[3]) * 255), a: Math.min(1, Math.max(0, a)) };
  }
  m = s.match(/^#([0-9a-f]{3,8})$/);
  if (m && [3, 4, 6, 8].includes(m[1].length)) {
    let h = m[1];
    if (h.length <= 4) h = h.split('').map((c) => c + c).join('');
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: h.length === 8 ? +(parseInt(h.slice(6, 8), 16) / 255).toFixed(3) : 1 };
  }
  return viaCanvas(s);
}

export function toHex(c) {
  return `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}${c.a < 1 ? hex2(c.a * 255) : ''}`;
}

export function toRgb(c) {
  const [r, g, b] = [c.r, c.g, c.b].map(clamp255);
  return c.a < 1 ? `rgba(${r}, ${g}, ${b}, ${trimNum(c.a, 3)})` : `rgb(${r}, ${g}, ${b})`;
}

export function toHsl(c) {
  const r = c.r / 255, g = c.g / 255, b = c.b / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  const H = Math.round(h), S = Math.round(s * 100), L = Math.round(l * 100);
  return c.a < 1 ? `hsla(${H}, ${S}%, ${L}%, ${trimNum(c.a, 3)})` : `hsl(${H}, ${S}%, ${L}%)`;
}

/** `fg` painted over an opaque `bg`. */
export function compositeOver(fg, bg) {
  const a = fg.a;
  return { r: fg.r * a + bg.r * (1 - a), g: fg.g * a + bg.g * (1 - a), b: fg.b * a + bg.b * (1 - a), a: 1 };
}

function luminance(c) {
  const f = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}

/** WCAG 2 contrast ratio between two opaque colours (1 to 21). */
export function contrastRatio(a, b) {
  const l1 = luminance(a), l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/** WCAG level reached by `ratio` for text of this size / weight. */
export function contrastLevel(ratio, sizePx, weight) {
  const large = sizePx >= 24 || (sizePx >= 18.66 && weight >= 700);
  if (ratio >= (large ? 4.5 : 7)) return 'AAA';
  if (ratio >= (large ? 3 : 4.5)) return 'AA';
  return 'Fail';
}

/* ----------------------------------------------------------------- typography ----------------------------------------------------------------- */

const WEIGHT_NAMES = { 100: 'Thin', 200: 'Extra Light', 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'Semi Bold', 700: 'Bold', 800: 'Extra Bold', 900: 'Black' };
export const weightName = (w) => WEIGHT_NAMES[w] || '';

/** `"Helvetica Neue", Arial, sans-serif` -> ['Helvetica Neue', 'Arial', 'sans-serif'] */
export function parseFamilies(stack) {
  const out = [];
  let cur = '', quote = '';
  for (const ch of String(stack || '')) {
    if (quote) { if (ch === quote) quote = ''; else cur += ch; continue; }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === ',') { if (cur.trim()) out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const px = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };

/* ---- gradients ---- */

/** `linear-gradient(a, b), url(x)` -> ['linear-gradient(a, b)', 'url(x)'] (commas inside brackets do not split). */
export function splitLayers(value) {
  const out = [];
  let depth = 0, cur = '';
  for (const ch of String(value || '')) {
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const GRADIENT = /^(repeating-)?(linear|radial|conic)-gradient\(/i;
const COLOR_TOKEN = /rgba?\([^)]*\)|hsla?\([^)]*\)|(?:oklch|oklab|lab|lch|hwb|color)\([^)]*\)|#[0-9a-f]{3,8}\b/gi;

/** The gradient layers of a computed `background-image`, as one CSS value, or ''. */
export function gradientOf(backgroundImage) {
  return splitLayers(backgroundImage).filter((l) => GRADIENT.test(l)).join(', ');
}

/** Distinct colours used by a gradient, in order (at most 6), each as { css, color, hex }. */
export function gradientStops(css) {
  const seen = new Set();
  const out = [];
  for (const m of String(css || '').matchAll(COLOR_TOKEN)) {
    const color = parseColor(m[0]);
    if (!color) continue;
    const hex = toHex(color);
    if (seen.has(hex)) continue;
    seen.add(hex);
    out.push({ css: m[0], color, hex });
    if (out.length >= 6) break;
  }
  return out;
}

const describeGradient = (css) => (css ? { css, stops: gradientStops(css) } : null);

const fmtPx = (n) => `${trimNum(n, 2)}px`;

/**
 * The colour a reader actually sees behind the text: nearby translucent layers are blended down to the first opaque
 * one (white page canvas if none). If an image or gradient sits in between, the colour is not a single value: `image`.
 */
export function effectiveBackground(el) {
  const layers = [];
  let image = false;
  let gradient = null;
  let opaque = false;
  for (let n = el, i = 0; n && isElement(n) && i < 60; n = parentComposed(n), i++) {
    let cs;
    try { cs = getComputedStyle(n); } catch (_) { break; }
    // an element that clips its own gradient to its glyphs (gradient text) is not the background BEHIND its text
    if (n === el && /text/.test(`${cs.webkitBackgroundClip} ${cs.backgroundClip}`)) continue;
    // images and gradients paint over the background colour of the same element: look at them first
    if (cs.backgroundImage && cs.backgroundImage !== 'none') { image = true; gradient = describeGradient(gradientOf(cs.backgroundImage)); break; }
    const c = parseColor(cs.backgroundColor);
    if (c && c.a > 0) { layers.push(c); if (c.a >= 1) { opaque = true; break; } }
  }
  if (image) return { color: null, image: true, gradient };
  let base = opaque ? layers.pop() : { r: 255, g: 255, b: 255, a: 1 };
  for (let i = layers.length - 1; i >= 0; i--) base = compositeOver(layers[i], base);
  return { color: base, image: false };
}

/** Everything the inspector shows about the text in `el`, straight from the computed style. */
export function readTextInfo(el, textNode) {
  const cs = getComputedStyle(el);
  const size = px(cs.fontSize) || 16;
  const rootSize = px(getComputedStyle(document.documentElement).fontSize) || 16;
  const weight = Math.round(px(cs.fontWeight) || 400);
  const families = parseFamilies(cs.fontFamily);
  const lhNum = cs.lineHeight === 'normal' ? null : px(cs.lineHeight);
  const ls = cs.letterSpacing === 'normal' ? null : px(cs.letterSpacing);

  let color = parseColor(cs.color);
  // gradient text: the glyphs show the element's own gradient (background-clip: text) through a transparent fill
  const fill = parseColor(cs.webkitTextFillColor);
  const clipped = /text/.test(`${cs.webkitBackgroundClip} ${cs.backgroundClip}`);
  const textGradient = clipped ? describeGradient(gradientOf(cs.backgroundImage)) : null;
  const transparentFill = (!!fill && fill.a === 0) || (!!color && color.a === 0);
  const gradientText = !!textGradient && transparentFill;
  if (fill && !gradientText) color = fill;
  const bg = effectiveBackground(el);

  let contrast = null;
  if (color && color.a > 0 && bg.color) {
    const shown = color.a < 1 ? compositeOver(color, bg.color) : color;
    const ratio = contrastRatio(shown, bg.color);
    contrast = { ratio, text: `${trimNum(ratio, 2)} : 1`, level: contrastLevel(ratio, size, weight) };
  }

  const decoration = (cs.textDecorationLine || '').replace(/\bnone\b/, '').trim();
  return {
    tag: tagOf(el).toLowerCase(),
    sample: textNode ? String(textNode.nodeValue || '').replace(/\s+/g, ' ').trim() : '',
    stack: cs.fontFamily,
    families,
    family: families[0] || '',
    size,
    sizeText: fmtPx(size),
    sizeRem: rootSize ? `${trimNum(size / rootSize, 3)}rem` : '',
    weight,
    weightName: weightName(weight),
    style: cs.fontStyle || 'normal',
    lineHeightPx: lhNum,
    lineHeightText: lhNum == null ? 'normal' : fmtPx(lhNum),
    lineHeightRatio: lhNum == null ? '' : trimNum(lhNum / size, 2),
    letterSpacing: ls,
    letterSpacingText: ls == null || ls === 0 ? 'normal' : fmtPx(ls),
    color,
    gradientText,
    textGradient: gradientText ? textGradient : null,
    bg,
    contrast,
    align: cs.textAlign === 'start' ? 'left' : cs.textAlign === 'end' ? 'right' : cs.textAlign,
    decoration,
    transform: cs.textTransform && cs.textTransform !== 'none' ? cs.textTransform : '',
  };
}

/** Changes whenever anything the panel shows would change (so unchanged hovers do not re-render). */
export function textInfoSignature(i) {
  return [i.tag, i.sample, i.stack, i.sizeText, i.weight, i.style, i.lineHeightText, i.letterSpacingText, i.color && toHex(i.color),
    i.gradientText ? i.textGradient.css : '', i.bg.image ? `img${i.bg.gradient ? i.bg.gradient.css : ''}` : i.bg.color && toHex(i.bg.color), i.align, i.decoration, i.transform].join('|');
}

/** The typography as copy-paste CSS. */
export function cssBlock(i) {
  const lines = [
    `font-family: ${i.stack};`,
    `font-size: ${i.sizeText};`,
    `font-weight: ${i.weight};`,
    `font-style: ${i.style};`,
    `line-height: ${i.lineHeightPx == null ? 'normal' : i.lineHeightText};`,
    `letter-spacing: ${i.letterSpacing == null ? 'normal' : i.letterSpacingText};`,
  ];
  if (i.gradientText) lines.push(`background-image: ${i.textGradient.css};`, '-webkit-background-clip: text;', 'background-clip: text;', '-webkit-text-fill-color: transparent;');
  else if (i.color) lines.push(`color: ${toHex(i.color)};`);
  if (i.transform) lines.push(`text-transform: ${i.transform};`);
  if (i.decoration) lines.push(`text-decoration: ${i.decoration};`);
  return lines.join('\n');
}

/* ------------------------------------------------------------------ hit test ------------------------------------------------------------------ */

/** The text (and the element that owns it) exactly under a viewport point, or null. Uses the real glyph boxes. */
export function textTargetAt(x, y) {
  let stack;
  try { stack = elementsStackAt(x, y); } catch (_) { return null; }
  if (!stack.length) return null;
  const node = getTextNodeAtPoint(x, y, stack);
  if (!node) return null;
  const el = parentComposed(node);
  if (!el || !isElement(el) || isOurs(el) || SKIP_TAGS.has(tagOf(el))) return null;
  return { el, node };
}

/** Box of the text node's glyph line under the point (what the panel attaches to), falling back to the whole run. */
export function textRectAt(node, x, y) {
  const range = node.ownerDocument.createRange();
  try {
    range.selectNodeContents(node);
    const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.height > 0);
    const line = rects.find((r) => x >= r.left - 1.5 && x <= r.right + 1.5 && y >= r.top - 1.5 && y <= r.bottom + 1.5);
    const all = range.getBoundingClientRect();
    return { line: line || rects[0] || all, all };
  } catch (_) {
    return null;
  } finally { if (range.detach) range.detach(); }
}
