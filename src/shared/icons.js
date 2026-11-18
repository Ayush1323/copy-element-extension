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
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  history: '<path d="M3.5 12a8.5 8.5 0 108.5-8.5A8.6 8.6 0 005.7 6.2L3.5 8.5"/><path d="M3.5 4v4.5H8M12 7.5V12l3 1.8"/>',
  up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  file: '<path d="M14 3H7.5A2.5 2.5 0 005 5.5v13A2.5 2.5 0 007.5 21h9a2.5 2.5 0 002.5-2.5V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
  lock: '<rect x="4.5" y="10.5" width="15" height="10" rx="2.5"/><path d="M8 10.5V8a4 4 0 018 0v2.5"/>',
  alert: '<path d="M12 3.5l9.5 16.5h-19z"/><path d="M12 10v4.5M12 17.5h.01"/>',
  bolt: '<path d="M13 2.5L5 13.5h6l-1 8 8-11h-6z"/>',
};

export function icon(name, size = 18, extra = '') {
  return `<svg class="ic ${extra}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${P[name] || ''}</svg>`;
}

export const LOGO_SVG = `<svg width="28" height="28" viewBox="0 0 32 32" aria-hidden="true"><defs><linearGradient id="mi-g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0B1E3F"/><stop offset="1" stop-color="#2563EB"/></linearGradient></defs><rect width="32" height="32" rx="8" fill="url(#mi-g)"/><rect x="13" y="12.5" width="11" height="11" rx="2.6" fill="#fff"/><path d="M9 19.5V11a2.6 2.6 0 012.6-2.6H19" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width="2" stroke-linecap="round"/></svg>`;
