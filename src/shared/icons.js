
// Original inline SVG icons (24x24, stroke based, Lucide-style geometry).
const P = {
  pointer: '<path d="M5 3.5l14 6.2-5.6 1.9-1.9 5.7z"/><path d="M13.8 13.8L19 19"/>',
  card: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M7 9h6M7 13h10M7 16.5h5"/>',
  section: '<rect x="3" y="3" width="18" height="18" rx="2.5"/><path d="M3 9h18M3 15h18"/>',
  text: '<path d="M8.5 4.5h7M12 4.5v15M8.5 19.5h7"/><path d="M4 8v8M20 8v8" opacity=".55"/>',
  settings: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
  keyboard: '<rect x="2" y="5.5" width="20" height="13" rx="2.5"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7.5 14.5h9"/>',
  shield: '<path d="M12 3l7.5 2.8v5.7c0 4.5-3.1 7.9-7.5 9.5-4.4-1.6-7.5-5-7.5-9.5V5.8z"/><path d="M9 12l2.2 2.2L15.5 10"/>',
  copy: '<rect x="8.5" y="8.5" width="12" height="12" rx="2.5"/><path d="M5.5 15.5h-.2A2.3 2.3 0 013 13.2V5.5A2.5 2.5 0 015.5 3h7.7A2.3 2.3 0 0115.5 5.3v.2"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12.2a1.8 1.8 0 001.8 1.8h6.4a1.8 1.8 0 001.8-1.8L18 7M9 7V4.5h6V7"/>',
  check: '<path d="M4.5 12.5l5 5L19.5 7"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5.2l3.2 1.8"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3.2 3.2 3.2 14.8 0 18M12 3c-3.2 3.2-3.2 14.8 0 18"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="1.8"/><path d="M21 16l-5-5-8 8"/>',
  link: '<path d="M10 14a4.5 4.5 0 006.4 0l3-3a4.5 4.5 0 00-6.4-6.4l-1 1"/><path d="M14 10a4.5 4.5 0 00-6.4 0l-3 3a4.5 4.5 0 006.4 6.4l1-1"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  history: '<path d="M3.5 12a8.5 8.5 0 108.5-8.5A8.6 8.6 0 005.7 6.2L3.5 8.5"/><path d="M3.5 4v4.5H8M12 7.5V12l3 1.8"/>',
  up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  file: '<path d="M14 3H7.5A2.5 2.5 0 005 5.5v13A2.5 2.5 0 007.5 21h9a2.5 2.5 0 002.5-2.5V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
  lock: '<rect x="4.5" y="10.5" width="15" height="10" rx="2.5"/><path d="M8 10.5V8a4 4 0 018 0v2.5"/>',
  alert: '<path d="M12 3.5l9.5 16.5h-19z"/><path d="M12 10v4.5M12 17.5h.01"/>',
  textutils: '<path d="M2.8 18.5l4.6-12 4.6 12M4.5 14.2h5.8"/><circle cx="17.4" cy="15.2" r="2.7"/><path d="M20.1 12.3v6.2"/>',
  measure: '<path d="M3.5 16.5L16.5 3.5l4 4-13 13z"/><path d="M7.5 12.5l2 2M10.5 9.5l1.5 1.5M13.5 6.5l2 2"/>',
  seo: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.4 15.4L21 21"/><path d="M8 12.5v-2M10.5 12.5v-4.5M13 12.5v-3"/>',
  authority: '<path d="M3.5 16.5a8.5 8.5 0 0117 0"/><path d="M12 16.5l4.2-5.2"/><circle cx="12" cy="16.5" r="1.6"/><path d="M6.2 11l1.2 1M12 8v1.6M17.8 11l-1.2 1"/><path d="M5 20h14"/>',
  refresh: '<path d="M20 11a8 8 0 00-14.4-4.2L4 8.5"/><path d="M4 4v4.5h4.5M4 13a8 8 0 0014.4 4.2L20 15.5"/><path d="M20 20v-4.5h-4.5"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v4.5a1.5 1.5 0 01-1.5 1.5h-11A1.5 1.5 0 014 18.5v-11A1.5 1.5 0 015.5 6H10"/>',
  palette: '<path d="M12 3a9 9 0 100 18c1.2 0 1.9-.9 1.5-2-.4-1.1.3-2.2 1.5-2.2H17a4 4 0 004-4c0-5-4-9.8-9-9.8z"/><circle cx="7.6" cy="11.4" r="1.1"/><circle cx="10.6" cy="7.2" r="1.1"/><circle cx="15.2" cy="7.6" r="1.1"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
  camera: '<path d="M4 8h3l1.5-2.5h7L17 8h3a1 1 0 011 1v9a1 1 0 01-1 1H4a1 1 0 01-1-1V9a1 1 0 011-1z"/><circle cx="12" cy="13" r="3.5"/>',
  pencil: '<path d="M4 20l1-4.5L16.5 4a2.1 2.1 0 013 3L8 18.5z"/><path d="M14.5 6l3 3"/>',
  arrow: '<path d="M5 19L19 5M9 5h10v10"/>',
  line: '<path d="M5 19L19 5"/>',
  square: '<rect x="4" y="5.5" width="16" height="13" rx="1.5"/>',
  circle: '<ellipse cx="12" cy="12" rx="8.5" ry="6.5"/>',
  highlighter: '<path d="M9.5 17.5l-4 1.5 1.5-4L16 6l3.5 3.5z"/><path d="M13 9l3.5 3.5M4 21h16"/>',
  type: '<path d="M5 6.5V5h14v1.5M12 5v14.5M9 19.5h6"/>',
  number: '<circle cx="12" cy="12" r="8.5"/><path d="M10.2 9.8L12.4 8.4v7.4"/>',
  blur: '<path d="M12 3.5s6 6.2 6 10.3a6 6 0 01-12 0C6 9.7 12 3.5 12 3.5z"/><path d="M9 14a3 3 0 003 3"/>',
  eraser: '<path d="M8.5 19.5H20M5.2 14.8l8.6-8.6a2 2 0 012.8 0l3.2 3.2a2 2 0 010 2.8l-6.4 6.4H9.5z"/><path d="M9 11l5 5"/>',
  undo: '<path d="M9 8h6a4.5 4.5 0 010 9H8M9 8l3-3M9 8l3 3"/>',
  redo: '<path d="M15 8H9a4.5 4.5 0 000 9h7M15 8l-3-3M15 8l-3 3"/>',
  download: '<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19.5h14"/>',
  save: '<path d="M5 4.5h11l3 3v12H5z"/><path d="M8 4.5v5h7v-5M8 19.5v-6h8v6"/>',
  scan: '<path d="M4 9V6a2 2 0 012-2h3M15 4h3a2 2 0 012 2v3M20 15v3a2 2 0 01-2 2h-3M9 20H6a2 2 0 01-2-2v-3"/>',
  crop: '<path d="M6 3v13a2 2 0 002 2h13M3 6h13a2 2 0 012 2v13"/>',
  fullpage: '<rect x="6" y="3.5" width="12" height="17" rx="2"/><path d="M12 8v6M9.5 11.5L12 14l2.5-2.5"/>',
  zoomin: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4M11 8.5v5M8.5 11h5"/>',
  zoomout: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4M8.5 11h5"/>',
  grip: '<circle cx="9" cy="6" r="1.1"/><circle cx="15" cy="6" r="1.1"/><circle cx="9" cy="12" r="1.1"/><circle cx="15" cy="12" r="1.1"/><circle cx="9" cy="18" r="1.1"/><circle cx="15" cy="18" r="1.1"/>',
  bolt: '<path d="M13 2.5L5 13.5h6l-1 8 8-11h-6z"/>',
};

export function icon(name, size = 18, extra = '') {
  return `<svg class="ic ${extra}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${P[name] || ''}</svg>`;
}

/** The LinkLens mark: a tile in the theme colour with the white lens + pointer (public/icons/glyph.png) cut into it. Sized by --lg. */
export const logoMark = (size = 36) => `<span class="logo-mark" style="--lg:${size}px" aria-hidden="true"></span>`;
export const LOGO_SVG = logoMark(36);
export const LOGO_SVG_LG = logoMark(48);
