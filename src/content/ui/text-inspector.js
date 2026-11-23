import { h } from './shadow-root-ui.js';
import { icon } from '../../shared/icons.js';
import { truncate } from '../../shared/helpers.js';
import { LINK_PANEL_W, placeBeside } from './placement.js';
import { textInfoSignature, toHex, toRgb, toHsl, cssBlock } from '../core/text-info.js';

const HIDE_DELAY = 400; // grace period: time to travel from the text into the panel
const TOOLBAR_CLEAR = 28; // the highlight's label chip sits right above the text
const SAMPLE_MAX_PX = 26;

/**
 * Typography panel for the text under the pointer (Inspect mode).
 * Interactive, like the link panel: the pointer can travel into it, and every colour can be copied in HEX, RGB or HSL.
 * All values go in with textContent / CSSOM (never innerHTML).
 */
export function createTextPanel(ui, { onCopy, onLeave }) {
  const el = h('div', 'linkp textp', `
    <div class="lp-head"><span class="lp-chip">TEXT</span><span class="lp-sub tp-tag"></span><span class="tp-hint">Alt+C copies the color</span></div>
    <div class="tp-sample"><span class="tp-sample-text"></span></div>
    <dl class="lp-list"></dl>
    <div class="lp-foot"><button type="button" class="lp-html" data-copy="css">${icon('copy', 12)}<span>Copy CSS</span></button></div>`);
  el.hidden = true;
  ui.layer.appendChild(el);
  const list = el.querySelector('.lp-list');
  const tagEl = el.querySelector('.tp-tag');
  const sample = el.querySelector('.tp-sample');
  const sampleText = el.querySelector('.tp-sample-text');

  let sig = '';
  let timer = 0;
  let inside = false; // the pointer is on the panel (tracked here: a closed shadow root hides the panel from event paths)
  let anchorRect = null;
  let pointer = null;
  let info = null;
  let texts = {}; // data-copy kind -> text that goes to the clipboard

  function row(name, content, { copy, cls = '' } = {}) {
    const wrap = h('div', `lp-row ${cls}`);
    const dt = h('dt', 'lp-k');
    dt.textContent = name;
    const dd = h('dd', 'lp-v');
    if (typeof content === 'string') dd.textContent = content;
    else dd.appendChild(content);
    wrap.append(dt, dd);
    if (copy) {
      const b = h('button', 'lp-copy', icon('copy', 12));
      b.type = 'button';
      b.dataset.copy = copy[0];
      b.title = copy[1];
      b.setAttribute('aria-label', copy[1]);
      wrap.appendChild(b);
    }
    list.appendChild(wrap);
  }

  const span = (cls, text) => { const s = h('span', cls); s.textContent = text; return s; };

  /** swatch + value + HEX / RGB / HSL copy buttons */
  function colorRow(name, color, prefix) {
    const box = h('span', 'tp-color');
    const sw = h('button', 'tp-swatch');
    sw.type = 'button';
    sw.dataset.copy = `${prefix}-hex`;
    sw.title = 'Copy HEX';
    sw.setAttribute('aria-label', `Copy ${name.toLowerCase()} HEX`);
    sw.style.setProperty('--sw', toRgb(color));
    const val = span('tp-hex', toHex(color));
    const chips = h('span', 'tp-chips');
    for (const [k, label, text] of [['hex', 'HEX', toHex(color)], ['rgb', 'RGB', toRgb(color)], ['hsl', 'HSL', toHsl(color)]]) {
      texts[`${prefix}-${k}`] = text;
      const c = h('button', 'tp-chipbtn');
      c.type = 'button';
      c.dataset.copy = `${prefix}-${k}`;
      c.textContent = label;
      c.title = `Copy ${label}: ${text}`;
      c.setAttribute('aria-label', `Copy ${name.toLowerCase()} as ${label}: ${text}`);
      chips.appendChild(c);
    }
    box.append(sw, val, chips);
    row(name, box, { cls: 'tp-color-row' });
  }

  /** A gradient shown as itself (a bar painted with it), its CSS value, and every colour stop copyable. */
  function gradientRow(name, g, prefix) {
    const box = h('div', 'tp-grad');
    const bar = h('div', 'tp-gradbar');
    bar.style.background = g.css;
    const code = h('span', 'tp-gradcss');
    code.textContent = g.css;
    code.title = g.css;
    const acts = h('div', 'tp-gradacts');
    texts[`${prefix}-gradient`] = g.css;
    const copy = h('button', 'tp-copybtn', `${icon('copy', 12)}<span>Copy gradient</span>`);
    copy.type = 'button';
    copy.dataset.copy = `${prefix}-gradient`;
    copy.title = 'Copy the gradient CSS';
    const stops = h('span', 'tp-stops');
    g.stops.forEach((s, k) => {
      texts[`${prefix}-stop-${k}`] = s.hex;
      const sw = h('button', 'tp-swatch');
      sw.type = 'button';
      sw.dataset.copy = `${prefix}-stop-${k}`;
      sw.title = `Copy ${s.hex}`;
      sw.setAttribute('aria-label', `Copy gradient color ${s.hex}`);
      sw.style.setProperty('--sw', toRgb(s.color));
      stops.appendChild(sw);
    });
    acts.append(copy, stops);
    box.append(bar, code, acts);
    row(name, box, { cls: 'tp-color-row' });
  }

  function render(i) {
    texts = {};
    list.textContent = '';
    tagEl.textContent = `<${i.tag}>`;

    // live sample in the very same font, so "is this the font I think it is?" is answered at a glance
    sampleText.textContent = truncate(i.sample, 60) || 'Aa';
    const st = sampleText.style;
    st.fontFamily = i.stack;
    st.fontWeight = String(i.weight);
    st.fontStyle = i.style;
    st.fontSize = `${Math.min(i.size, SAMPLE_MAX_PX)}px`;
    st.letterSpacing = i.letterSpacing == null ? 'normal' : `${Math.min(i.letterSpacing, 6)}px`;
    st.textTransform = i.transform || 'none';
    st.color = i.color && i.color.a > 0 ? toRgb(i.color) : '#64748B';
    // gradient text is drawn as gradient text in the sample too
    st.backgroundImage = i.gradientText ? i.textGradient.css : '';
    st.webkitBackgroundClip = st.backgroundClip = i.gradientText ? 'text' : '';
    st.webkitTextFillColor = i.gradientText ? 'transparent' : '';
    sample.style.background = i.bg.color ? toRgb(i.bg.color) : i.bg.gradient ? i.bg.gradient.css : '';
    sample.classList.toggle('tp-checker', !i.bg.color && !i.bg.gradient);

    const fam = h('span', 'tp-fam');
    fam.append(span('tp-fam-name', i.family || 'Default'));
    if (i.families.length > 1) fam.append(span('tp-fam-stack', i.families.slice(1).join(', ')));
    texts.family = i.family;
    row('Font', fam, { copy: ['family', 'Copy font name'] });
    row('Size', i.sizeRem ? `${i.sizeText} · ${i.sizeRem}` : i.sizeText);
    row('Weight', i.weightName ? `${i.weight} · ${i.weightName}` : String(i.weight));
    row('Style', i.style === 'normal' ? 'Normal' : i.style.charAt(0).toUpperCase() + i.style.slice(1));
    row('Line height', i.lineHeightPx == null ? 'normal' : `${i.lineHeightText} · ${i.lineHeightRatio}`);
    row('Spacing', i.letterSpacingText);

    if (i.gradientText) gradientRow('Color', i.textGradient, 'color');
    else if (i.color) colorRow('Color', i.color, 'color');
    else row('Color', 'Unknown');

    if (i.bg.gradient) gradientRow('Background', i.bg.gradient, 'bg');
    else if (i.bg.image) row('Background', 'Image behind the text');
    else if (i.bg.color) colorRow('Background', i.bg.color, 'bg');

    if (i.contrast) {
      const box = h('span', 'tp-contrast');
      box.append(span('', i.contrast.text), span(`tp-badge ${i.contrast.level === 'Fail' ? 'bad' : 'good'}`, i.contrast.level === 'Fail' ? 'Low contrast' : `WCAG ${i.contrast.level}`));
      row('Contrast', box);
    }

    row('Align', i.align || 'left');
    if (i.decoration) row('Decoration', i.decoration);
    if (i.transform) row('Transform', i.transform);
    texts.css = cssBlock(i);
  }

  function place() {
    if (!anchorRect) return;
    const vw = document.documentElement.clientWidth || window.innerWidth;
    const vh = window.innerHeight;
    const w = Math.min(LINK_PANEL_W, vw - 12);
    el.style.width = `${w}px`;
    const hgt = Math.min(el.offsetHeight || 300, vh - 12);
    const pos = placeBeside(anchorRect, pointer, w, hgt, vw, vh, TOOLBAR_CLEAR, true);
    el.dataset.edge = pos.edge;
    el.style.setProperty('--gap', `${pos.gap}px`);
    el.style.transform = `translate(${Math.round(pos.left)}px, ${Math.round(pos.top)}px)`;
  }

  function cancelHide() { clearTimeout(timer); timer = 0; }
  function hideNow() { cancelHide(); inside = false; el.hidden = true; sig = ''; anchorRect = null; info = null; }
  function hideSoon() {
    if (el.hidden || timer || inside) return; // never while the pointer is on it
    timer = setTimeout(() => { timer = 0; if (!inside) hideNow(); }, HIDE_DELAY);
  }

  el.addEventListener('mouseenter', () => { inside = true; cancelHide(); });
  el.addEventListener('mouseleave', (e) => { inside = false; hideSoon(); if (onLeave) onLeave(e); });
  el.addEventListener('mousedown', (e) => e.preventDefault()); // keep page focus / selection
  el.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('[data-copy]');
    if (!b) return;
    e.preventDefault();
    e.stopPropagation();
    const kind = b.dataset.copy;
    const text = texts[kind];
    if (!text) return;
    Promise.resolve(onCopy(text, kind)).then((ok) => {
      if (!ok) return;
      b.classList.add('ok');
      setTimeout(() => b.classList.remove('ok'), 700);
    });
  });

  return {
    el,
    /** Show (or refresh in place) for the text under the pointer; unchanged content is not re-rendered. */
    show(next, rect, pt = null) {
      cancelHide();
      anchorRect = rect;
      pointer = pt;
      const s = textInfoSignature(next);
      info = next;
      if (s !== sig) { sig = s; render(next); }
      el.hidden = false;
      place();
    },
    reposition(rect) { if (!el.hidden) { anchorRect = rect; place(); } },
    hideSoon,
    hideNow,
    cancelHide,
    isVisible: () => !el.hidden,
    /** HEX of the text colour being described (Alt+C). */
    colorHex: () => (!info ? '' : info.gradientText ? info.textGradient.css : info.color ? toHex(info.color) : ''),
    isGradient: () => !!(info && info.gradientText),
    isInside: () => inside,
  };
}
