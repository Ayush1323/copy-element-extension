import { escapeHtml } from '../../shared/helpers.js';

const ALLOWED = new Set([
  'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'P', 'UL', 'OL', 'LI', 'A', 'STRONG', 'B', 'EM', 'I', 'U',
  'BR', 'BLOCKQUOTE', 'CODE', 'PRE', 'SUB', 'SUP', 'S', 'DEL', 'MARK', 'SMALL',
]);
// Removed together with their content.
const DROP = new Set([
  'SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'SVG', 'MATH', 'TEMPLATE', 'NOSCRIPT', 'FORM',
  'INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'LINK', 'META', 'BASE', 'AUDIO', 'VIDEO', 'CANVAS',
  'IMG', 'PICTURE', 'HEAD', 'TITLE', 'FRAME', 'FRAMESET', 'APPLET',
]);
const BLOCKY = new Set(['DIV', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'MAIN', 'ASIDE', 'NAV', 'FIGURE', 'FIGCAPTION']);

export function safeUrl(url) {
  if (!url) return '';
  const v = String(url).trim().replace(/[\u0000-\u001f\u007f\s]+/g, '');
  return /^(https?:|mailto:|tel:)/i.test(v) ? String(url).trim() : '';
}

function serialize(node) {
  if (node.nodeType === 3) return escapeHtml(node.nodeValue);
  if (node.nodeType !== 1) return '';
  const tag = node.tagName.toUpperCase();
  if (DROP.has(tag)) return '';
  const inner = Array.from(node.childNodes).map(serialize).join('');
  if (ALLOWED.has(tag)) {
    const t = tag.toLowerCase();
    if (t === 'br') return '<br>';
    if (t === 'a') {
      const href = safeUrl(node.getAttribute('href'));
      return href ? `<a href="${escapeHtml(href)}" rel="noopener noreferrer">${inner}</a>` : inner;
    }
    return `<${t}>${inner}</${t}>`;
  }
  // Unknown wrapper: keep text, drop element + attributes (style, on*, class …).
  return BLOCKY.has(tag) && inner.trim() ? `<p>${inner}</p>` : inner;
}

/** Allow-list sanitizer. Works on an inert document (no script execution, no resource loads). */
export function sanitizeHtml(html) {
  if (!html) return '';
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  return Array.from(doc.body.childNodes).map(serialize).join('');
}
