function listLines(block) {
  const counters = [];
  if (block.type === 'group') return block.items.map((it) => `- ${it.text}`).join('\n');
  return block.items
    .map((it) => {
      const d = it.depth || 0;
      counters.length = d + 1;
      let prefix = '- ';
      if (block.ordered) {
        counters[d] = (counters[d] || 0) + 1;
        prefix = `${counters[d]}. `;
      }
      return '  '.repeat(d) + prefix + it.text;
    })
    .join('\n');
}

/** Blocks -> readable plain text (paragraphs separated by a blank line). */
export function blocksToPlain(blocks, opts = {}) {
  const md = opts.headingStyle === 'markdown';
  const parts = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    switch (b.type) {
      case 'heading':
        parts.push((md ? '#'.repeat(Math.min(Math.max(b.level, 1), 6)) + ' ' : '') + b.text);
        break;
      case 'label': {
        const next = blocks[i + 1];
        if (next && (next.type === 'list' || next.type === 'group')) {
          parts.push(b.text + '\n' + listLines(next));
          i++;
        } else parts.push(b.text);
        break;
      }
      case 'list':
      case 'group':
        parts.push(listLines(b));
        break;
      case 'button':
        parts.push(`[${b.text}]`);
        break;
      default:
        parts.push(b.text);
    }
  }
  return parts.join('\n\n').replace(/[ \t]+\n/g, '\n').trim();
}
