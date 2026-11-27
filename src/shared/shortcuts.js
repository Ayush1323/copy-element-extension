// Every LinkLens keyboard shortcut, in one place. The popup, the on-page mode bar, the settings page, the background worker
// (Chrome commands) and the page key handler all read this table, so they can never disagree.
//
//  * Chrome lets an extension suggest at most FOUR default global shortcuts (`suggested: true`). The other tools still have a
//    command, so any key can be assigned at chrome://extensions/shortcuts, and they all have an in-page key that works as soon
//    as any LinkLens tool is on (press Alt+E, then Alt+U, Alt+O, ... to jump between tools).
//  * `code` is KeyboardEvent.code (layout independent, and not changed by Alt on a Mac).
import { MODES } from './constants.js';

export const TOOLS = Object.freeze([
  { mode: MODES.ELEMENT, command: 'activate-element-picker', label: 'Text Picker', keys: ['Alt', 'E'], code: 'KeyE', suggested: true },
  { mode: MODES.TEXTUTILS, command: 'activate-text-utils', label: 'Text Utils', keys: ['Alt', 'U'], code: 'KeyU' },
  { mode: MODES.SCREENSHOT, command: 'capture-screenshot', label: 'Screenshot', keys: ['Alt', 'Shift', 'S'], code: 'KeyS', shift: true, suggested: true },
  { mode: MODES.SEO, command: 'activate-seo', label: 'SEO Analyzer', keys: ['Alt', 'O'], code: 'KeyO' },
  { mode: MODES.AUTHORITY, command: 'activate-authority', label: 'Domain Authority', keys: ['Alt', 'A'], code: 'KeyA' },
  { mode: MODES.IMAGES, command: 'activate-images', label: 'Inspect Images & Text', keys: ['Alt', 'I'], code: 'KeyI' },
  { mode: MODES.MEASURE, command: 'activate-measure', label: 'Dimensions', keys: ['Alt', 'M'], code: 'KeyM' },
  { mode: MODES.CARD, command: 'activate-card-extractor', label: 'Card Extractor', keys: ['Alt', 'K'], code: 'KeyK' },
  { mode: MODES.SECTION, command: 'activate-section-picker', label: 'Section Extractor', keys: ['Alt', 'S'], code: 'KeyS', suggested: true },
  { mode: MODES.TEXT, command: 'activate-selected-text', label: 'Selected Text', keys: ['Alt', 'T'], code: 'KeyT' },
]);

/** Shortcuts that work while a tool is on (shown next to the tools in Settings). */
export const EXTRA = Object.freeze([
  { label: 'Copy the hovered element, image or colour', keys: ['Alt', 'C'], command: 'copy-hovered', suggested: true },
  { label: 'Select parent / child element', keys: ['Alt', '↑'], keys2: ['Alt', '↓'] },
  { label: 'Exit the current tool', keys: ['Esc'] },
  { label: 'SEO: previous / next tab', keys: ['['], keys2: [']'] },
  { label: 'SEO: search the list · refresh', keys: ['/'], keys2: ['R'] },
]);

export const toolByMode = (mode) => TOOLS.find((t) => t.mode === mode) || null;
export const toolByCommand = (command) => TOOLS.find((t) => t.command === command) || null;
export const shortcutOf = (mode) => { const t = toolByMode(mode); return t ? t.keys.join('+') : ''; };
/** The tool whose shortcut this keydown is (Alt + letter, with or without Shift as defined), or null. */
export function toolForEvent(e) {
  if (!e.altKey || e.ctrlKey || e.metaKey) return null;
  return TOOLS.find((t) => t.code === e.code && !!t.shift === !!e.shiftKey) || null;
}
