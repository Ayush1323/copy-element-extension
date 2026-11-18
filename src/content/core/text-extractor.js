import { escapeHtml } from '../../shared/helpers.js';
import { safeUrl } from '../clipboard/html-sanitizer.js';
import {
  tagOf, isElement, isText, shouldSkip, isBlockLevel, hasBlockDescendant, isFlowContainer,
  childNodesOf, childElementsOf, styleOf, resetCaches,
} from './dom-utils.js';

const FMT = { B: 'strong', STRONG: 'strong', I: 'em', EM: 'em', U: 'u', CODE: 'code', SUB: 'sub', SUP: 'sup', S: 's', DEL: 's', MARK: 'mark' };

export function normalizeText(t) {
  return t
    .replace(/[​-‍⁠﻿]/g, '')
    .replace(/[ \t\f\v ]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeHtml(h) {
  return h
    .replace(/[​-‍⁠﻿]/g, '')
    .replace(/[ \t\n\r\f\v ]+/g, ' ')
    .replace(/ ?<br> ?/g, '<br>')
    .replace(/^(\s|<br>)+|(\s|<br>)+$/g, '')
    .trim();
}

/** Serialize inline content into plain text + safe formatting HTML at the same time. */
function inlineInto(node, o) {
  if (isText(node)) {
    const v = node.nodeValue.replace(/[\t\n\r\f\v ]+/g, ' ');
    o.t += v;
    o.h += escapeHtml(v);
    return;
  }
  if (!isElement(node) || shouldSkip(node)) return;
  const tag = tagOf(node);
  if (tag === 'BR') {
    o.t += '\n';
    o.h += '<br>';
    return;
  }
  const blk = isBlockLevel(node);
  if (blk) {
    o.t += ' ';
    o.h += ' ';
  }
  let open = '';
  let close = '';
  if (FMT[tag]) {
    open = `<${FMT[tag]}>`;
    close = `</${FMT[tag]}>`;
  } else if (tag === 'A') {
    const href = safeUrl(node.href || node.getAttribute('href'));
    if (href) {
      open = `<a href="${escapeHtml(href)}">`;
      close = '</a>';
    }
  }
  o.h += open;
  for (const c of childNodesOf(node)) inlineInto(c, o);
  o.h += close;
  if (blk) {
    o.t += ' ';
    o.h += ' ';
  }
}

function weight(w) {
  if (w === 'bold') return 700;
  if (w === 'normal') return 400;
  return parseInt(w, 10) || 400;
}

function makeUnit(nodes, container, styleEl) {
  const o = { t: '', h: '' };
  for (const n of nodes) inlineInto(n, o);
  const text = normalizeText(o.t);
  if (!text) return null;
  let fs = 16;
  let fw = 400;
  try {
    const cs = styleOf(styleEl);
    fs = parseFloat(cs.fontSize) || 16;
    fw = weight(cs.fontWeight);
  } catch (_) { /* detached */ }
  return { type: 'text', text, html: normalizeHtml(o.h), container, fs, fw };
}

export function isButtonLike(el) {
  const tag = tagOf(el);
  if (tag === 'BUTTON') return true;
  if (tag === 'INPUT') {
    const t = (el.getAttribute('type') || '').toLowerCase();
    return t === 'button' || t === 'submit' || t === 'reset';
  }
  if (el.getAttribute('role') === 'button') return true;
  if (tag === 'A') {
    const cls = typeof el.className === 'string' ? el.className : '';
    return /(^|[\s_-])(btn|button|cta)([\s_-]|$)/i.test(cls);
  }
  return false;
}

/** Returns false if an item is too complex (headings/blocks) to be a plain bullet. */
function collectList(listEl, depth, items) {
  for (const li of childElementsOf(listEl)) {
    if (shouldSkip(li)) continue;
    const tag = tagOf(li);
    if (tag === 'UL' || tag === 'OL') {
      if (!collectList(li, depth + 1, items)) return false;
      continue;
    }
    const own = [];
    const subs = [];
    for (const c of childNodesOf(li)) {
      if (isElement(c)) {
        if (shouldSkip(c)) continue;
        const ct = tagOf(c);
        if (ct === 'UL' || ct === 'OL') { subs.push(c); continue; }
        if (/^H[1-6]$/.test(ct) || c.getAttribute('role') === 'heading') return false;
        if ((isBlockLevel(c) || hasBlockDescendant(c)) && !isFlowContainer(c)) return false;
      }
      own.push(c);
    }
    const u = makeUnit(own, li, li);
    if (u) items.push({ text: u.text, html: u.html, depth });
    for (const s of subs) if (!collectList(s, depth + 1, items)) return false;
  }
  return true;
}

function walk(el, out) {
  if (shouldSkip(el)) return;
  const tag = tagOf(el);
  const role = el.getAttribute('role');

  if (/^H[1-6]$/.test(tag) || role === 'heading') {
    const u = makeUnit(childNodesOf(el), el.parentElement, el);
    if (u) out.push({ ...u, type: 'heading', level: /^H/.test(tag) ? Number(tag[1]) : parseInt(el.getAttribute('aria-level'), 10) || 2 });
    return;
  }

  if (tag === 'UL' || tag === 'OL' || role === 'list') {
    const items = [];
    if (collectList(el, 0, items)) {
      if (items.length) out.push({ type: 'list', ordered: tag === 'OL', items, container: el.parentElement });
      return;
    }
  }

  if (tag === 'TABLE') {
    for (const tr of el.querySelectorAll('tr')) {
      if (shouldSkip(tr)) continue;
      const cells = childElementsOf(tr).filter((c) => !shouldSkip(c)).map((c) => makeUnit(childNodesOf(c), tr, c)).filter(Boolean);
      if (cells.length) out.push({ ...cells[0], text: cells.map((c) => c.text).join(' | '), html: escapeHtml(cells.map((c) => c.text).join(' | ')), noGroup: true });
    }
    return;
  }

  const flow = isFlowContainer(el);

  if (tag === 'INPUT') {
    if (isButtonLike(el)) {
      const text = normalizeText(el.value || el.getAttribute('value') || '');
      if (text) out.push({ type: 'button', text, container: el.parentElement });
    }
    return;
  }

  if (flow && isButtonLike(el)) {
    const u = makeUnit(childNodesOf(el), el.parentElement, el);
    if (u && u.text.length <= 80) {
      out.push({ type: 'button', text: u.text.replace(/\n+/g, ' '), href: tag === 'A' ? el.href : '', container: el.parentElement, fs: u.fs, fw: u.fw });
      return;
    }
  }

  if (flow) {
    // <div><a class="btn">Go</a></div>: a wrapper whose only content is a button-like element
    const kids = childElementsOf(el).filter((c) => !shouldSkip(c));
    const ownText = Array.from(childNodesOf(el)).some((n) => isText(n) && n.nodeValue.trim());
    if (kids.length === 1 && !ownText && isButtonLike(kids[0]) && !isButtonLike(el)) { walk(kids[0], out); return; }
    const u = makeUnit(childNodesOf(el), el.parentElement, el);
    if (u) out.push(u);
    return;
  }

  let run = [];
  const flush = () => {
    if (run.length) {
      const u = makeUnit(run, el, el);
      if (u) out.push(u);
      run = [];
    }
  };
  for (const c of childNodesOf(el)) {
    if (isText(c)) { run.push(c); continue; }
    if (!isElement(c) || shouldSkip(c)) continue;
    if (isBlockLevel(c) || hasBlockDescendant(c)) {
      flush();
      walk(c, out);
    } else run.push(c);
  }
  flush();
}

/* ---------- post processing ---------- */

const STAT_VALUE = /^[+\-−~≈<>]?\s*[$€£₹¥]?\s*\d[\d.,]*\s*(%|[kKmMbB]\+?|\+|x|X|×)?\+?$/;
const isStatValue = (t) => t.length <= 14 && STAT_VALUE.test(t);
const wordCount = (t) => t.split(/\s+/).filter(Boolean).length;
const isShortItem = (b) => (b.type === 'text' || b.type === 'stat') && !b.noGroup && b.text.length <= 48 && wordCount(b.text) <= 7 && !/[.!?]$/.test(b.text) && !b.text.includes('\n');
const isLabelText = (b) => b.type === 'text' && !b.noGroup && b.text.length <= 32 && wordCount(b.text) <= 4 && !/[.!?]$/.test(b.text) && !b.text.includes('\n');

function dedupe(blocks) {
  const seen = new Set();
  const out = [];
  for (const b of blocks) {
    if (b.type === 'list' || b.type === 'group') { out.push(b); continue; }
    const key = b.type + '|' + b.text;
    const prev = out[out.length - 1];
    if (prev && prev.type === b.type && prev.text === b.text) continue;
    if (b.text && b.text.length >= 20) {
      if (seen.has(b.text)) continue;
      seen.add(b.text);
    }
    out.push(b);
    void key;
  }
  return out;
}

function mergeStats(blocks) {
  const out = [];
  for (let i = 0; i < blocks.length; i++) {
    const a = blocks[i];
    const b = blocks[i + 1];
    if (a.type === 'text' && isStatValue(a.text) && b && b.type === 'text' && b.container === a.container && b.text.length <= 80 && !isStatValue(b.text) && !b.noGroup) {
      out.push({ type: 'stat', value: a.text, label: b.text, text: `${a.text} – ${b.text}`, html: `${escapeHtml(a.text)} – ${b.html || escapeHtml(b.text)}`, container: a.container });
      i++;
    } else out.push(a);
  }
  return out;
}

function groupShortItems(blocks) {
  const out = [];
  let i = 0;
  while (i < blocks.length) {
    const b = blocks[i];
    if (isShortItem(b)) {
      let j = i + 1;
      while (j < blocks.length && isShortItem(blocks[j]) && (blocks[j].container === b.container || (b.type === 'stat' && blocks[j].type === 'stat'))) j++;
      if (j - i >= 2) {
        out.push({ type: 'group', items: blocks.slice(i, j).map((x) => ({ text: x.text, html: x.html })), container: b.container });
        i = j;
        continue;
      }
    }
    out.push(b);
    i++;
  }
  return out;
}

function attachLabels(blocks, opts = {}) {
  return blocks.map((b, i) => {
    const next = blocks[i + 1];
    if (opts.labelHeadings && b.type === 'heading' && i > 0 && b.text.length <= 32 && !/[.!?]$/.test(b.text) && next && (next.type === 'list' || next.type === 'group')) {
      return { type: 'label', text: /[:：]$/.test(b.text) ? b.text : b.text + ':', container: b.container };
    }
    if (isLabelText(b) && next && (next.type === 'list' || next.type === 'group')) {
      return { type: 'label', text: /[:：]$/.test(b.text) ? b.text : b.text + ':', container: b.container };
    }
    return b;
  });
}

function promoteTitle(blocks) {
  if (blocks.some((b) => b.type === 'heading')) return blocks;
  const texts = blocks.filter((b) => b.type === 'text' && b.fs);
  if (texts.length < 2) return blocks;
  const sorted = texts.map((t) => t.fs).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const cand = blocks.slice(0, 4).filter((b) => b.type === 'text' && b.text.length <= 140 && b.fs >= median * 1.2);
  if (!cand.length) return blocks;
  const best = cand.reduce((a, b) => (b.fs > a.fs ? b : a));
  return blocks.map((b) => (b === best ? { ...b, type: 'heading', level: 3 } : b));
}

/**
 * Extract an ordered, de-duplicated list of content blocks from a DOM subtree.
 * Block types: heading | text | list | group | label | stat | button
 */
export function extractBlocks(root, opts = {}) {
  resetCaches();
  const raw = [];
  walk(root, raw);
  let b = dedupe(raw);
  if (opts.includeButtons === false) b = b.filter((x) => x.type !== 'button');
  b = mergeStats(b);
  b = groupShortItems(b);
  b = attachLabels(b, opts);
  if (opts.promoteTitle) b = promoteTitle(b);
  return b;
}

export function blockText(b) {
  if (b.type === 'list') return b.items.map((i) => i.text).join('\n');
  if (b.type === 'group') return b.items.map((i) => i.text).join('\n');
  return b.text || '';
}
