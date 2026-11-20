import { extractBlocks } from './text-extractor.js';
import { extractCard } from './card-extractor.js';
import { extractSection } from './section-extractor.js';
import { typeName } from './element-detector.js';
import { blocksToPlain } from '../clipboard/text-formatter.js';
import { blocksToHtml } from '../clipboard/html-formatter.js';
import { sanitizeHtml } from '../clipboard/html-sanitizer.js';
import { htmlToMarkdown, wrapBlocksInLink } from '../clipboard/markdown-formatter.js';
import { safeUrl } from '../clipboard/html-sanitizer.js';
import { findLink } from './link-info.js';
import { writeClipboard } from '../clipboard/clipboard-manager.js';
import { addHistory, setLast } from '../../shared/storage.js';
import { domainOf } from '../../shared/helpers.js';

/**
 * Build a copy payload for an element.
 * kind: 'text' (exact text, always plain) | 'element' | 'card' | 'section'
 */
/** Absolute, safe (http/https/mailto/tel) destination of the link the element sits in, or ''. */
function enclosingLinkHref(el) {
  const a = findLink(el);
  if (!a) return '';
  try { return safeUrl(new URL(a.getAttribute('href'), a.baseURI || document.baseURI).href); } catch (_) { return ''; }
}

export function buildPayload(kind, el, settings) {
  const opts = { headingStyle: settings.headingStyle, includeButtons: settings.includeButtons };
  if (kind === 'card') {
    const c = extractCard(el, opts);
    return { ...c, type: 'Card', multi: true, markdown: htmlToMarkdown(c.html) };
  }
  if (kind === 'section') {
    const s = extractSection(el, opts);
    return { ...s, type: 'Section', multi: true, markdown: htmlToMarkdown(s.html) };
  }
  const blocks = extractBlocks(el, opts);
  if (kind === 'text') {
    const text = blocksToPlain(blocks, { headingStyle: 'plain' });
    const href = enclosingLinkHref(el);
    const mdHtml = href ? wrapBlocksInLink(blocksToHtml(blocks), href) : blocksToHtml(blocks);
    return { kind, type: typeName(el, 'element'), title: text.split('\n')[0] || '', blocks, text, html: '', markdown: htmlToMarkdown(mdHtml), chars: text.length, multi: blocks.length > 1 };
  }
  const text = blocksToPlain(blocks, opts);
  const href = enclosingLinkHref(el);
  const html = blocksToHtml(blocks); // Rich output is unchanged; only Markdown carries the enclosing link
  return { kind: 'element', type: typeName(el, 'element'), title: text.split('\n')[0] || '', blocks, text, html, markdown: htmlToMarkdown(href ? wrapBlocksInLink(html, href) : html), chars: text.length, multi: blocks.length > 1 };
}

export function payloadFromSelection(sel, settings) {
  const text = sel.toString().replace(/ /g, ' ').trim();
  let html = '';
  try {
    const div = document.createElement('div');
    for (let i = 0; i < sel.rangeCount; i++) div.appendChild(sel.getRangeAt(i).cloneContents());
    html = sanitizeHtml(div.innerHTML);
  } catch (_) { /* noop */ }
  void settings;
  return { kind: 'selection', type: 'Selection', title: text.split('\n')[0] || '', text, html, markdown: htmlToMarkdown(html) || text, chars: text.length, blocks: [] };
}

/**
 * Copy a payload using the chosen format, record history. `format`: 'plain' | 'rich' | 'markdown' (links as [text](url)).
 */
export async function commitCopy(payload, format, settings, extra = {}) {
  const markdown = format === 'markdown' && !!payload.markdown;
  const rich = format === 'rich' && !!payload.html;
  const text = markdown ? payload.markdown : payload.text;
  const res = await writeClipboard({ text, html: rich ? payload.html : '' });
  if (res.ok) {
    const domain = domainOf(location.href) || location.hostname;
    const meta = { type: payload.type, domain, chars: text.length, format: markdown ? 'markdown' : rich ? 'rich' : 'plain' };
    try {
      await setLast(meta);
      if (settings.historyEnabled && !extra.skipHistory) {
        await addHistory({ ...meta, text, html: rich ? payload.html : '', title: payload.title });
      }
    } catch (_) { /* extension context may be invalidated after reload */ }
  }
  return { ...res, rich, markdown, chars: text.length };
}
