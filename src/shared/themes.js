// LinkLens themes. Simple on purpose: clean white and light-neutral surfaces, ONE vibrant colour per theme, and an accent.
// Every shade the interface uses is derived from those two colours, so any theme looks consistent. The interface reads colours
// only through CSS variables (--t-primary, --t-soft, ...), so switching a theme just sets those variables: no reload.

export const DEFAULT_THEME = 'indigo';

export const THEMES = Object.freeze([
  { id: 'indigo', name: 'Indigo', mood: 'Modern and friendly', primary: '#4F46E5', accent: '#F59E0B' },
  { id: 'ocean', name: 'Ocean', mood: 'Clear and trustworthy', primary: '#2563EB', accent: '#F97316' },
  { id: 'mint', name: 'Mint', mood: 'Soft, fresh and light', primary: '#2B8562', accent: '#F2A65A' },
  { id: 'emerald', name: 'Emerald', mood: 'Fresh and calm', primary: '#047857', accent: '#F59E0B' },
  { id: 'teal', name: 'Teal', mood: 'Cool and focused', primary: '#0F766E', accent: '#F43F5E' },
  { id: 'violet', name: 'Violet', mood: 'Creative and bold', primary: '#7C3AED', accent: '#06B6D4' },
  { id: 'rose', name: 'Rose', mood: 'Warm and lively', primary: '#E11D48', accent: '#6366F1' },
  { id: 'moss', name: 'Moss', mood: 'Calm and natural', primary: '#637545', accent: '#E07A3F' },
]);

export const themeById = (id) => THEMES.find((t) => t.id === id) || THEMES.find((t) => t.id === DEFAULT_THEME);

/* ------------------------------ colour maths ------------------------------ */

export function hexToRgb(hex) {
  const h = String(hex).replace('#', '');
  const f = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [parseInt(f.slice(0, 2), 16), parseInt(f.slice(2, 4), 16), parseInt(f.slice(4, 6), 16)];
}
export const rgbToHex = ([r, g, b]) => `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
/** `t` is how much of `b` goes into `a`: mix(a, b, 0) = a, mix(a, b, 1) = b. */
export const mix = (a, b, t) => { const x = hexToRgb(a), y = hexToRgb(b); return rgbToHex(x.map((v, i) => v + (y[i] - v) * t)); };

export function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
  }
  return [h, s, l];
}
export function hslToRgb([h, s, l]) {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}
/** The same colour with its hue turned by `deg` degrees (and, optionally, its lightness nudged): neighbours on the colour wheel look related. */
export const hueShift = (hex, deg, dl = 0) => { const [h, s, l] = rgbToHsl(hexToRgb(hex)); return rgbToHex(hslToRgb([h + deg, s, Math.min(0.9, Math.max(0.1, l + dl))])); };

const lum = (hex) => { const [r, g, b] = hexToRgb(hex).map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
export const contrast = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };

/* -------------------------------- the tokens -------------------------------- */

/** Every colour the interface uses, derived from a theme's primary and accent. Values are hex strings. */
export function deriveColors({ primary, accent }) {
  const W = '#FFFFFF', K = '#000000';
  return {
    primary, accent,
    dark: mix(primary, K, 0.42),
    darker: mix(primary, K, 0.58),
    mid: mix(primary, W, 0.22),
    sage: mix(primary, W, 0.55),
    'sage-l': mix(primary, W, 0.78),
    'soft-b': mix(primary, W, 0.82),
    'soft-b2': mix(primary, W, 0.88),
    soft: mix(primary, W, 0.93),
    tile: mix(primary, W, 0.86),
    // surfaces: clean, almost neutral, with just a breath of the theme colour
    cream: mix('#F3F4F9', primary, 0.035),
    bg: mix('#F7F8FC', primary, 0.02),
    bg2: '#FAFBFE',
    bg3: mix('#F1F3F9', primary, 0.03),
    bg4: mix('#ECEEF6', primary, 0.04),
    bg5: '#FCFDFF',
    // text and lines: neutral slate
    ink: mix('#0F172A', primary, 0.05),
    ink2: mix('#111827', primary, 0.08),
    ink3: mix('#1F2937', primary, 0.08),
    text2: '#1F2937',
    text3: '#374151',
    muted: mix('#566075', primary, 0.06),
    line: mix('#E3E6EF', primary, 0.04),
    line2: mix('#D2D7E4', primary, 0.05),
    line3: mix('#E9ECF4', primary, 0.03),
  };
}

/** The header / mode-bar surface: always clean white with dark text, so it never shouts and stays readable on any website. */
export function barTokens(theme, c = deriveColors(theme)) {
  const rgb = (hex) => hexToRgb(hex).join(', ');
  return {
    '--t-bar-bg': '#FFFFFF',
    '--t-bar-fg': c.ink, '--t-bar-fg2': c.muted,
    '--t-bar-chip': `rgba(${rgb(c.primary)}, 0.08)`, '--t-bar-chip-h': `rgba(${rgb(c.primary)}, 0.15)`,
    '--t-bar-on-bg': c.primary, '--t-bar-on-fg': '#FFFFFF',
    '--t-bar-line': c.line, '--t-bar-shadow': `rgba(${rgb(mix(c.ink, c.primary, 0.3))}, 0.3)`,
  };
}

/**
 * Colour for the tools: each card gets its own neighbour of the theme colour on the colour wheel, so the popup is lively and still
 * matches the theme. Returns { g1..g5: gradients, h1..h5: plain colours }.
 */
export function toolColors(primary) {
  const shifts = [0, 32, 64, -32, -64];
  // every tile is a vivid, mid-light colour (even when the theme colour itself is dark), so the cards are always bright and friendly
  const vivid = (hex) => { const [h, sat] = rgbToHsl(hexToRgb(hex)); return rgbToHex(hslToRgb([h, Math.max(sat, 0.68), 0.47])); };
  const hues = shifts.map((d) => vivid(hueShift(primary, d)));
  const grad = (hex) => `linear-gradient(145deg, ${mix(hex, '#FFFFFF', 0.12)} 0%, ${mix(hex, '#000000', 0.18)} 100%)`;
  return { hues, grads: hues.map(grad) };
}

/** CSS custom properties for a theme: { '--t-primary': '#4F46E5', '--t-primary-rgb': '79, 70, 229', ... }. */
export function themeVars(id) {
  const theme = themeById(id);
  const c = deriveColors(theme);
  const out = {};
  for (const [k, v] of Object.entries(c)) out[`--t-${k}`] = v;
  const rgb = (hex) => hexToRgb(hex).join(', ');
  out['--t-primary-rgb'] = rgb(c.primary);
  out['--t-dark-rgb'] = rgb(c.dark);
  out['--t-mid-rgb'] = rgb(c.mid);
  out['--t-sage-rgb'] = rgb(c.sage);
  out['--t-cream-rgb'] = rgb(c.cream);
  out['--t-accent-rgb'] = rgb(c.accent);
  out['--t-ink-rgb'] = rgb(c.ink2);
  out['--t-shadow-rgb'] = rgb(mix(c.ink, c.primary, 0.35));
  Object.assign(out, barTokens(theme, c));
  const tc = toolColors(c.primary);
  tc.grads.forEach((g, i) => { out[`--t-g${i + 1}`] = g; });
  tc.hues.forEach((h, i) => { out[`--t-h${i + 1}`] = mix(h, '#000000', 0.08); out[`--t-h${i + 1}-soft`] = mix(h, '#FFFFFF', 0.9); });
  return out;
}

/** Sets a theme on an element (the popup / settings <html>, or the on-page interface layer). */
export function applyTheme(el, id) {
  for (const [k, v] of Object.entries(themeVars(id))) el.style.setProperty(k, v);
  el.dataset.theme = themeById(id).id;
}

/** The same variables as CSS text, for the stylesheet defaults: `:root { ... }`. */
export const themeCss = (id) => Object.entries(themeVars(id)).map(([k, v]) => `${k}: ${v};`).join(' ');
