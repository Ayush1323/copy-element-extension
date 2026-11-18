// Single source of truth for the LinkLens logo: a chain link seen through a magnifying glass,
// with a pointer and spark accents. Used by the popup / options UI (via icons.js) and by
// scripts/make-icons.mjs to render the PNG icons. Small sizes (<40px) use a simplified glyph.
export const BRAND = Object.freeze({ primary: '#2563EB', secondary: '#4F46E5', dark: '#172554', spark: '#FBBF24' });

export function logoSvg({ size = 32, id = 'll' } = {}) {
  const full = size >= 40;
  const w = full ? 2.5 : 3; // chain stroke
  const link = (cx, cy) => `<rect x="-6" y="-3.1" width="12" height="6.2" rx="3.1" transform="translate(${cx} ${cy}) rotate(-45)" fill="none" stroke="#fff" stroke-width="${w}"/>`;
  const lensR = full ? 6.4 : 6.2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32" aria-hidden="true" focusable="false">` +
    `<defs>` +
    `<linearGradient id="${id}-bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${BRAND.primary}"/><stop offset=".5" stop-color="${BRAND.dark}"/><stop offset="1" stop-color="${BRAND.secondary}"/></linearGradient>` +
    `<radialGradient id="${id}-lens" cx=".35" cy=".3" r=".9"><stop offset="0" stop-color="#3B82F6"/><stop offset="1" stop-color="#1E3A8A"/></radialGradient>` +
    `</defs>` +
    `<rect width="32" height="32" rx="8" fill="url(#${id}-bg)"/>` +
    // chain: two interlocked links
    (full ? link(10.2, 14.2) + link(15.8, 8.6) : link(12.6, 11.4)) +
    // lens (occludes the chain) + handle
    `<line x1="23.6" y1="23.6" x2="27.2" y2="27.2" stroke="#fff" stroke-width="3.2" stroke-linecap="round"/>` +
    `<circle cx="19" cy="19" r="${lensR}" fill="url(#${id}-lens)" stroke="#fff" stroke-width="${full ? 2 : 2.4}"/>` +
    (full
      ? `<rect x="-2.9" y="-1.5" width="5.8" height="3" rx="1.5" transform="translate(19 19) rotate(-45)" fill="none" stroke="#fff" stroke-width="1.1"/>` +
        `<path d="M6.2 20.2l5.6 3.4-2.4.8 1.6 2.6-1.3.8-1.6-2.6-1.7 1.8z" fill="#fff" stroke="${BRAND.dark}" stroke-width=".5" stroke-linejoin="round"/>`
      : '') +
    // sparks
    `<g stroke="${BRAND.spark}" stroke-width="${full ? 1.5 : 1.9}" stroke-linecap="round"><path d="M24.2 3.6l-.5 3"/><path d="M27.6 6.4l-2.4 1.9"/><path d="M28.4 10.4l-3 .4"/></g>` +
    `</svg>`;
}
