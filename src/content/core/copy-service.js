import { extractBlocks } from './text-extractor.js';
import { extractCard } from './card-extractor.js';
import { extractSection } from './section-extractor.js';
import { typeName } from './element-detector.js';
import { blocksToPlain } from '../clipboard/text-formatter.js';
import { blocksToHtml } from '../clipboard/html-formatter.js';
import { sanitizeHtml } from '../clipboard/html-sanitizer.js';
import { writeClipboard } from '../clipboard/clipboard-manager.js';
import { addHistory, setLast } from '../../shared/storage.js';
import { domainOf } from '../../shared/helpers.js';

/**
 * Build a copy payload for an element.
 * kind: 'text' (exact text, always plain) | 'element' | 'card' | 'section'
 */
export function buildPayload(kind, el, settings) {
  const opts = { headingStyle: settings.headingStyle, includeButtons: settings.includeButtons };
  if (kind === 'card') {
    const c = extractCard(el, opts);
    return { ...c, type: 'Card', multi: true };
  }
  if (kind === 'section') {
    const s = extractSection(el, opts);
    return { ...s, type: 'Section', multi: true };
  }
  const blocks = extractBlocks(el, opts);
  if (kind === 'text') {
    const text = blocksToPlain(blocks, { headingStyle: 'plain' });
    return { kind, type: typeName(el, 'element'), title: text.split('\n')[0] || '', blocks, text, html: '', chars: text.length, multi: blocks.length > 1 };
  }
  const text = blocksToPlain(blocks, opts);
  return { kind: 'element', type: typeName(el, 'element'), title: text.split('\n')[0] || '', blocks, text, html: blocksToHtml(blocks), chars: text.length, multi: blocks.length > 1 };
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
  return { kind: 'selection', type: 'Selection', title: text.split('\n')[0] || '', text, html, chars: text.length, blocks: [] };
}

/**
 * Copy a payload using the chosen format, record history. `format`: 'plain' | 'rich'.
 */
export async function commitCopy(payload, format, settings, extra = {}) {
  const rich = format === 'rich' && !!payload.html;
  const res = await writeClipboard({ text: payload.text, html: rich ? payload.html : '' });
  if (res.ok) {
    const domain = domainOf(location.href) || location.hostname;
    const meta = { type: payload.type, domain, chars: payload.chars, format: rich ? 'rich' : 'plain' };
    try {
      await setLast(meta);
      if (settings.historyEnabled && !extra.skipHistory) {
        await addHistory({ ...meta, text: payload.text, html: rich ? payload.html : '', title: payload.title });
      }
    } catch (_) { /* extension context may be invalidated after reload */ }
  }
  return { ...res, rich };
}
