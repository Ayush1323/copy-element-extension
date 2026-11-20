import { h } from './shadow-root-ui.js';
import { icon } from '../../shared/icons.js';
import { formatCount } from '../../shared/helpers.js';
import { blocksToPlain } from '../clipboard/text-formatter.js';

const TAGS = { heading: 'Heading', text: 'Text', list: 'List', group: 'Items', stat: 'Stat', button: 'Button', label: 'Label' };

function renderBlock(b, partner) {
  const box = h('div', 'pb' + (b.type === 'heading' ? ' heading' : ''));
  const tag = document.createElement('span');
  tag.className = 'tag';
  tag.textContent = b.type === 'heading' ? `H${b.level || 2}` : b.type === 'label' ? b.text.replace(/:$/, '') : TAGS[b.type] || 'Text';
  box.appendChild(tag);
  const listBlock = b.type === 'label' ? partner : b;
  if (b.type === 'label' && !partner) {
    box.append(document.createTextNode(b.text));
  } else if (listBlock && (listBlock.type === 'list' || listBlock.type === 'group')) {
    const ul = document.createElement('ul');
    for (const it of listBlock.items) {
      const li = document.createElement('li');
      li.textContent = it.text;
      if (it.depth) li.style.marginLeft = `${it.depth * 12}px`;
      ul.appendChild(li);
    }
    box.appendChild(ul);
  } else box.append(document.createTextNode(b.text));
  const part = b.type === 'label' && partner ? [b, partner] : [b];
  const btn = h('button', 'pc', icon('copy', 13));
  btn.title = 'Copy this part';
  btn.dataset.part = '1';
  box.appendChild(btn);
  return { box, btn, text: blocksToPlain(part) };
}

export function createPreview(ui, { onCopyAll, onCopyPart, onClose }) {
  const el = h('div', 'panel', `
    <div class="p-head">
      <div class="p-title"><span class="p-kind"></span><div class="p-name"></div><div class="p-sub"></div></div>
      <button class="p-close" title="Close (Esc)">${icon('x', 16)}</button>
    </div>
    <div class="p-body"></div>
    <div class="p-foot">
      <button class="btn primary" data-f="default">${icon('copy', 14)}<span>Copy All</span></button>
      <button class="btn" data-f="plain">Plain Text</button>
      <button class="btn" data-f="rich">Rich Text</button>
      <button class="btn" data-f="markdown" title="Links as [text](url)">Markdown</button>
    </div>`);
  el.hidden = true;
  ui.layer.appendChild(el);
  const kind = el.querySelector('.p-kind');
  const name = el.querySelector('.p-name');
  const sub = el.querySelector('.p-sub');
  const body = el.querySelector('.p-body');
  const main = el.querySelector('[data-f="default"]');
  let copied = false;

  el.addEventListener('mousedown', (e) => { if (!e.target.closest('.p-body')) e.preventDefault(); });
  el.querySelector('.p-close').addEventListener('click', () => onClose());
  el.querySelector('.p-foot').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-f]');
    if (!b) return;
    const ok = await onCopyAll(b.dataset.f);
    if (ok) {
      copied = true;
      main.lastChild.textContent = 'Copy Again';
    }
  });

  return {
    open(payload, label) {
      copied = false;
      main.lastChild.textContent = 'Copy All';
      kind.textContent = label;
      name.textContent = payload.title || '(no title)';
      sub.textContent = `${formatCount(payload.chars)} characters · ${payload.blocks.length} block${payload.blocks.length === 1 ? '' : 's'}`;
      body.textContent = '';
      if (!payload.blocks.length) {
        body.appendChild(h('div', 'p-empty', 'No visible text found.'));
      }
      const bl = payload.blocks;
      for (let i = 0; i < bl.length; i++) {
        const partner = bl[i].type === 'label' && bl[i + 1] && (bl[i + 1].type === 'list' || bl[i + 1].type === 'group') ? bl[i + 1] : null;
        const { box, btn, text } = renderBlock(bl[i], partner);
        btn.addEventListener('click', async (ev) => {
          ev.stopPropagation();
          if (await onCopyPart(text)) {
            btn.classList.add('ok');
            btn.innerHTML = icon('check', 13);
            setTimeout(() => { btn.classList.remove('ok'); btn.innerHTML = icon('copy', 13); }, 900);
          }
        });
        body.appendChild(box);
        if (partner) i++;
      }
      el.hidden = false;
      body.scrollTop = 0;
    },
    close() { el.hidden = true; },
    isOpen: () => !el.hidden,
    markCopied() { copied = true; main.lastChild.textContent = 'Copy Again'; },
    get copied() { return copied; },
  };
}
