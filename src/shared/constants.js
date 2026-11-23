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
});

export const FORMATS = Object.freeze({ PLAIN: 'plain', RICH: 'rich', MARKDOWN: 'markdown' });

export const DEFAULT_SETTINGS = Object.freeze({
  defaultFormat: FORMATS.PLAIN, // 'plain' | 'rich' | 'markdown' (links as [text](url))
  historyEnabled: true,
  toolbarEnabled: true,
  highlightColor: '#2563EB',
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
});

export const HISTORY_LIMIT = 25;
export const HISTORY_ENTRY_MAX_CHARS = 20000;

export const MODE_META = Object.freeze({
  element: { label: 'Element Picker', short: 'Element' },
  card: { label: 'Card Extractor', short: 'Card' },
  section: { label: 'Section Extractor', short: 'Section' },
  text: { label: 'Selected Text', short: 'Selection' },
  images: { label: 'Inspect Images & Text', short: 'Inspect' },
  screenshot: { label: 'Screenshot', short: 'Screenshot' },
});

/** Remembered editor choices for the screenshot feature. */
export const SHOT_DEFAULTS = Object.freeze({
  tool: 'arrow', color: '#EF4444', width: 4, fontSize: 24, textBg: '', blurMode: 'pixelate', blurStrength: 14,
});
