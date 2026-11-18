import { isElement, isOurs, pointInRect, parentComposed, childNodesOf, tagOf, SKIP_TAGS } from './dom-utils.js';

const TOL = 1.5;

function nodeContainsPoint(node, x, y) {
  if (!node || node.nodeType !== 3 || !node.nodeValue.trim()) return false;
  const doc = node.ownerDocument;
  const range = doc.createRange();
  try {
    range.selectNodeContents(node);
    const rects = range.getClientRects();
    for (let i = 0; i < rects.length; i++) if (pointInRect(x, y, rects[i], TOL)) return true;
  } catch (_) { /* detached */ } finally {
    if (range.detach) range.detach();
  }
  return false;
}

function caretNodeAt(x, y, doc) {
  try {
    if (doc.caretPositionFromPoint) {
      const p = doc.caretPositionFromPoint(x, y);
      if (p && p.offsetNode) return p.offsetNode;
    }
  } catch (_) { /* fall through */ }
  try {
    if (doc.caretRangeFromPoint) {
      const r = doc.caretRangeFromPoint(x, y);
      if (r) return r.startContainer;
    }
  } catch (_) { /* fall through */ }
  return null;
}

function textChildrenHit(el, x, y) {
  const walker = el.ownerDocument.createTreeWalker(el, 4 /* SHOW_TEXT */);
  // only direct children: exact owner of the pixel, not an ancestor's descendants
  for (let n = el.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 3 && nodeContainsPoint(n, x, y)) return n;
  }
  void walker;
  return null;
}

/**
 * Find the actual text node under the pointer.
 * 1) caretPositionFromPoint / caretRangeFromPoint (validated against the node's real glyph rects)
 * 2) fallback: scan direct text children of the hit-test stack (handles overlays / stretched links / shadow DOM)
 * @param {Element[]} stack elementsFromPoint result (deepest first)
 */
export function getTextNodeAtPoint(x, y, stack = [], doc = document) {
  const caret = caretNodeAt(x, y, doc);
  if (caret && caret.nodeType === 3 && !isOurs(parentComposed(caret)) && nodeContainsPoint(caret, x, y)) {
    const p = parentComposed(caret);
    if (p && !SKIP_TAGS.has(tagOf(p))) return caret;
  }
  for (const el of stack.slice(0, 12)) {
    if (!isElement(el) || SKIP_TAGS.has(tagOf(el))) continue;
    const hit = textChildrenHit(el, x, y);
    if (hit) return hit;
    if (el.shadowRoot) {
      for (const n of childNodesOf(el)) {
        if (n.nodeType === 3 && nodeContainsPoint(n, x, y)) return n;
      }
    }
  }
  return null;
}
