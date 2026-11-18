import { h } from './shadow-root-ui.js';
import { icon } from '../../shared/icons.js';
import { truncate } from '../../shared/helpers.js';
import { LINK_PANEL_W, placeLinkPanel } from './placement.js';
import { linkSignature } from '../core/link-info.js';

const HIDE_DELAY = 220;
const NONE = 'Not specified';

/** Floating attribute panel for the hovered <a>. All values are written with textContent (never innerHTML). */
export function createLinkPanel(ui, { onCopy }) {
  const el = h('div', 'linkp', `
    <div class="lp-head"><span class="lp-chip">LINK</span><span class="lp-sub">Attributes</span></div>
    <dl class="lp-list"></dl>`);
  el.hidden = true;
  ui.layer.appendChild(el);
  const list = el.querySelector('.lp-list');

  let sig = '';
  let timer = 0;
  let anchorRect = null;

  const copyBtn = (kind, label) => {
    const b = h('button', 'lp-copy', icon('copy', 12));
    b.type = 'button';
    b.dataset.copy = kind;
    b.title = label;
    b.setAttribute('aria-label', label);
    return b;
  };

  function row(name, valueNode, missing, copy) {
    const wrap = h('div', 'lp-row');
    const dt = h('dt', 'lp-k');
    dt.textContent = name;
    const dd = h('dd', 'lp-v' + (missing ? ' none' : ''));
    if (typeof valueNode === 'string') dd.textContent = valueNode;
    else dd.appendChild(valueNode);
    wrap.append(dt, dd);
    if (copy) wrap.appendChild(copyBtn(copy[0], copy[1]));
    list.appendChild(wrap);
  }

  function attrRow(name, val) {
    if (val == null) return row(name, NONE, true);
    if (val === '') return row(name, 'Empty', true);
    return row(name, val, false);
  }

  function render(info) {
    list.textContent = '';
    row('Text', info.text ? truncate(info.text, 140) : NONE, !info.text);
    row('href', info.href || NONE, !info.href, info.href ? ['url', 'Copy URL'] : null);
    attrRow('target', info.target);
    if (info.relTokens.length) {
      const chips = h('span', 'lp-chips');
      for (const t of info.relTokens) {
        const c = h('span', 'lp-rel');
        c.textContent = t;
        chips.appendChild(c);
      }
      row('rel', chips, false, ['rel', 'Copy rel values']);
    } else attrRow('rel', info.rel);
    attrRow('title', info.title);
    if (info.download == null) row('download', NONE, true);
    else row('download', info.download || 'Present (no filename)', !info.download);
    attrRow('aria-label', info.ariaLabel);
    const foot = h('div', 'lp-foot');
    const html = h('button', 'lp-html', `${icon('copy', 12)}<span>Copy HTML</span>`);
    html.type = 'button';
    html.dataset.copy = 'html';
    foot.appendChild(html);
    list.appendChild(foot);
  }

  function place() {
    if (!anchorRect) return;
    const vw = document.documentElement.clientWidth || window.innerWidth;
    const vh = window.innerHeight;
    const w = Math.min(LINK_PANEL_W, vw - 12);
    el.style.width = `${w}px`;
    const hgt = el.offsetHeight || 200;
    const pos = placeLinkPanel(anchorRect, w, hgt, vw, vh);
    el.classList.toggle('above', pos.side === 'above');
    el.style.transform = `translate(${Math.round(pos.left)}px, ${Math.round(pos.top)}px)`;
  }

  function cancelHide() { clearTimeout(timer); timer = 0; }

  el.addEventListener('mouseenter', cancelHide);
  el.addEventListener('mouseleave', () => hideSoon());
  el.addEventListener('mousedown', (e) => e.preventDefault()); // keep page focus/selection
  el.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('[data-copy]');
    if (!b) return;
    e.preventDefault();
    e.stopPropagation();
    Promise.resolve(onCopy(b.dataset.copy)).then((ok) => {
      if (!ok) return;
      b.classList.add('ok');
      setTimeout(() => b.classList.remove('ok'), 700);
    });
  });

  function hideNow() { cancelHide(); el.hidden = true; sig = ''; anchorRect = null; }
  function hideSoon() {
    if (el.hidden || timer) return;
    timer = setTimeout(hideNow, HIDE_DELAY);
  }

  return {
    el,
    /** Show (or refresh in place) for a link; unchanged content is not re-rendered. */
    show(info, rect) {
      cancelHide();
      anchorRect = rect;
      const s = linkSignature(info);
      if (s !== sig) { sig = s; render(info); }
      el.hidden = false;
      place();
    },
    reposition(rect) { if (!el.hidden) { anchorRect = rect; place(); } },
    hideSoon,
    hideNow,
    cancelHide,
    isVisible: () => !el.hidden,
  };
}
