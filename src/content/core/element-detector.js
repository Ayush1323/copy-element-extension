import {
  tagOf, isElement, isOurs, parentComposed, elementsStackAt, INLINE_FORMAT_TAGS, shouldSkip, styleOf, resetCaches,
  isBlockLevel, isFlowContainer, textLength, pointInRect,
} from './dom-utils.js';
import { getTextNodeAtPoint } from './text-node-detector.js';

// Controls are selectable on their own; images / video / empty wrappers count as "empty card space".
const CONTROLS = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON']);

function isFragmentInMixedText(el) {
  const p = parentComposed(el);
  if (!p) return false;
  for (const n of p.childNodes) if (n.nodeType === 3 && n.nodeValue.trim()) return true;
  return false;
}

/** Inline emphasis inside a sentence belongs to the sentence; tag-like spans/links stay themselves. */
export function liftInline(el) {
  let cur = el;
  for (let i = 0; i < 6 && cur; i++) {
    const p = parentComposed(cur);
    if (!p || tagOf(p) === 'BODY' || tagOf(p) === 'HTML') break;
    const tag = tagOf(cur);
    if (INLINE_FORMAT_TAGS.has(tag)) { cur = p; continue; }
    if (tag === 'SPAN' && isFragmentInMixedText(cur) && !styleOf(cur).display.startsWith('inline-')) { cur = p; continue; }
    break;
  }
  // <h3><a>Title</a></h3>: the heading is what the designer means, not its inner link/span
  const parent = parentComposed(cur);
  if (parent && /^H[1-6]$/.test(tagOf(parent)) && styleOf(cur).display.startsWith('inline')) {
    const norm = (t) => (t || '').replace(/\s+/g, ' ').trim();
    if (norm(parent.textContent) === norm(cur.textContent)) cur = parent;
  }
  return cur;
}

function findTextBlockAt(x, y, stack) {
  for (const el of stack.slice(0, 10)) {
    const tag = tagOf(el);
    if (tag === 'HTML' || tag === 'BODY' || shouldSkip(el)) continue;
    if (!isFlowContainer(el) || textLength(el) === 0) continue;
    // inline elements (e.g. a stretched-link overlay) only count when the pointer is on their own line boxes
    const rects = isBlockLevel(el) ? [el.getBoundingClientRect()] : Array.from(el.getClientRects());
    if (rects.some((r) => pointInRect(x, y, r, 1))) return el;
  }
  return null;
}

/**
 * What is under the pointer? Prefers the exact text node's element; falls back to controls/media,
 * then the deepest container. Never returns a wrapper anchor when meaningful content sits under the cursor.
 * @returns {{el: Element, textNode: Text|null, kind: 'text'|'leaf'|'container'}|null}
 */
export function detectRaw(x, y, doc = document) {
  resetCaches();
  const stack = elementsStackAt(x, y, doc).filter((e) => isElement(e) && !isOurs(e));
  if (!stack.length) return null;

  const textNode = getTextNodeAtPoint(x, y, stack, doc);
  if (textNode) {
    const parent = parentComposed(textNode);
    if (parent && !shouldSkip(parent)) return { el: liftInline(parent), textNode, kind: 'text' };
  }

  // Pointer is inside a text block's box but not on a glyph (end of a wrapped heading, line gaps, padding).
  const block = findTextBlockAt(x, y, stack);
  if (block) return { el: liftInline(block), textNode: null, kind: 'text' };

  const usable = stack.filter((e) => tagOf(e) !== 'HTML');
  const leaf = usable.slice(0, 4).find((e) => CONTROLS.has(tagOf(e)));
  if (leaf) return { el: leaf, textNode: null, kind: 'leaf' };

  const top = usable.find((e) => tagOf(e) !== 'BODY') || usable[0] || stack[0];
  return { el: top, textNode: null, kind: 'container' };
}

const LABELS = {
  P: 'PARAGRAPH', A: 'LINK', BUTTON: 'BUTTON', UL: 'LIST', OL: 'LIST', LI: 'LIST ITEM', IMG: 'IMAGE',
  SVG: 'GRAPHIC', LABEL: 'LABEL', INPUT: 'INPUT', SPAN: 'TEXT', ARTICLE: 'ARTICLE', SECTION: 'SECTION',
  NAV: 'NAVIGATION', HEADER: 'HEADER', FOOTER: 'FOOTER', FIGURE: 'FIGURE', TABLE: 'TABLE',
  BLOCKQUOTE: 'QUOTE', ASIDE: 'ASIDE', MAIN: 'MAIN', FORM: 'FORM', DT: 'TERM', DD: 'DEFINITION',
  STRONG: 'TEXT', EM: 'TEXT', B: 'TEXT', I: 'TEXT', PRE: 'CODE BLOCK', CODE: 'CODE', SUMMARY: 'SUMMARY',
  TEXTAREA: 'INPUT', SELECT: 'SELECT', FIGCAPTION: 'CAPTION', TD: 'CELL', TH: 'CELL', TR: 'ROW',
};

export function describeElement(el, mode) {
  if (mode === 'card') return 'CARD';
  if (mode === 'section') return 'SECTION';
  const tag = tagOf(el);
  if (/^H[1-6]$/.test(tag)) return `${tag} HEADING`;
  if (el.getAttribute && el.getAttribute('role') === 'heading') return 'HEADING';
  if (el.getAttribute && el.getAttribute('role') === 'button') return 'BUTTON';
  return LABELS[tag] || (tag === 'DIV' ? 'CONTAINER' : tag);
}

/** Short type used in history ("Heading", "Paragraph", "Card"…). */
export function typeName(el, kind) {
  if (kind === 'card') return 'Card';
  if (kind === 'section') return 'Section';
  if (kind === 'selection') return 'Selection';
  const d = describeElement(el, 'element');
  if (/HEADING/.test(d)) return 'Heading';
  return d.charAt(0) + d.slice(1).toLowerCase();
}
