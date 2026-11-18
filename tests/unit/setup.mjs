import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');

/** Install a jsdom window as the global DOM and return the document. */
export function loadHtml(html) {
  const dom = new JSDOM(html, { pretendToBeVisual: true, url: 'https://example.test/' });
  const w = dom.window;
  Object.assign(globalThis, {
    window: w, document: w.document, getComputedStyle: w.getComputedStyle.bind(w),
    DOMParser: w.DOMParser, Node: w.Node, Element: w.Element, NodeFilter: w.NodeFilter,
  });
  return w.document;
}

export const loadFixture = (name) => loadHtml(readFileSync(join(fixtures, name), 'utf8'));
