import {
  tagOf, ancestorsOf, hasLayout, rectOf, viewportSize, textLength, resetCaches,
} from './dom-utils.js';
import { extractBlocks, blockText } from './text-extractor.js';
import { blocksToPlain } from '../clipboard/text-formatter.js';
import { blocksToHtml } from '../clipboard/html-formatter.js';

const SECTION_TAGS = new Set(['SECTION', 'HEADER', 'FOOTER', 'ASIDE', 'NAV', 'ARTICLE']);
const SECTION_HINT = /(^|[\s_-])(section|hero|banner|faq|pricing|testimonials?|features?|services?|portfolio|cta|footer|header|about|contact|clients?|blog|stats|process)([\s_-]|$)/i;
const ROOT_WRAPPERS = new Set(['BODY', 'HTML', 'MAIN']);

function wideEnough(el) {
  if (!hasLayout(el)) return true;
  const r = rectOf(el);
  const vp = viewportSize(el.ownerDocument);
  return r.width >= vp.w * 0.6 && r.height >= 80;
}

function sectionLike(el) {
  const tag = tagOf(el);
  if (SECTION_TAGS.has(tag) || el.getAttribute('role') === 'region') return true;
  const hint = `${el.id || ''} ${typeof el.className === 'string' ? el.className : ''}`;
  return SECTION_HINT.test(hint);
}

/** Ancestors (low → high) that can be a "section", plus the default index. */
export function sectionCandidates(start) {
  resetCaches();
  const chain = ancestorsOf(start).filter((a) => !ROOT_WRAPPERS.has(tagOf(a)) && textLength(a) >= 10);
  if (!chain.length) return { list: [start], index: 0 };
  let idx = chain.findIndex((a) => sectionLike(a) && wideEnough(a) && textLength(a) >= 20);
  if (idx < 0) {
    // top-level child of <main>/<body>-like wrapper chain: the highest ancestor whose parent is a root wrapper
    // (skipping single-child #root/#app wrappers)
    const vp = viewportSize(start.ownerDocument);
    idx = chain.findIndex((a) => {
      const p = a.parentElement;
      if (!p) return false;
      const r = hasLayout(a) ? rectOf(a) : null;
      return ROOT_WRAPPERS.has(tagOf(p)) || (p.children.length > 2 && r && r.width >= vp.w * 0.8 && r.height >= 120 && textLength(a) >= 40);
    });
  }
  if (idx < 0) idx = chain.length - 1;
  return { list: chain, index: idx };
}

export function findSection(start) {
  const { list, index } = sectionCandidates(start);
  return list[index];
}

export function extractSection(el, opts = {}) {
  const blocks = extractBlocks(el, { ...opts, promoteTitle: true });
  const heading = blocks.find((b) => b.type === 'heading');
  const text = blocksToPlain(blocks, opts);
  return {
    kind: 'section',
    title: heading ? heading.text : blockText(blocks[0] || { text: '' }).split('\n')[0] || '',
    blocks,
    text,
    html: blocksToHtml(blocks),
    chars: text.length,
  };
}
