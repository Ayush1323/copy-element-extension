import { DEFAULT_THEME } from './themes.js';
export const APP_NAME = 'LinkLens';
export const TAGLINE = 'Hover. Discover. Copy.';
export const HOST_TAG = 'linklens-root';

export const MODES = Object.freeze({
  ELEMENT: 'element',
  CARD: 'card',
  SECTION: 'section',
  TEXT: 'text',
  IMAGES: 'images',
  SCREENSHOT: 'screenshot',
  TEXTUTILS: 'textutils',
  MEASURE: 'measure',
  SEO: 'seo',
});

export const FORMATS = Object.freeze({ PLAIN: 'plain', RICH: 'rich', MARKDOWN: 'markdown' });

export const DEFAULT_SETTINGS = Object.freeze({
  defaultFormat: FORMATS.PLAIN, // 'plain' | 'rich' | 'markdown' (links as [text](url))
  historyEnabled: true,
  toolbarEnabled: true,
  highlightColor: '', // '' = follow the theme; or a custom #RRGGBB
  theme: DEFAULT_THEME, // see src/shared/themes.js
  showLabels: true,
  toastEnabled: true,
  linkPreviewAnySite: false, // previews of sites that forbid embedding (needs the optional all-sites permission)
  linkPreview: true, // small live preview of a hovered link's destination (Element Picker)
  extractionBehavior: 'instant', // card/section: 'instant' | 'preview'
  headingStyle: 'plain', // 'plain' | 'markdown'
  includeButtons: true,
});

export const STORAGE_KEYS = Object.freeze({
  SETTINGS: 'mi_settings',
  HISTORY: 'mi_history',
  LAST: 'mi_last',
  SHOT_PREFS: 'mi_shot_prefs',
  UTILS_POS: 'mi_textutils_pos', // where the Text Utils panel was left (never the text)
  SEO_POS: 'mi_seo_pos', // where the SEO panel was left
  SITE_LIMIT: 'mi_site_limit', // Site Analyzer: chosen page limit
  SITE_INDEX: 'mi_site_index', // Site Analyzer: which sites have a saved report
  SITE_SCAN: 'mi_site_scan:', // + domain: that site's last report and short scan history (this browser only)
});

export const HISTORY_LIMIT = 25;
export const SITE_SCAN_LIMIT = 8; // websites whose last Site Analyzer report is kept
export const HISTORY_ENTRY_MAX_CHARS = 20000;

export const MODE_META = Object.freeze({
  element: { label: 'Element Picker', short: 'Element' },
  card: { label: 'Card Extractor', short: 'Card' },
  section: { label: 'Section Extractor', short: 'Section' },
  text: { label: 'Selected Text', short: 'Selection' },
  images: { label: 'Inspect Images & Text', short: 'Inspect' },
  screenshot: { label: 'Screenshot', short: 'Screenshot' },
  textutils: { label: 'Text Utils', short: 'Text Utils' },
  measure: { label: 'Dimensions', short: 'Dimensions' },
  seo: { label: 'SEO', short: 'SEO' },
});

/** Remembered editor choices for the screenshot feature. */
export const SHOT_DEFAULTS = Object.freeze({
  tool: 'arrow', color: '#EF4444', width: 4, fontSize: 24, textBg: '', blurMode: 'pixelate', blurStrength: 14,
});
