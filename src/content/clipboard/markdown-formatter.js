// Sanitized semantic HTML (see html-sanitizer.js) -> Markdown, so links survive a plain-text paste as [text](url).

const BLOCK = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'P', 'UL', 'OL', 'BLOCKQUOTE', 'PRE']);

const escLabel = (s) => s.replace(/([[\]])/g, '\\$1');
const escUrl = (s) => s.trim().replace(/\s/g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29');

/** Wrap with a marker but keep surrounding spaces outside it (`**bold** text`, never `** bold**`). */
function wrap(marker, text) {
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(text);
  return m[2] ? `${m[1]}${marker}${m[2]}${marker}${m[3]}` : text;
}

function inline(node) {
  if (node.nodeType === 3) return node.nodeValue.replace(/\s+/g, ' ');
  if (node.nodeType !== 1) return '';
  const tag = node.localName;
  const inner = () => Array.from(node.childNodes).map(inline).join('');
  switch (tag) {
    case 'a': {
      const href = node.getAttribute('href') || '';
      const label = inner().trim();
      if (!href) return label;
      return `[${escLabel(label || href)}](${escUrl(href)})`;
    }
    case 'strong': case 'b': return wrap('**', inner());
    case 'em': case 'i': return wrap('*', inner());
    case 'code': return wrap('`', inner());
    case 's': case 'del': return wrap('~~', inner());
    case 'br': return '\n';
    default: return inner();
  }
}

const tidy = (s) => s.replace(/[ \t]*\n[ \t]*/g, '\n').replace(/ {2,}/g, ' ').trim();
const inlineChildren = (el) => tidy(Array.from(el.childNodes).map(inline).join(''));

function renderList(list, depth) {
  const lines = [];
  let n = 0;
  for (const li of list.children) {
    if (li.localName !== 'li') continue;
    n++;
    const own = [];
    const nested = [];
    for (const c of li.childNodes) {
      if (c.nodeType === 1 && (c.localName === 'ul' || c.localName === 'ol')) nested.push(c);
      else own.push(inline(c));
    }
    const marker = list.localName === 'ol' ? `${n}. ` : '- ';
    lines.push('  '.repeat(depth) + marker + tidy(own.join('')).replace(/\n/g, ' '));
    for (const sub of nested) lines.push(renderList(sub, depth + 1));
  }
  return lines.filter(Boolean).join('\n');
}

function renderBlock(el) {
  const tag = el.tagName;
  if (/^H[1-6]$/.test(tag)) return `${'#'.repeat(Number(tag[1]))} ${inlineChildren(el).replace(/\n/g, ' ')}`;
  if (tag === 'UL' || tag === 'OL') return renderList(el, 0);
  if (tag === 'BLOCKQUOTE') {
    const inner = convertChildren(el) || inlineChildren(el);
    return inner.split('\n').map((l) => (l ? `> ${l}` : '>')).join('\n');
  }
  if (tag === 'PRE') return '```\n' + el.textContent.replace(/\n$/, '') + '\n```';
  return inlineChildren(el); // P
}

function convertChildren(parent) {
  const out = [];
  let run = '';
  const flush = () => { const t = tidy(run); if (t) out.push(t); run = ''; };
  for (const c of parent.childNodes) {
    if (c.nodeType === 1 && BLOCK.has(c.tagName)) {
      flush();
      const b = renderBlock(c);
      if (b) out.push(b);
    } else run += inline(c);
  }
  flush();
  return out.join('\n\n');
}

/** @param {string} html sanitized HTML @returns {string} Markdown (links as [text](url)) */
export function htmlToMarkdown(html) {
  if (!html) return '';
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  return convertChildren(doc.body).trim();
}

const WRAP_BLOCKS = 'h1,h2,h3,h4,h5,h6,p,li';

/**
 * The picked element lives inside a link (e.g. you hovered the link text itself, or a heading inside a
 * stretched-link card): wrap each block's content in that link so the destination is not lost.
 * Blocks that already contain their own links are left alone. `href` must already be validated.
 */
export function wrapBlocksInLink(html, href) {
  if (!html || !href) return html;
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  for (const el of doc.body.querySelectorAll(WRAP_BLOCKS)) {
    if (el.querySelector('a')) continue;
    // for <li> with a nested list, wrap only the item's own inline content
    const own = Array.from(el.childNodes).filter((n) => !(n.nodeType === 1 && (n.localName === 'ul' || n.localName === 'ol')));
    if (!own.length) continue;
    const a = doc.createElement('a');
    a.setAttribute('href', href);
    a.setAttribute('rel', 'noopener noreferrer');
    el.insertBefore(a, own[0]);
    own.forEach((n) => a.appendChild(n));
  }
  return doc.body.innerHTML;
}
