export const APP_NAME = 'LinkLens';
export const TAGLINE = 'Hover. Discover. Copy.';
export const HOST_TAG = 'linklens-root';

export const MODES = Object.freeze({
  ELEMENT: 'element',
  CARD: 'card',
  SECTION: 'section',
  TEXT: 'text',
});

export const FORMATS = Object.freeze({ PLAIN: 'plain', RICH: 'rich' });

export const DEFAULT_SETTINGS = Object.freeze({
  defaultFormat: FORMATS.PLAIN, // 'plain' | 'rich'
  historyEnabled: true,
  toolbarEnabled: true,
  highlightColor: '#2563EB',
  showLabels: true,
  toastEnabled: true,
  extractionBehavior: 'instant', // card/section: 'instant' | 'preview'
  headingStyle: 'plain', // 'plain' | 'markdown'
  includeButtons: true,
});

export const STORAGE_KEYS = Object.freeze({
  SETTINGS: 'mi_settings',
  HISTORY: 'mi_history',
  LAST: 'mi_last',
});

export const HISTORY_LIMIT = 25;
export const HISTORY_ENTRY_MAX_CHARS = 20000;

export const MODE_META = Object.freeze({
  element: { label: 'Element Picker', short: 'Element' },
  card: { label: 'Card Extractor', short: 'Card' },
  section: { label: 'Section Extractor', short: 'Section' },
  text: { label: 'Selected Text', short: 'Selection' },
});
