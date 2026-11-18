import {
  tagOf, parentComposed, styleOf, hasLayout, rectOf, viewportSize, textLength, ancestorsOf, isBlockLevel, resetCaches,
} from './dom-utils.js';
import { extractBlocks, blockText } from './text-extractor.js';
import { blocksToPlain } from '../clipboard/text-formatter.js';
import { blocksToHtml } from '../clipboard/html-formatter.js';

const STOP_TAGS = new Set(['BODY', 'HTML', 'MAIN', 'SECTION', 'HEADER', 'FOOTER', 'NAV', 'ASIDE', 'FORM', 'TABLE', 'UL', 'OL', 'TBODY']);
const SEMANTIC_CARD = new Set(['ARTICLE', 'LI', 'A', 'FIGURE']);

function classTokens(el) {
  return typeof el.className === 'string' ? el.className.split(/\s+/).filter(Boolean) : [];
}

function similar(a, b) {
  if (a.localName !== b.localName) return false;
  const ta = classTokens(a);
  const tb = classTokens(b);
  if (!ta.length && !tb.length) return true;
  return ta.some((c) => tb.includes(c));
}

function hasHeading(el) {
  return !!el.querySelector('h1,h2,h3,h4,h5,h6,[role="heading"]');
}

function textBlockCount(el) {
  let n = 0;
  const walker = el.ownerDocument.createTreeWalker(el, 4);
  let prevParent = null;
  for (let t = walker.nextNode(); t; t = walker.nextNode()) {
    if (!t.nodeValue.trim()) continue;
    if (t.parentNode !== prevParent) n++;
    prevParent = t.parentNode;
    if (n >= 3) break;
  }
  return n;
}

function isRichRepeated(a) {
  const p = a.parentElement;
  if (!p) return false;
  if (!(hasHeading(a) || textBlockCount(a) >= 2) || textLength(a) < 40) return false;
  for (const s of p.children) {
    if (s !== a && similar(a, s) && textLength(s) >= 20) return true;
  }
  return false;
}

function isBoxed(el) {
  const cs = styleOf(el);
  const border = ['Top', 'Right', 'Bottom', 'Left'].some((s) => parseFloat(cs['border' + s + 'Width']) > 0 && cs['border' + s + 'Style'] !== 'none');
  const bg = cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent';
  const shadow = cs.boxShadow && cs.boxShadow !== 'none';
  const radius = parseFloat(cs.borderTopLeftRadius) > 0;
  return (border || shadow) || (bg && radius);
}

function fitsCardSize(el) {
  if (!hasLayout(el)) return true;
  const r = rectOf(el);
  const vp = viewportSize(el.ownerDocument);
  return r.width <= vp.w * 0.82 && r.height <= vp.h * 1.05;
}

function tooBig(el) {
  if (!hasLayout(el)) return false;
  const r = rectOf(el);
  const vp = viewportSize(el.ownerDocument);
  return r.height > vp.h * 1.4;
}

/**
 * Card detection from structure — no site-specific selectors.
 * Returns ancestors (low → high) that can be a card, plus the default index.
 */
export function cardCandidates(start) {
  resetCaches();
  const chain = [];
  for (const a of ancestorsOf(start)) {
    if (STOP_TAGS.has(tagOf(a)) && a !== start) break;
    if (a === start && STOP_TAGS.has(tagOf(a))) break;
    chain.push(a);
    if (chain.length > 14) break;
  }
  const usable = chain.filter((a) => isBlockLevel(a) || hasLayout(a)).filter((a) => textLength(a) >= 8 && !tooBig(a));
  if (!usable.length) return { list: [start], index: 0 };

  let idx = -1;
  // 1) repeated-rich ancestor (grid / slider / list item): the largest one that still fits a card
  const firstRep = usable.findIndex(isRichRepeated);
  if (firstRep >= 0) {
    idx = firstRep;
    for (let i = firstRep + 1; i < usable.length; i++) {
      const a = usable[i];
      if (!fitsCardSize(a)) break; // anything larger is a grid / section, not a card
      if (isRichRepeated(a)) idx = i;
    }
    // hug single-child wrappers (e.g. <li><a>…</a></li>) so the whole clickable unit is selected
    while (idx + 1 < usable.length && usable[idx + 1] === usable[idx].parentElement && usable[idx + 1].children.length === 1 && fitsCardSize(usable[idx + 1])) idx++;
  }
  // 2) boxed container with heading/text
  if (idx < 0) {
    idx = usable.findIndex((a) => isBoxed(a) && (hasHeading(a) || textBlockCount(a) >= 2) && textLength(a) >= 20 && fitsCardSize(a));
  }
  // 3) semantic card element
  if (idx < 0) idx = usable.findIndex((a) => SEMANTIC_CARD.has(tagOf(a)) && textLength(a) >= 20 && fitsCardSize(a));
  // 4) lowest ancestor with a heading and some body text
  if (idx < 0) idx = usable.findIndex((a) => hasHeading(a) && textBlockCount(a) >= 2 && textLength(a) >= 40 && fitsCardSize(a));
  // 5) lowest ancestor with at least two text blocks
  if (idx < 0) idx = usable.findIndex((a) => textBlockCount(a) >= 2 && fitsCardSize(a));
  if (idx < 0) idx = Math.min(1, usable.length - 1);
  return { list: usable, index: idx };
}

export function findCard(start) {
  const { list, index } = cardCandidates(start);
  return list[index];
}

export function extractCard(el, opts = {}) {
  const blocks = extractBlocks(el, { ...opts, promoteTitle: true, labelHeadings: true });
  const heading = blocks.find((b) => b.type === 'heading');
  const text = blocksToPlain(blocks, opts);
  return {
    kind: 'card',
    title: heading ? heading.text : blockText(blocks[0] || { text: '' }).split('\n')[0] || '',
    blocks,
    text,
    html: blocksToHtml(blocks),
    chars: text.length,
  };
}

export { parentComposed };
