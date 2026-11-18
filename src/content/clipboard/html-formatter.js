import { escapeHtml } from '../../shared/helpers.js';
import { sanitizeHtml } from './html-sanitizer.js';

function toTree(items) {
  const root = { children: [] };
  const stack = [{ depth: -1, node: root }];
  for (const it of items) {
    const d = it.depth || 0;
    while (stack.length > 1 && stack[stack.length - 1].depth >= d) stack.pop();
    const node = { html: it.html || escapeHtml(it.text), children: [] };
    stack[stack.length - 1].node.children.push(node);
    stack.push({ depth: d, node });
  }
  return root.children;
}

function renderTree(nodes, tag) {
  return `<${tag}>` + nodes.map((n) => `<li>${n.html}${n.children.length ? renderTree(n.children, tag) : ''}</li>`).join('') + `</${tag}>`;
}

function listHtml(block) {
  if (block.type === 'group') return `<ul>${block.items.map((it) => `<li>${it.html || escapeHtml(it.text)}</li>`).join('')}</ul>`;
  return renderTree(toTree(block.items), block.ordered ? 'ol' : 'ul');
}

/** Blocks -> sanitized semantic HTML (headings, paragraphs, lists, bold/italic, links). */
export function blocksToHtml(blocks) {
  let out = '';
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    switch (b.type) {
      case 'heading': {
        const n = Math.min(Math.max(b.level || 2, 1), 6);
        out += `<h${n}>${b.html || escapeHtml(b.text)}</h${n}>`;
        break;
      }
      case 'label': {
        out += `<p><strong>${escapeHtml(b.text)}</strong></p>`;
        break;
      }
      case 'list':
      case 'group':
        out += listHtml(b);
        break;
      case 'button':
        out += `<p><strong>${escapeHtml(b.text)}</strong></p>`;
        break;
      default:
        out += `<p>${b.html || escapeHtml(b.text)}</p>`;
    }
  }
  return sanitizeHtml(out);
}
