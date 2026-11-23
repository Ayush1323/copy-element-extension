// Text Utils: the pure text transformations behind the on-page Text Utils panel (no DOM, no extension APIs).
// Every function takes a string and returns a string, so they can be tested on their own.

const SPACE_RUN = /[ \t  -   　]+/g; // spaces and tabs, but never line breaks

export const upperCase = (t) => t.toUpperCase();
export const lowerCase = (t) => t.toLowerCase();

/** First letter of every sentence (start of the text, and after . ! ? … or a line break) becomes a capital; the rest is left alone. */
export function capitalizeFirstLetter(t) {
  return t.replace(/(^|[.!?…]\s+|\n\s*)(["'“‘(\[]*)(\p{Ll})/gu, (_m, lead, quote, ch) => lead + quote + ch.toLocaleUpperCase());
}

/** Every word starts with a capital, the rest of the word is lower case ("hELLO wORLD" → "Hello World"). */
export function capitalizeEachWord(t) {
  return t.toLocaleLowerCase().replace(/\p{L}[\p{L}\p{M}\p{N}'’]*/gu, (w) => w.charAt(0).toLocaleUpperCase() + w.slice(1));
}

/** Runs of spaces/tabs become one space and every line is trimmed. Line breaks are kept, blank lines too. */
export function removeExtraSpaces(t) {
  return t.split(/\r\n|\n|\r/).map((l) => l.replace(SPACE_RUN, ' ').trim()).join('\n').trim();
}

/** Spaces (a run of them counts once) become the given character: "hello   big world" → "hello-big-world". Line breaks are kept. */
export const replaceSpaces = (t, ch) => t.replace(SPACE_RUN, ch);
export const spacesToDash = (t) => replaceSpaces(t, '-');
export const spacesToUnderscore = (t) => replaceSpaces(t, '_');

/**
 * Find & replace. Plain text by default (so "a.b" really means a, dot, b); `regex` switches to a regular expression where
 * $1 / $& work in the replacement. Returns { text, count } or { error }.
 */
export function findReplace(text, find, replacement, { matchCase = false, regex = false } = {}) {
  if (!find) return { error: 'Type the text to find.' };
  let re;
  try {
    re = new RegExp(regex ? find : find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), matchCase ? 'g' : 'gi');
  } catch (_) {
    return { error: 'That is not a valid pattern.' };
  }
  const count = (text.match(re) || []).length;
  // plain mode: a "$" in the replacement is just a dollar sign; regex mode: $1, $& and friends work
  const out = text.replace(re, regex ? replacement : replacement.replace(/\$/g, '$$$$'));
  return { text: out, count };
}

export function textStats(t) {
  const words = (t.match(/\S+/g) || []).length;
  const lines = t === '' ? 0 : t.split(/\r\n|\n|\r/).length;
  return { chars: Array.from(t).length, words, lines };
}

/** The tools shown as buttons, in order. `keys` is the in-panel keyboard shortcut (Alt + key; "Shift" adds Shift). */
export const TOOLS = [
  { id: 'upper', label: 'Upper Case', fn: upperCase, key: 'U', tip: 'Make every letter a capital' },
  { id: 'lower', label: 'Lower Case', fn: lowerCase, key: 'L', tip: 'Make every letter small' },
  { id: 'first', label: 'Capitalize First Letter', fn: capitalizeFirstLetter, key: 'F', tip: 'Capital letter at the start of every sentence' },
  { id: 'words', label: 'Capitalize Each Word', fn: capitalizeEachWord, key: 'W', tip: 'Title Case: every word starts with a capital' },
  { id: 'spaces', label: 'Remove Extra Spaces', fn: removeExtraSpaces, key: 'X', tip: 'Collapse repeated spaces and trim every line' },
  { id: 'dash', label: 'Replace Space With "-"', fn: spacesToDash, key: 'D', tip: 'hello world → hello-world' },
  { id: 'under', label: 'Replace Space With "_"', fn: spacesToUnderscore, key: 'D', shift: true, tip: 'hello world → hello_world' },
];
