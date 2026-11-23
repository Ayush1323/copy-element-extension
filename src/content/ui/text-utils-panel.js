import { h } from './shadow-root-ui.js';
import { icon } from '../../shared/icons.js';
import { TOOLS, findReplace, textStats } from '../core/text-utils.js';

const MARGIN = 6;
const HISTORY_LIMIT = 100;
const mac = /Mac|iPhone|iPad/.test(navigator.platform || '');
const MOD = mac ? '⌘' : 'Ctrl';

const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/**
 * The Text Utils panel: a small floating, draggable window on the page for changing the case of text, tidying spaces and
 * find & replace. Everything happens locally in the page; nothing is stored except where the panel was left.
 *
 * @param {object} ui shadow ui
 * @param {{onCopy: (text: string) => Promise<boolean>, onClose: () => void, loadPos: () => Promise<{x:number,y:number}|null>, savePos: (p: {x:number,y:number}) => void}} o
 */
export function createTextUtilsPanel(ui, { onCopy, onClose, loadPos, savePos }) {
  const toolButtons = TOOLS.map((t) => `<button class="tu-chip" data-tool="${t.id}" data-tip="${esc(t.tip)} (Alt+${t.shift ? 'Shift+' : ''}${t.key})">${esc(t.label)}</button>`).join('');
  const keyRows = [
    ...TOOLS.map((t) => `<li><span>${esc(t.label)}</span><kbd>Alt</kbd>${t.shift ? '<kbd>Shift</kbd>' : ''}<kbd>${t.key}</kbd></li>`),
    '<li><span>Find &amp; replace</span><kbd>Alt</kbd><kbd>R</kbd></li>',
    `<li><span>Copy the text</span><kbd>${MOD}</kbd><kbd>Enter</kbd></li>`,
    `<li><span>Undo · Redo</span><kbd>${MOD}</kbd><kbd>Z</kbd> <kbd>${MOD}</kbd><kbd>Y</kbd></li>`,
    '<li><span>Leave the text box · close</span><kbd>Esc</kbd></li>',
  ].join('');

  const el = h('div', 'tu', `
    <div class="tu-head">
      <span class="tu-grip" title="Drag to move" aria-hidden="true">${icon('grip', 14)}</span>
      <span class="tu-ico">${icon('textutils', 16)}</span>
      <span class="tu-title">Text Utils</span>
      <button class="tu-hbtn" data-tu="keys" data-tip="Keyboard shortcuts" aria-label="Keyboard shortcuts" aria-pressed="false">${icon('keyboard', 15)}</button>
      <button class="tu-hbtn" data-tu="close" data-tip="Close" aria-label="Close Text Utils">${icon('x', 15)}</button>
    </div>
    <div class="tu-body">
      <div class="tu-tools">${toolButtons}<button class="tu-chip tu-chip-find" data-tu="find" data-tip="Find &amp; replace (Alt+R)" aria-pressed="false">Replace…</button></div>
      <div class="tu-find" hidden>
        <input type="text" class="tu-in" data-f="find" placeholder="Find" spellcheck="false" aria-label="Text to find">
        <input type="text" class="tu-in" data-f="repl" placeholder="Replace with" spellcheck="false" aria-label="Replace with">
        <div class="tu-find-row">
          <label class="tu-chk"><input type="checkbox" data-f="case"><span>Match case</span></label>
          <label class="tu-chk"><input type="checkbox" data-f="regex"><span>Regex</span></label>
          <button class="tu-chip tu-go" data-tu="replace">Replace all</button>
        </div>
        <div class="tu-msg" role="status" aria-live="polite"></div>
      </div>
      <div class="tu-keys" hidden><ul>${keyRows}</ul></div>
      <textarea class="tu-ta" placeholder="Add your text here…" spellcheck="false" aria-label="Text to change"></textarea>
      <div class="tu-hint">Select part of the text to change only that part.</div>
      <div class="tu-foot">
        <span class="tu-stats" aria-live="off"></span>
        <button class="tu-ib" data-tu="undo" data-tip="Undo (${MOD}+Z)" aria-label="Undo">${icon('undo', 15)}</button>
        <button class="tu-ib" data-tu="redo" data-tip="Redo (${MOD}+Y)" aria-label="Redo">${icon('redo', 15)}</button>
        <button class="tu-ib" data-tu="clear" data-tip="Clear" aria-label="Clear text">${icon('trash', 15)}</button>
        <button class="tu-copy" data-tu="copy" data-tip="Copy the text (${MOD}+Enter)">${icon('copy', 15)}<span>Copy</span></button>
      </div>
    </div>`);
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Text Utils');
  el.hidden = true;
  ui.layer.appendChild(el);

  const q = (s) => el.querySelector(s);
  const ta = q('.tu-ta');
  const findBox = q('.tu-find');
  const keysBox = q('.tu-keys');
  const msg = q('.tu-msg');
  const stats = q('.tu-stats');
  const copyBtn = q('[data-tu="copy"]');
  const fIn = q('[data-f="find"]'), rIn = q('[data-f="repl"]');

  let open = false;
  let pos = { x: 0, y: 0 };
  let hist = [''];
  let at = 0;
  let typingTimer = 0;
  let copiedTimer = 0;
  let drag = null;

  /* ------------------------------ text + history ------------------------------ */

  function refresh() {
    const s = textStats(ta.value);
    stats.textContent = `${s.words.toLocaleString('en-US')} ${s.words === 1 ? 'word' : 'words'} · ${s.chars.toLocaleString('en-US')} ${s.chars === 1 ? 'char' : 'chars'}`;
    const empty = ta.value === '';
    copyBtn.disabled = empty;
    q('[data-tu="clear"]').disabled = empty;
    q('[data-tu="undo"]').disabled = at === 0 && !typingTimer;
    q('[data-tu="redo"]').disabled = at >= hist.length - 1;
    el.querySelectorAll('[data-tool], [data-tu="replace"]').forEach((b) => { b.disabled = empty; });
  }

  function push(v) {
    if (hist[at] === v) return;
    hist.length = at + 1;
    hist.push(v);
    if (hist.length > HISTORY_LIMIT) hist.shift();
    at = hist.length - 1;
  }
  function flushTyping() { if (typingTimer) { clearTimeout(typingTimer); typingTimer = 0; push(ta.value); } }

  function undo() { flushTyping(); if (at > 0) { at--; ta.value = hist[at]; refresh(); } }
  function redo() { flushTyping(); if (at < hist.length - 1) { at++; ta.value = hist[at]; refresh(); } }

  /** The range the next change applies to: the selection when there is one, else the whole text. */
  function target() {
    const a = ta.selectionStart, b = ta.selectionEnd;
    return a !== b ? { a, b, part: true } : { a: 0, b: ta.value.length, part: false };
  }

  /** Replace the target range with `next` (history aware) and keep the changed part selected. */
  function applyToTarget(fn) {
    flushTyping();
    const { a, b, part } = target();
    const before = ta.value;
    const piece = before.slice(a, b);
    const out = fn(piece);
    if (out == null || out === piece) return false;
    ta.value = before.slice(0, a) + out + before.slice(b);
    push(ta.value);
    if (part) ta.setSelectionRange(a, a + out.length);
    refresh();
    return true;
  }

  function runTool(id) {
    const tool = TOOLS.find((t) => t.id === id);
    if (!tool || !ta.value) return;
    const changed = applyToTarget((t) => tool.fn(t));
    if (!changed) flashMsg('Nothing to change.');
    else msg.textContent = '';
    ta.focus({ preventScroll: true });
  }

  function flashMsg(text, bad = false) {
    msg.textContent = text;
    msg.classList.toggle('bad', bad);
  }

  function replaceAll() {
    if (!ta.value) return;
    flushTyping();
    const { a, b } = target();
    const res = findReplace(ta.value.slice(a, b), fIn.value, rIn.value, { matchCase: q('[data-f="case"]').checked, regex: q('[data-f="regex"]').checked });
    if (res.error) { flashMsg(res.error, true); return; }
    if (!res.count) { flashMsg('No matches found.', true); return; }
    applyToTarget(() => res.text);
    flashMsg(`Replaced ${res.count.toLocaleString('en-US')} ${res.count === 1 ? 'match' : 'matches'}.`);
  }

  function toggleFind(force) {
    const show = force != null ? force : findBox.hidden;
    findBox.hidden = !show;
    q('[data-tu="find"]').setAttribute('aria-pressed', String(show));
    q('[data-tu="find"]').classList.toggle('on', show);
    if (show) { keysBox.hidden = true; q('[data-tu="keys"]').setAttribute('aria-pressed', 'false'); fIn.focus(); fIn.select(); }
    else { flashMsg(''); ta.focus(); }
    place(); // the panel changed height
  }
  function toggleKeys() {
    keysBox.hidden = !keysBox.hidden;
    q('[data-tu="keys"]').setAttribute('aria-pressed', String(!keysBox.hidden));
    if (!keysBox.hidden) { findBox.hidden = true; q('[data-tu="find"]').classList.remove('on'); q('[data-tu="find"]').setAttribute('aria-pressed', 'false'); }
    place();
  }

  async function copy() {
    if (!ta.value) return;
    const ok = await onCopy(ta.value);
    const label = copyBtn.querySelector('span');
    label.textContent = ok ? 'Copied' : 'Failed';
    copyBtn.classList.toggle('ok', ok);
    clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => { label.textContent = 'Copy'; copyBtn.classList.remove('ok'); }, 1300);
  }

  /* --------------------------------- position --------------------------------- */

  function clamp(p) {
    const vw = document.documentElement.clientWidth || window.innerWidth, vh = window.innerHeight;
    const w = el.offsetWidth || 380, hh = el.offsetHeight || 400;
    return { x: Math.round(Math.min(Math.max(p.x, MARGIN), Math.max(MARGIN, vw - w - MARGIN))), y: Math.round(Math.min(Math.max(p.y, MARGIN), Math.max(MARGIN, vh - hh - MARGIN))) };
  }
  function place(p) {
    if (p) pos = p;
    pos = clamp(pos);
    el.style.transform = `translate(${pos.x}px, ${pos.y}px)`;
  }
  const defaultPos = () => ({ x: (document.documentElement.clientWidth || window.innerWidth) - (el.offsetWidth || 380) - 18, y: 72 });

  const head = q('.tu-head');
  head.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('button')) return;
    e.preventDefault();
    head.setPointerCapture(e.pointerId);
    drag = { x: e.clientX, y: e.clientY, from: { ...pos } };
    el.classList.add('moving');
  });
  head.addEventListener('pointermove', (e) => { if (drag) place({ x: drag.from.x + e.clientX - drag.x, y: drag.from.y + e.clientY - drag.y }); });
  const endDrag = () => { if (!drag) return; drag = null; el.classList.remove('moving'); try { savePos(pos); } catch (_) { /* extension context gone */ } };
  head.addEventListener('pointerup', endDrag);
  head.addEventListener('pointercancel', endDrag);
  const onResize = () => { if (open) place(); };

  /* ---------------------------------- events ---------------------------------- */

  // Typing here must never reach the page's own shortcuts (many sites bind single keys).
  for (const t of ['keydown', 'keyup', 'keypress']) el.addEventListener(t, (e) => e.stopPropagation());

  ta.addEventListener('input', () => {
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => { typingTimer = 0; push(ta.value); refresh(); }, 450);
    refresh();
  });

  el.addEventListener('click', (e) => {
    const t = e.target.closest('[data-tool]');
    if (t) return runTool(t.dataset.tool);
    const a = e.target.closest('[data-tu]');
    if (!a) return;
    ({
      close: () => onClose(),
      keys: toggleKeys,
      find: () => toggleFind(),
      replace: replaceAll,
      undo, redo,
      clear: () => { flushTyping(); ta.value = ''; push(''); refresh(); ta.focus(); },
      copy,
    })[a.dataset.tu]?.();
  });

  el.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === 'Escape') { e.preventDefault(); (el.getRootNode().activeElement || ta).blur?.(); return; }
    if (mod && !e.altKey) {
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return; }
      if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); redo(); return; }
      if (e.key === 'Enter') { e.preventDefault(); copy(); return; }
      return;
    }
    if (e.altKey && !mod) {
      if (e.code === 'KeyR') { e.preventDefault(); toggleFind(); return; }
      const tool = TOOLS.find((t) => e.code === `Key${t.key}` && !!t.shift === e.shiftKey);
      if (tool) { e.preventDefault(); runTool(tool.id); return; }
    }
    if (e.key === 'Enter' && e.target.matches && e.target.matches('.tu-in')) { e.preventDefault(); replaceAll(); }
  });

  /* ---------------------------------- public ---------------------------------- */

  return {
    /** Show the panel. `text` (if any) replaces what is in the box; otherwise the previous text stays. */
    async show(text) {
      if (text != null && text !== '') { flushTyping(); ta.value = text; push(text); }
      if (!open) {
        open = true;
        el.style.visibility = 'hidden'; // shown only once it stands where it belongs: no flash in the corner
        el.hidden = false;
        let saved = null;
        try { saved = await loadPos(); } catch (_) { /* extension context gone */ }
        if (!open) return; // closed again while the saved position was loading
        place(saved && Number.isFinite(saved.x) && Number.isFinite(saved.y) ? saved : defaultPos());
        el.style.visibility = '';
        window.addEventListener('resize', onResize, { passive: true });
      }
      refresh();
      requestAnimationFrame(() => { if (open) ta.focus({ preventScroll: true }); });
    },
    hide() {
      if (!open) return;
      open = false;
      flushTyping();
      el.hidden = true;
      window.removeEventListener('resize', onResize);
    },
    isOpen: () => open,
    getText: () => ta.value,
    destroy() { clearTimeout(typingTimer); clearTimeout(copiedTimer); window.removeEventListener('resize', onResize); el.remove(); },
  };
}
