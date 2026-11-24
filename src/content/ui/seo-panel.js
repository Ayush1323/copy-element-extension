import { h } from './shadow-root-ui.js';
import { icon } from '../../shared/icons.js';
import {
  readPage, buildChecks, scoreOf, gradeOf, rateVital, formatVital, readNavigation, readResources, statusText, statusLevel, headingsMarkdown, linksCsv,
  parseRobots, robotsAllows, parseSitemap, sameUrl,
} from '../core/seo.js';
import { startVitals, fetchHeaders, fetchText, checkLinks } from '../core/seo-live.js';
import { formatBytes, getFileSize, cachedSize, middleTruncate } from '../core/image-info.js';

const MARGIN = 6;
const TABS = [['overview', 'Overview'], ['headings', 'Headings'], ['status', 'Status'], ['links', 'Links'], ['images', 'Images'], ['schema', 'Schema'], ['social', 'Social'], ['resources', 'Resources']];
const VITALS = [['LCP', 'Largest Contentful Paint', 'Loading'], ['INP', 'Interaction to Next Paint', 'Responsiveness'], ['CLS', 'Cumulative Layout Shift', 'Visual stability'], ['FCP', 'First Contentful Paint', 'First paint'], ['TTFB', 'Time to First Byte', 'Server speed']];
const CAP = 200;

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ESC[c]);
const chip = (text, level = '') => `<span class="seo-chip ${level}">${esc(text)}</span>`;
const dot = (level) => `<i class="seo-dot ${level}"></i>`;
const worst = (levels) => (levels.includes('bad') ? 'bad' : levels.includes('warn') ? 'warn' : '');
const scoreColor = (s) => (s >= 90 ? '#16A34A' : s >= 75 ? '#65A30D' : s >= 55 ? '#F59E0B' : '#EF4444');

/**
 * The SEO panel: a floating, draggable window with eight tabs (Overview, Headings, Status, Links, Images, Schema, Social,
 * Resources). Reads the page locally; the only network requests are the ones the user asks for (headers, robots.txt,
 * sitemap, link check) and they go to the page's own site.
 */
export function createSeoPanel(ui, { onCopy, onClose, onReveal, onHover, loadPos, savePos }) {
  const el = h('div', 'seo', `
    <div class="seo-head">
      <span class="seo-grip" title="Drag to move" aria-hidden="true">${icon('grip', 14)}</span>
      <span class="seo-logo">${icon('seo', 17)}</span>
      <div class="seo-ttl"><b>SEO</b><span class="seo-host"></span></div>
      <div class="seo-mini" title="SEO score"><b>–</b></div>
      <button class="seo-hb" data-act="refresh" data-tip="Re-read the page" aria-label="Refresh">${icon('refresh', 15)}</button>
      <button class="seo-hb" data-act="close" data-tip="Close" aria-label="Close SEO panel">${icon('x', 15)}</button>
    </div>
    <div class="seo-tabs" role="tablist"></div>
    <div class="seo-body"></div>
    <div class="seo-foot"></div>
    <div class="seo-drawer" hidden></div>`);
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'SEO');
  el.hidden = true;
  ui.layer.appendChild(el);

  const q = (s) => el.querySelector(s);
  const tabsEl = q('.seo-tabs'), body = q('.seo-body'), foot = q('.seo-foot'), drawer = q('.seo-drawer'), miniScore = q('.seo-mini');

  let open = false;
  let pos = { x: 0, y: 0 };
  let drag = null;
  let report = null, checks = [], score = 0, nav = null, resources = null;
  let tab = 'overview';
  let vitals = { LCP: null, INP: null, CLS: null, FCP: null, TTFB: null };
  let vitalsWatch = null;
  let headers = null; // null | 'loading' | { error } | result
  const robots = { state: 'idle', url: '', text: '', parsed: null, status: 0, error: '' };
  const sitemap = { state: 'idle', url: '', parsed: null, error: '', q: '', all: false };
  let drawerKind = '';
  const linkStatus = new Map();
  let checkingLinks = false, linkCancel = false, linkNeedsPermission = false;
  const f = { links: { kind: 'all', q: '' }, images: { kind: 'all', q: '' }, resources: { kind: 'all' } };
  const more = { links: false, images: false, resources: false };
  const openJson = new Set();
  const ogImage = { url: '', w: 0, h: 0, ok: null };
  let reg = [];

  const pathOf = () => { try { const u = new URL(report.meta.url); return u.pathname + u.search; } catch (_) { return '/'; } };
  const origin = () => { try { return new URL(report.meta.url).origin; } catch (_) { return location.origin; } };
  const remember = (node) => reg.push(node) - 1;
  const copyBtn = (text, label = 'Copy') => `<button class="seo-cp" data-copy="${remember(String(text))}" data-tip="${label}" aria-label="${label}">${icon('copy', 13)}</button>`;

  /* ------------------------------ data ------------------------------ */

  function collect() {
    report = readPage(document, window, location.href);
    nav = readNavigation(performance);
    try { resources = readResources(performance.getEntriesByType('resource'), location.hostname); } catch (_) { resources = readResources([], location.hostname); }
    recheck();
  }
  function recheck() {
    const status = (nav && nav.status) || (headers && headers.status) || 0;
    checks = buildChecks(report, { status, headers: headers && headers.headers ? headers.headers : null });
    score = scoreOf(checks);
  }

  /* ------------------------------ tabs ------------------------------ */

  const tabLevel = (id) => worst(checks.filter((c) => c.tab === id).map((c) => c.level));
  const tabCount = (id) => {
    if (!report) return '';
    if (id === 'headings') return report.headings.items.length;
    if (id === 'links') return report.links.counts.total;
    if (id === 'images') return report.images.counts.total;
    if (id === 'schema') return report.schema.total;
    if (id === 'resources') return resources ? resources.requests : '';
    return '';
  };

  function renderTabs() {
    tabsEl.innerHTML = TABS.map(([id, label]) => {
      const lv = tabLevel(id), n = tabCount(id);
      return `<button class="seo-tab${id === tab ? ' on' : ''}" role="tab" aria-selected="${id === tab}" data-tab="${id}">${esc(label)}${n !== '' ? `<small>${n}</small>` : ''}${lv ? dot(lv) : ''}</button>`;
    }).join('');
  }

  function renderFoot() {
    const c = report.headings.counts;
    foot.innerHTML = `
      <div class="seo-hc">${[1, 2, 3, 4, 5, 6].map((n) => `<button data-tab="headings" class="${c[n] ? '' : 'zero'}${n === 1 && c[1] !== 1 ? ' alert' : ''}"><b>H${n}</b><span>${c[n]}</span></button>`).join('')}</div>
      <div class="seo-fs"><button data-tab="links"><b>LINKS</b><span>${report.links.counts.total}</span></button><button data-tab="images"><b>IMAGES</b><span>${report.images.counts.total}</span></button></div>
      <div class="seo-fb"><button class="seo-lk" data-drawer="robots">${icon('file', 13)}Robots.txt</button><button class="seo-lk" data-drawer="sitemap">${icon('globe', 13)}Sitemap</button></div>`;
  }

  function renderHeader() {
    q('.seo-host').textContent = report.meta.host;
    miniScore.innerHTML = `<b style="color:${scoreColor(score)}">${score}</b>`;
    miniScore.style.setProperty('--p', score);
    miniScore.style.setProperty('--c', scoreColor(score));
  }

  function render({ keepScroll = true } = {}) {
    if (!report) return;
    const top = keepScroll ? body.scrollTop : 0;
    reg = [];
    renderHeader();
    renderTabs();
    renderFoot();
    body.innerHTML = ({ overview, headings, status, links, images, schema, social, resourcesTab })[tab === 'resources' ? 'resourcesTab' : tab]();
    body.scrollTop = top;
    if (tab === 'status' && headers === null) loadHeaders();
    if (tab === 'social') probeOgImage();
    if (drawerKind) renderDrawer();
  }

  /* ----------------------------- overview ----------------------------- */

  function gauge(len, lo, hi, max) {
    const pct = (v) => Math.min(100, (v / max) * 100);
    const lv = len === 0 ? 'bad' : len < lo || len > hi ? 'warn' : 'good';
    return `<div class="seo-gauge"><i class="zone" style="left:${pct(lo)}%;width:${pct(hi) - pct(lo)}%"></i><i class="mark ${lv}" style="left:${pct(len)}%"></i></div>`;
  }
  const field = (label, value, { copy = '', chips = '', after = '' } = {}) => `
    <div class="seo-f"><div class="seo-fl">${esc(label)}</div><div class="seo-fv">${value}${chips ? `<div class="seo-fc">${chips}</div>` : ''}${after}</div>${copy ? copyBtn(copy) : ''}</div>`;
  const link = (u) => `<a class="seo-a" href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(u)}</a>`;

  function overview() {
    const m = report.meta;
    const good = checks.filter((c) => c.level === 'good').length, warn = checks.filter((c) => c.level === 'warn').length, bad = checks.filter((c) => c.level === 'bad').length;
    const total = good + warn + bad || 1;
    const issues = checks.filter((c) => c.level === 'bad' || c.level === 'warn').sort((a, b) => (a.level === b.level ? b.weight - a.weight : a.level === 'bad' ? -1 : 1)).slice(0, 5);
    const noindex = m.robots.noindex || (headers && headers.headers && headers.headers.xRobots.noindex);
    let canonChip = '';
    if (!m.canonical) canonChip = chip('missing', 'warn'); else if (m.canonicalSelf) canonChip = chip('self-referencing', 'good'); else canonChip = chip('points elsewhere', 'info');
    const vit = VITALS.map(([k, name, sub]) => {
      const v = k === 'TTFB' && vitals.TTFB == null && nav ? nav.ttfb : vitals[k];
      const lv = rateVital(k, v);
      return `<div class="seo-vt ${lv}" title="${esc(name)}"><span>${k}</span><b>${formatVital(k, v)}</b><small>${v == null ? (k === 'INP' ? 'Interact with the page' : 'Measuring…') : esc(sub)}</small></div>`;
    }).join('');
    return `
      <div class="seo-hero">
        <div class="seo-ring" style="--p:${score};--c:${scoreColor(score)}"><b>${score}</b><span>/100</span></div>
        <div class="seo-hero-t"><h3>${gradeOf(score)}</h3><p>${good} passed · ${warn} to improve · ${bad} failing</p>
          <div class="seo-stack"><i class="g" style="width:${(good / total) * 100}%"></i><i class="w" style="width:${(warn / total) * 100}%"></i><i class="b" style="width:${(bad / total) * 100}%"></i></div></div>
      </div>
      ${issues.length ? `<div class="seo-sec"><h4>Fix first</h4>${issues.map((c) => `<button class="seo-issue" data-tab="${c.tab}">${dot(c.level)}<span><b>${esc(c.title)}</b><small>${esc(c.detail)}</small></span><em>${icon('up', 12)}</em></button>`).join('')}</div>` : `<div class="seo-allgood">${icon('check', 16)}No problems found on this page.</div>`}
      <div class="seo-sec"><h4>Page</h4>
        ${field('Title', m.title ? esc(m.title) : '<span class="seo-none">Missing</span>', { copy: m.title, chips: `${chip(`${m.titleLen} characters`, m.titleStatus)}`, after: gauge(m.titleLen, 30, 60, 90) })}
        ${field('Description', m.hasDescription && m.description ? esc(m.description) : '<span class="seo-none">Missing</span>', { copy: m.description, chips: chip(`${m.descriptionLen} characters`, m.descriptionStatus), after: gauge(m.descriptionLen, 70, 160, 220) })}
        ${field('URL', link(m.url), { copy: m.url, chips: m.https ? chip('https', 'good') : m.local ? chip('local', 'info') : chip('not https', 'bad') })}
        ${field('Canonical', m.canonical ? link(m.canonical) : '<span class="seo-none">Not set</span>', { copy: m.canonical || '', chips: canonChip })}
        ${field('Meta robots', m.robots.raw ? esc(m.robots.raw) : '<span class="seo-none">Not set (indexable by default)</span>', { chips: noindex ? chip('noindex', 'bad') : chip('indexable', 'good') + (m.robots.nofollow ? chip('nofollow', 'warn') : '') })}
        ${field('Language', m.lang ? esc(m.lang) : '<span class="seo-none">Not set</span>', {})}
        ${field('Viewport', m.viewport ? esc(m.viewport) : '<span class="seo-none">Missing</span>', { chips: m.viewport ? chip('mobile ready', 'good') : chip('missing', 'bad') })}
        ${field('Charset', esc(m.charset || '—'), {})}
        ${m.hreflang.length ? field('Hreflang', m.hreflang.map((x) => `${chip(x.lang, 'info')} <span class="seo-sm">${esc(middleTruncate(x.href || '', 60))}</span>`).join('<br>'), {}) : ''}
        ${m.favicon ? field('Favicon', `<img class="seo-fav" src="${esc(m.favicon)}" alt=""> ${link(m.favicon)}`, {}) : ''}
        ${m.prev || m.next ? field('Pagination', [m.prev ? `prev: ${esc(m.prev)}` : '', m.next ? `next: ${esc(m.next)}` : ''].filter(Boolean).join('<br>'), {}) : ''}
        ${m.generator ? field('Generator', esc(m.generator), {}) : ''}
      </div>
      <div class="seo-sec"><h4>Web vitals <small>measured on this page load</small></h4><div class="seo-vts">${vit}</div></div>`;
  }

  /* ----------------------------- headings ----------------------------- */

  function headings() {
    const hd = report.headings;
    const issues = hd.issues.map((i) => `<div class="seo-note ${i.level}">${dot(i.level)}${esc(i.text)}</div>`).join('');
    const rows = hd.items.map((it) => `<button class="seo-hrow l${it.level}${it.hidden ? ' hid' : ''}" data-r="${remember(it.el)}" style="padding-left:${10 + (it.level - 1) * 16}px"><i class="seo-hl l${it.level}">H${it.level}</i><span>${it.text ? esc(it.text) : '<em>(empty heading)</em>'}</span>${it.skipped ? chip('level skipped', 'warn') : ''}${it.hidden ? chip('hidden', 'info') : ''}</button>`).join('');
    return `
      <div class="seo-bar2"><div class="seo-cnts">${[1, 2, 3, 4, 5, 6].map((n) => `<span class="${hd.counts[n] ? '' : 'zero'}"><b>H${n}</b>${hd.counts[n]}</span>`).join('')}</div>
        <button class="seo-btn" data-act="copy-outline">${icon('copy', 13)}Copy outline</button></div>
      ${issues || `<div class="seo-allgood">${icon('check', 16)}Heading structure looks good.</div>`}
      <div class="seo-outline">${rows || '<div class="seo-empty">No headings on this page.</div>'}</div>`;
  }

  /* ------------------------------ status ------------------------------ */

  function status() {
    const code = (nav && nav.status) || (headers && headers.status) || 0;
    const lv = statusLevel(code);
    const m = report.meta;
    const hx = headers && headers.headers ? headers.headers : null;
    const reasons = [];
    if (code >= 400) reasons.push(['bad', `The server answered ${code}: search engines drop pages like this.`]);
    if (m.robots.noindex) reasons.push(['bad', 'Meta robots says noindex.']);
    if (hx && hx.xRobots.noindex) reasons.push(['bad', 'The X-Robots-Tag header says noindex.']);
    if (m.robots.nofollow) reasons.push(['warn', 'Meta robots says nofollow: links on this page are not followed.']);
    if (m.canonical && !m.canonicalSelf) reasons.push(['info', `Canonical points to another URL: ${m.canonical}`]);
    if (nav && nav.redirects) reasons.push(['warn', `${nav.redirects} redirect${nav.redirects > 1 ? 's' : ''} before this page loaded.`]);
    if (robots.parsed) { const a = robotsAllows(robots.parsed, pathOf(), '*'); const g = robotsAllows(robots.parsed, pathOf(), 'Googlebot'); if (!a.allowed || !g.allowed) reasons.push(['bad', `robots.txt blocks this path${a.rule ? ` (${a.rule.type}: ${a.rule.path})` : ''}.`]); }
    const indexable = !reasons.some(([l]) => l === 'bad');
    const tiles = nav ? [['TTFB', `${nav.ttfb} ms`], ['DOM ready', nav.dom ? `${nav.dom} ms` : '—'], ['Loaded', nav.load ? `${nav.load} ms` : '—'], ['Transfer', nav.transfer ? formatBytes(nav.transfer) : '—'], ['Protocol', nav.protocol || '—'], ['Redirects', String(nav.redirects)]] : [];
    let hdr = '';
    if (headers === 'loading' || headers === null) hdr = '<div class="seo-load"><i class="seo-spin"></i>Loading response headers…</div>';
    else if (headers.error) hdr = `<div class="seo-note bad">${dot('bad')}Could not load the headers (${esc(headers.error)}). <button class="seo-lk" data-act="reload-headers">Try again</button></div>`;
    else {
      const sec = headers.headers.security;
      hdr = `
        <h4>Response headers <small>${headers.ms} ms${headers.redirected ? ' · redirected' : ''}</small></h4>
        ${headers.headers.seo.map(([k, v]) => `<div class="seo-hr ${k === 'x-robots-tag' ? 'hi' : ''}"><code>${esc(k)}</code><span>${esc(v)}</span>${copyBtn(v)}</div>`).join('') || '<div class="seo-empty">No SEO-related headers.</div>'}
        <h4>Security headers</h4><div class="seo-chips">${sec.map(([k, on]) => chip(`${on ? '✓' : '✗'} ${k}`, on ? 'good' : 'warn')).join('')}</div>
        <details class="seo-det"><summary>All ${headers.headers.all.length} headers</summary>${headers.headers.all.map(([k, v]) => `<div class="seo-hr"><code>${esc(k)}</code><span>${esc(v)}</span></div>`).join('')}</details>`;
    }
    return `
      <div class="seo-stat ${lv}"><div class="seo-code">${code || '—'}</div><div><h3>${code ? esc(statusText(code) || 'Response') : 'Status unknown'}</h3><p>${indexable ? 'This page can be indexed.' : 'This page will probably not be indexed.'}</p></div>
        <div class="seo-verdict ${indexable ? 'good' : 'bad'}">${indexable ? 'Indexable' : 'Not indexable'}</div></div>
      ${reasons.length ? `<div class="seo-sec">${reasons.map(([l, t]) => `<div class="seo-note ${l}">${dot(l)}${esc(t)}</div>`).join('')}</div>` : `<div class="seo-allgood">${icon('check', 16)}Nothing is blocking indexing.</div>`}
      ${tiles.length ? `<div class="seo-sec"><h4>Timing</h4><div class="seo-tiles">${tiles.map(([k, v]) => `<div><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('')}</div></div>` : ''}
      <div class="seo-sec">${hdr}</div>`;
  }

  async function loadHeaders() {
    headers = 'loading';
    try { headers = await fetchHeaders(location.href); } catch (e) { headers = { error: (e && e.name === 'AbortError') ? 'timed out' : 'blocked or offline' }; }
    if (!open) return;
    recheck();
    render();
  }

  /* ------------------------------- links ------------------------------- */

  const TYPE_LABEL = { internal: 'Internal', external: 'External', anchor: 'Anchor', mail: 'Email', tel: 'Phone', js: 'JavaScript', other: 'Other', invalid: 'Invalid' };
  const linkMatches = (i) => {
    const k = f.links.kind;
    if (k === 'internal' && i.type !== 'internal') return false;
    if (k === 'external' && i.type !== 'external') return false;
    if (k === 'nofollow' && !(i.nofollow || i.sponsored || i.ugc)) return false;
    if (k === 'issues' && !i.issues.length && !(linkStatus.get(i.abs) && linkStatus.get(i.abs).status >= 400)) return false;
    const s = f.links.q.trim().toLowerCase();
    return !s || (i.text + ' ' + i.href).toLowerCase().includes(s);
  };
  const statusChip = (r) => {
    if (!r) return '';
    if (r.error === 'needs-permission') return chip('needs permission', 'info');
    if (r.error) return chip(r.error, 'bad');
    return chip(`${r.status}${r.redirected ? ' ↪' : ''}`, statusLevel(r.status));
  };

  function linksList() {
    const items = report.links.items.filter(linkMatches);
    const shown = more.links ? items : items.slice(0, CAP);
    return `${shown.map((i) => `
      <button class="seo-row" data-r="${remember(i.el)}">
        <span class="seo-ty ${i.type}">${TYPE_LABEL[i.type]}</span>
        <span class="seo-rm"><b>${i.text ? esc(middleTruncate(i.text, 70)) : '<em>(no anchor text)</em>'}</b><small>${esc(middleTruncate(i.abs || i.href, 90))}</small>
          ${i.issues.length ? `<span class="seo-iss">${i.issues.map((x) => chip(x, 'warn')).join('')}</span>` : ''}</span>
        <span class="seo-rc">${i.nofollow ? chip('nofollow', 'warn') : ''}${i.sponsored ? chip('sponsored', 'warn') : ''}${i.ugc ? chip('ugc', 'warn') : ''}${i.newTab ? chip('new tab', 'info') : ''}${statusChip(linkStatus.get(i.abs))}</span>
      </button>`).join('') || '<div class="seo-empty">No links match.</div>'}
      ${items.length > shown.length ? `<button class="seo-btn wide" data-act="more-links">Show all ${items.length} links</button>` : ''}`;
  }

  function links() {
    const c = report.links.counts;
    const chips = [['all', 'All', c.total], ['internal', 'Internal', c.internal], ['external', 'External', c.external], ['nofollow', 'Nofollow', c.nofollow], ['issues', 'Issues', c.issues]];
    const st = [...linkStatus.values()];
    const broken = st.filter((r) => r.status >= 400 || (r.error && r.error !== 'needs-permission')).length;
    return `
      <div class="seo-tools">
        <div class="seo-chipbar">${chips.map(([k, l, n]) => `<button class="seo-fc2${f.links.kind === k ? ' on' : ''}" data-f="links:${k}">${l}<small>${n}</small></button>`).join('')}</div>
        <div class="seo-tr"><input class="seo-search" data-s="links" type="text" value="${esc(f.links.q)}" placeholder="Search links…" spellcheck="false" aria-label="Search links">
          <button class="seo-btn" data-act="check-links" ${checkingLinks ? 'disabled' : ''}>${checkingLinks ? '<i class="seo-spin dark"></i>Checking…' : `${icon('refresh', 13)}Check status`}</button>
          <button class="seo-btn" data-act="copy-csv">${icon('download', 13)}CSV</button></div>
        ${st.length ? `<div class="seo-note ${broken ? 'bad' : 'good'}">${dot(broken ? 'bad' : 'good')}${st.length} checked: ${broken ? `${broken} broken or unreachable` : 'all reachable'}.${linkNeedsPermission ? ' Links to other sites need the all-sites permission (Settings).' : ''}</div>` : ''}
      </div>
      <div class="seo-list" data-list="links">${linksList()}</div>`;
  }

  async function runLinkCheck() {
    if (checkingLinks) return;
    const urls = [...new Set(report.links.items.filter((i) => (i.type === 'internal' || i.type === 'external') && i.abs).map((i) => i.abs))].slice(0, 300);
    if (!urls.length) return;
    checkingLinks = true; linkCancel = false; linkNeedsPermission = false;
    render();
    let n = 0;
    await checkLinks(urls, (u, r) => {
      linkStatus.set(u, r);
      if (r.error === 'needs-permission') linkNeedsPermission = true;
      if (++n % 8 === 0 && open && tab === 'links') refreshList('links');
    }, { isCancelled: () => linkCancel || !open });
    checkingLinks = false;
    if (open) render();
  }

  /* ------------------------------- images ------------------------------- */

  const sizeIndex = () => {
    const m = new Map();
    try { for (const e of performance.getEntriesByType('resource')) { const s = e.transferSize || e.encodedBodySize; if (s) m.set(e.name, s); } } catch (_) { /* unavailable */ }
    return m;
  };
  const imgMatches = (i) => {
    const k = f.images.kind;
    if (k === 'noalt' && i.altState !== 'missing') return false;
    if (k === 'empty' && i.altState !== 'empty') return false;
    if (k === 'big' && !i.issues.some((x) => x.startsWith('Oversized'))) return false;
    if (k === 'issues' && !i.issues.length) return false;
    const s = f.images.q.trim().toLowerCase();
    return !s || (i.alt + ' ' + i.src).toLowerCase().includes(s);
  };
  function imagesList() {
    const sizes = sizeIndex();
    const items = report.images.items.filter(imgMatches);
    const shown = more.images ? items : items.slice(0, CAP);
    return `${shown.map((i) => {
      const sz = sizes.get(i.src) || cachedSize(i.src);
      const file = (() => { try { return decodeURIComponent(new URL(i.src, location.href).pathname.split('/').pop()) || i.src; } catch (_) { return i.src; } })();
      return `<button class="seo-row img" data-r="${remember(i.el)}">
        <span class="seo-th"><img src="${esc(i.src)}" alt="" loading="lazy"></span>
        <span class="seo-rm"><b>${esc(middleTruncate(file, 48))}</b>
          <small>${i.altState === 'ok' ? `alt: “${esc(middleTruncate(i.alt, 70))}”` : i.altState === 'empty' ? 'alt is empty (decorative)' : '<span class="seo-bad">no alt attribute</span>'}</small>
          ${i.issues.length ? `<span class="seo-iss">${i.issues.map((x) => chip(x, 'warn')).join('')}</span>` : ''}</span>
        <span class="seo-rc"><span class="seo-dim">${i.nw ? `${i.nw}×${i.nh}` : '—'}${i.rw && (i.rw !== i.nw) ? ` → ${i.rw}×${i.rh}` : ''}</span>
          ${i.format ? chip(i.format.toUpperCase(), 'info') : ''}${i.loading === 'lazy' ? chip('lazy', 'good') : ''}${sz ? chip(formatBytes(sz), sz > 300000 ? 'warn' : '') : ''}</span>
      </button>`;
    }).join('') || '<div class="seo-empty">No images match.</div>'}
      ${items.length > shown.length ? `<button class="seo-btn wide" data-act="more-images">Show all ${items.length} images</button>` : ''}`;
  }
  function images() {
    const c = report.images.counts;
    const chips = [['all', 'All', c.total], ['noalt', 'No alt', c.missingAlt], ['empty', 'Empty alt', c.emptyAlt], ['big', 'Oversized', c.oversized], ['issues', 'Issues', c.issues]];
    return `
      <div class="seo-tools">
        <div class="seo-chipbar">${chips.map(([k, l, n]) => `<button class="seo-fc2${f.images.kind === k ? ' on' : ''}" data-f="images:${k}">${l}<small>${n}</small></button>`).join('')}</div>
        <div class="seo-tr"><input class="seo-search" data-s="images" type="text" value="${esc(f.images.q)}" placeholder="Search images…" spellcheck="false" aria-label="Search images">
          <button class="seo-btn" data-act="check-sizes">${icon('scan', 13)}File sizes</button></div>
      </div>
      <div class="seo-list" data-list="images">${imagesList()}</div>`;
  }
  async function checkSizes() {
    const sizes = sizeIndex();
    const todo = report.images.items.filter((i) => !sizes.get(i.src) && cachedSize(i.src) === undefined && /^https?:/.test(i.src)).slice(0, 80);
    let n = 0;
    await Promise.all(todo.map((i) => getFileSize(i.src).then(() => { if (++n % 6 === 0 && open && tab === 'images') refreshList('images'); }).catch(() => {})));
    if (open && tab === 'images') refreshList('images');
  }

  /* ------------------------------- schema ------------------------------- */

  function schema() {
    const s = report.schema;
    if (!s.total && !s.errors) {
      return `<div class="seo-emptybig">${icon('file', 30)}<h3>No structured data found</h3><p>Schema.org markup (JSON-LD, microdata or RDFa) can earn rich results such as stars, FAQs and breadcrumbs.</p></div>`;
    }
    const blocks = s.blocks.map((b, bi) => {
      const key = `b${bi}`;
      const isOpen = openJson.has(key);
      return `<div class="seo-card ${b.error ? 'bad' : ''}">
        <div class="seo-ch"><span class="seo-ico">${icon('file', 15)}</span><b>JSON-LD ${bi + 1}</b>${b.types.map((t) => chip(t, 'info')).join('')}${b.error ? chip('invalid JSON', 'bad') : chip('valid JSON', 'good')}
          <button class="seo-btn sm" data-json="${key}">${isOpen ? 'Hide' : 'View'}</button>${copyBtn(b.pretty, 'Copy JSON')}</div>
        ${b.error ? `<div class="seo-note bad">${dot('bad')}${esc(b.error)}</div>` : ''}
        ${b.entities.map((e) => `<div class="seo-ent"><b>${esc(e.types.join(', '))}</b>${e.name ? `<span>${esc(middleTruncate(e.name, 60))}</span>` : ''}
          ${e.missing.length ? `<div class="seo-note warn">${dot('warn')}Recommended properties missing: ${e.missing.map((m) => `<code>${esc(m)}</code>`).join(' ')}</div>` : `<small class="seo-okt">${icon('check', 12)}Has the usual required properties</small>`}</div>`).join('')}
        ${isOpen ? `<pre class="seo-pre">${esc(b.pretty)}</pre>` : ''}
      </div>`;
    }).join('');
    const other = (s.microdata.length || s.rdfa.length) ? `<div class="seo-card"><div class="seo-ch"><span class="seo-ico">${icon('section', 15)}</span><b>Other markup</b></div>
      ${s.microdata.length ? `<div class="seo-ent"><b>Microdata</b><span>${s.microdata.map((t) => chip(t, 'info')).join('')}</span></div>` : ''}
      ${s.rdfa.length ? `<div class="seo-ent"><b>RDFa</b><span>${s.rdfa.map((t) => chip(t, 'info')).join('')}</span></div>` : ''}</div>` : '';
    return `<div class="seo-bar2"><div class="seo-cnts"><span><b>Items</b>${s.total}</span><span class="${s.errors ? '' : 'zero'}"><b>Errors</b>${s.errors}</span><span class="${s.missing ? '' : 'zero'}"><b>Incomplete</b>${s.missing}</span></div></div>${blocks}${other}`;
  }

  /* ------------------------------- social ------------------------------- */

  function probeOgImage() {
    const u = report.social.og.image || '';
    if (!u || ogImage.url === u) return;
    ogImage.url = u; ogImage.ok = null;
    const im = new Image();
    im.onload = () => { if (ogImage.url === u) { ogImage.w = im.naturalWidth; ogImage.h = im.naturalHeight; ogImage.ok = true; if (open && tab === 'social') render(); } };
    im.onerror = () => { if (ogImage.url === u) { ogImage.ok = false; if (open && tab === 'social') render(); } };
    im.src = u;
  }
  function social() {
    const s = report.social, og = s.og, tw = s.twitter;
    const domain = (() => { try { return new URL(report.meta.url).hostname.replace(/^www\./, ''); } catch (_) { return ''; } })();
    const img = (u) => (u ? `<div class="seo-pimg"><img src="${esc(u)}" alt=""></div>` : '<div class="seo-pimg none">No image</div>');
    const title = og.title || tw.title || report.meta.title, desc = og.description || tw.description || report.meta.description;
    const row = (k, v, ok = true) => `<div class="seo-tg ${v ? '' : 'miss'}"><code>${esc(k)}</code><span>${v ? esc(middleTruncate(v, 90)) : 'missing'}</span>${v ? copyBtn(v) : dot(ok ? 'warn' : 'bad')}</div>`;
    const imgInfo = ogImage.ok === true ? `${chip(`${ogImage.w}×${ogImage.h}`, ogImage.w >= 1200 && ogImage.h >= 600 ? 'good' : 'warn')}${ogImage.w >= 1200 && ogImage.h >= 600 ? '' : '<small class="seo-sm"> 1200×630 is recommended</small>'}` : ogImage.ok === false ? chip('image failed to load', 'bad') : '';
    return `
      <div class="seo-prev">
        <div class="seo-pc fb"><div class="seo-pl">Facebook · LinkedIn</div>${img(og.image)}<div class="seo-pt"><small>${esc(domain.toUpperCase())}</small><b>${esc(middleTruncate(title || 'No title', 90))}</b><span>${esc(middleTruncate(desc || '', 140))}</span></div></div>
        <div class="seo-pc tw"><div class="seo-pl">X (Twitter) · ${esc(tw.card || 'summary')}</div>${img(tw.image || og.image)}<div class="seo-pt"><b>${esc(middleTruncate(tw.title || title || 'No title', 70))}</b><span>${esc(middleTruncate(tw.description || desc || '', 120))}</span><small>${icon('link', 11)} ${esc(domain)}</small></div></div>
      </div>
      ${imgInfo ? `<div class="seo-imginfo">og:image ${imgInfo}</div>` : ''}
      ${s.issues.length ? `<div class="seo-sec">${s.issues.map((i) => `<div class="seo-note ${i.level === 'info' ? 'info' : i.level}">${dot(i.level)}${esc(i.text)}</div>`).join('')}</div>` : `<div class="seo-allgood">${icon('check', 16)}All the important social tags are set.</div>`}
      <div class="seo-sec"><h4>Open Graph</h4>${['title', 'description', 'image', 'url', 'type', 'site_name', 'locale'].map((k) => row(`og:${k}`, og[k], k === 'type' || k === 'site_name' || k === 'locale')).join('')}</div>
      <div class="seo-sec"><h4>Twitter card</h4>${['card', 'title', 'description', 'image', 'site', 'creator'].map((k) => row(`twitter:${k}`, tw[k], k !== 'card')).join('')}</div>`;
  }

  /* ----------------------------- resources ----------------------------- */

  const RES_TYPES = [['script', 'Scripts'], ['style', 'Styles'], ['image', 'Images'], ['font', 'Fonts'], ['fetch', 'Fetch / XHR'], ['other', 'Other']];
  function resList() {
    const k = f.resources.kind;
    let items = resources.items.slice();
    if (k === 'third') items = items.filter((i) => i.thirdParty);
    else if (k === 'blocking') items = items.filter((i) => i.blocking);
    else if (k !== 'all') items = items.filter((i) => i.type === k);
    items.sort((a, b) => b.size - a.size || b.duration - a.duration);
    const max = Math.max(1, ...items.map((i) => i.size));
    const shown = more.resources ? items : items.slice(0, CAP);
    const short = (u) => { try { const x = new URL(u); return `${x.hostname}${x.pathname}`; } catch (_) { return u; } };
    return `${shown.map((i) => `<div class="seo-row res"><span class="seo-ty ${i.type}">${esc(i.type)}</span>
      <span class="seo-rm"><b title="${esc(i.url)}">${esc(middleTruncate(short(i.url), 64))}</b><i class="seo-rb"><u style="width:${Math.max(2, (i.size / max) * 100)}%"></u></i></span>
      <span class="seo-rc">${i.blocking ? chip('blocking', 'warn') : ''}${i.thirdParty ? chip('3rd party', 'info') : ''}${i.cached ? chip('cached', 'good') : ''}<span class="seo-dim">${i.size ? formatBytes(i.size) : '—'} · ${i.duration} ms</span></span></div>`).join('') || '<div class="seo-empty">No requests match.</div>'}
      ${items.length > shown.length ? `<button class="seo-btn wide" data-act="more-resources">Show all ${items.length}</button>` : ''}`;
  }
  function resourcesTab() {
    const r = resources;
    const tile = (k, v, sub = '') => `<div><span>${esc(k)}</span><b>${esc(v)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</div>`;
    const bt = (t) => r.byType[t] || { count: 0, size: 0 };
    const chips = [['all', 'All', r.requests], ...RES_TYPES.map(([id, l]) => [id, l, bt(id).count]), ['third', '3rd party', r.thirdParty], ['blocking', 'Blocking', r.blocking]];
    return `
      <div class="seo-tiles big">${tile('Requests', String(r.requests))}${tile('Transferred', formatBytes(r.total))}${tile('Scripts', String(bt('script').count), formatBytes(bt('script').size))}${tile('Styles', String(bt('style').count), formatBytes(bt('style').size))}${tile('Images', String(bt('image').count), formatBytes(bt('image').size))}${tile('3rd-party hosts', String(r.hosts.length), r.thirdParty + ' requests')}</div>
      ${r.blocking ? `<div class="seo-note warn">${dot('warn')}${r.blocking} render-blocking resource${r.blocking > 1 ? 's' : ''} delay the first paint.</div>` : ''}
      <div class="seo-tools"><div class="seo-chipbar">${chips.map(([k, l, n]) => `<button class="seo-fc2${f.resources.kind === k ? ' on' : ''}" data-f="resources:${k}">${l}<small>${n}</small></button>`).join('')}</div></div>
      <div class="seo-list" data-list="resources">${resList()}</div>
      <div class="seo-sm seo-foot2">Sizes come from the browser's resource timing. Cross-origin files without a timing header can show “—”.</div>`;
  }

  /* ------------------------ list refresh (no re-render) ------------------------ */

  function refreshList(which) {
    const node = body.querySelector(`[data-list="${which}"]`);
    if (!node) return;
    const top = body.scrollTop;
    node.innerHTML = ({ links: linksList, images: imagesList, resources: resList })[which]();
    body.scrollTop = top;
  }

  /* ------------------------------- drawer ------------------------------- */

  const lineClass = (line) => { const t = line.trim().toLowerCase(); return t.startsWith('disallow') ? 'dis' : t.startsWith('allow') ? 'alw' : t.startsWith('sitemap') ? 'smp' : t.startsWith('user-agent') ? 'uag' : t.startsWith('#') ? 'cmt' : ''; };

  async function loadRobots() {
    if (robots.state === 'loading' || robots.state === 'done') return;
    robots.state = 'loading'; robots.url = `${origin()}/robots.txt`;
    renderDrawer();
    try {
      const r = await fetchText(robots.url);
      robots.status = r.status;
      if (!r.ok) { robots.state = 'missing'; } else { robots.text = r.text; robots.parsed = parseRobots(r.text); robots.state = 'done'; }
    } catch (_) { robots.state = 'error'; robots.error = 'The browser could not load it.'; }
    if (open && tab === 'status') render(); else renderDrawer();
  }

  async function loadSitemap(url) {
    sitemap.state = 'loading'; sitemap.error = ''; sitemap.q = ''; sitemap.all = false;
    renderDrawer();
    if (!url) {
      if (robots.state === 'idle') await loadRobots();
      url = (robots.parsed && robots.parsed.sitemaps[0]) || `${origin()}/sitemap.xml`;
    }
    sitemap.url = url;
    try {
      const r = await fetchText(url);
      if (!r.ok) { sitemap.state = 'error'; sitemap.error = `The server answered ${r.status}.`; } else {
        sitemap.parsed = parseSitemap(r.text);
        sitemap.state = sitemap.parsed.type === 'invalid' || sitemap.parsed.type === 'unknown' ? 'error' : 'done';
        if (sitemap.state === 'error') sitemap.error = 'This is not a valid sitemap.';
      }
    } catch (_) { sitemap.state = 'error'; sitemap.error = 'The browser blocked the request (the sitemap may be on another site).'; }
    renderDrawer();
  }

  function renderDrawer() {
    if (!drawerKind) { drawer.hidden = true; return; }
    drawer.hidden = false;
    const head = (t, url) => `<div class="seo-dh"><button class="seo-hb" data-act="close-drawer" aria-label="Back">${icon('up', 15)}</button><b>${esc(t)}</b><span class="seo-sm">${esc(middleTruncate(url || '', 50))}</span>${url ? `<a class="seo-hb" href="${esc(url)}" target="_blank" rel="noopener noreferrer" data-tip="Open in a new tab" aria-label="Open in a new tab">${icon('external', 14)}</a>` : ''}</div>`;
    if (drawerKind === 'robots') {
      const rb = robots;
      let content = '';
      if (rb.state === 'loading' || rb.state === 'idle') content = '<div class="seo-load"><i class="seo-spin"></i>Loading robots.txt…</div>';
      else if (rb.state === 'missing') content = `<div class="seo-emptybig">${icon('alert', 28)}<h3>No robots.txt</h3><p>The server answered ${rb.status}. Without one, crawlers may fetch everything.</p></div>`;
      else if (rb.state === 'error') content = `<div class="seo-note bad">${dot('bad')}${esc(rb.error)}</div>`;
      else {
        const a = robotsAllows(rb.parsed, pathOf(), '*'), g = robotsAllows(rb.parsed, pathOf(), 'Googlebot');
        const verdict = (n, r) => `<div class="seo-note ${r.allowed ? 'good' : 'bad'}">${dot(r.allowed ? 'good' : 'bad')}<b>${n}</b>: this page is ${r.allowed ? 'allowed' : 'blocked'}${r.rule ? ` by <code>${esc(r.rule.type)}: ${esc(r.rule.path)}</code>` : ''}.</div>`;
        content = `${verdict('All crawlers (*)', a)}${verdict('Googlebot', g)}
          ${rb.parsed.sitemaps.length ? `<h4>Sitemaps</h4>${rb.parsed.sitemaps.map((s) => `<button class="seo-lk blk" data-sitemap="${remember(s)}">${icon('globe', 13)}${esc(middleTruncate(s, 70))}</button>`).join('')}` : ''}
          <h4>File <small>${rb.text.split(/\r?\n/).length} lines</small>${copyBtn(rb.text, 'Copy robots.txt')}</h4>
          <pre class="seo-pre robots">${rb.text.split(/\r?\n/).map((l) => `<span class="${lineClass(l)}">${esc(l) || ' '}</span>`).join('')}</pre>`;
      }
      drawer.innerHTML = head('robots.txt', rb.url) + `<div class="seo-db">${content}</div>`;
    } else {
      const sm = sitemap;
      let content = '';
      if (sm.state === 'loading' || sm.state === 'idle') content = '<div class="seo-load"><i class="seo-spin"></i>Loading sitemap…</div>';
      else if (sm.state === 'error') content = `<div class="seo-emptybig">${icon('alert', 28)}<h3>Could not read the sitemap</h3><p>${esc(sm.error)}</p></div>`;
      else {
        const p = sm.parsed;
        const found = p.type === 'urlset' ? p.urls.some((u) => sameUrl(u.loc, report.meta.url)) : null;
        const s = sm.q.trim().toLowerCase();
        const list = p.type === 'index' ? p.sitemaps : p.urls;
        const rows = list.filter((x) => !s || x.loc.toLowerCase().includes(s));
        const shown = sm.all ? rows : rows.slice(0, 100);
        content = `
          <div class="seo-tiles"><div><span>Type</span><b>${p.type === 'index' ? 'Index' : 'URL set'}</b></div><div><span>${p.type === 'index' ? 'Sitemaps' : 'URLs'}</span><b>${list.length.toLocaleString('en-US')}</b></div>
            ${found === null ? '' : `<div><span>This page</span><b class="${found ? 'okc' : 'badc'}">${found ? 'Listed ✓' : 'Not listed'}</b></div>`}</div>
          ${found === false ? `<div class="seo-note warn">${dot('warn')}This page is not in this sitemap (it may be in another one).</div>` : ''}
          <input class="seo-search wide" data-s="sitemap" type="text" value="${esc(sm.q)}" placeholder="Search ${p.type === 'index' ? 'sitemaps' : 'URLs'}…" spellcheck="false" aria-label="Search sitemap">
          <div class="seo-sl">${shown.map((x) => (p.type === 'index'
            ? `<button class="seo-lk blk" data-sitemap="${remember(x.loc)}">${icon('globe', 13)}${esc(middleTruncate(x.loc, 70))}</button>`
            : `<div class="seo-su${sameUrl(x.loc, report.meta.url) ? ' me' : ''}"><a class="seo-a" href="${esc(x.loc)}" target="_blank" rel="noopener noreferrer">${esc(middleTruncate(x.loc, 76))}</a>${x.lastmod ? `<small>${esc(x.lastmod.slice(0, 10))}</small>` : ''}</div>`)).join('') || '<div class="seo-empty">Nothing matches.</div>'}</div>
          ${rows.length > shown.length ? `<button class="seo-btn wide" data-act="more-sitemap">Show all ${rows.length.toLocaleString('en-US')}</button>` : ''}`;
      }
      drawer.innerHTML = head('Sitemap', sitemap.url) + `<div class="seo-db">${content}</div>`;
    }
  }

  function openDrawer(kind) {
    drawerKind = kind;
    if (kind === 'robots') { renderDrawer(); loadRobots(); } else { if (sitemap.state === 'idle' || sitemap.state === 'error') loadSitemap(''); else renderDrawer(); }
  }
  function closeDrawer() { drawerKind = ''; drawer.hidden = true; }

  /* -------------------------------- events -------------------------------- */

  for (const t of ['keydown', 'keyup', 'keypress']) el.addEventListener(t, (e) => e.stopPropagation());

  const pulse = (btn) => { btn.classList.add('ok'); setTimeout(() => btn.classList.remove('ok'), 900); };

  el.addEventListener('click', async (e) => {
    const t = e.target;
    const tabBtn = t.closest('[data-tab]');
    if (tabBtn) { tab = tabBtn.dataset.tab; closeDrawer(); render({ keepScroll: false }); body.scrollTop = 0; return; }
    const cp = t.closest('[data-copy]');
    if (cp) { const ok = await onCopy(reg[Number(cp.dataset.copy)]); if (ok) pulse(cp); return; }
    const dr = t.closest('[data-drawer]');
    if (dr) { openDrawer(dr.dataset.drawer); return; }
    const sm = t.closest('[data-sitemap]');
    if (sm) { drawerKind = 'sitemap'; loadSitemap(reg[Number(sm.dataset.sitemap)]); return; }
    const fl = t.closest('[data-f]');
    if (fl) { const [w, k] = fl.dataset.f.split(':'); f[w].kind = k; more[w] = false; render(); return; }
    const js = t.closest('[data-json]');
    if (js) { const k = js.dataset.json; if (openJson.has(k)) openJson.delete(k); else openJson.add(k); render(); return; }
    const rv = t.closest('[data-r]');
    if (rv && !t.closest('a')) { onReveal(reg[Number(rv.dataset.r)]); return; }
    const a = t.closest('[data-act]');
    if (!a) return;
    switch (a.dataset.act) {
      case 'close': onClose(); break;
      case 'refresh': collect(); if (tab === 'status') { headers = null; } render(); break;
      case 'close-drawer': closeDrawer(); break;
      case 'copy-outline': { const ok = await onCopy(headingsMarkdown(report.headings)); if (ok) pulse(a); break; }
      case 'copy-csv': { const ok = await onCopy(linksCsv(report.links)); if (ok) pulse(a); break; }
      case 'check-links': runLinkCheck(); break;
      case 'check-sizes': checkSizes(); break;
      case 'reload-headers': headers = null; render(); break;
      case 'more-links': more.links = true; refreshList('links'); render(); break;
      case 'more-images': more.images = true; render(); break;
      case 'more-resources': more.resources = true; render(); break;
      case 'more-sitemap': sitemap.all = true; renderDrawer(); break;
      default: break;
    }
  });

  el.addEventListener('input', (e) => {
    const s = e.target.closest && e.target.closest('[data-s]');
    if (!s) return;
    const w = s.dataset.s;
    if (w === 'sitemap') { sitemap.q = s.value; const pos0 = s.selectionStart; renderDrawer(); const n = drawer.querySelector('[data-s="sitemap"]'); if (n) { n.focus(); n.setSelectionRange(pos0, pos0); } return; }
    f[w].q = s.value; more[w] = false;
    refreshList(w);
  });

  el.addEventListener('mouseover', (e) => { const r = e.target.closest && e.target.closest('[data-r]'); if (r) onHover(reg[Number(r.dataset.r)]); });
  el.addEventListener('mouseout', (e) => { const r = e.target.closest && e.target.closest('[data-r]'); if (r && !(e.relatedTarget && r.contains(e.relatedTarget))) onHover(null); });

  el.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    const inField = e.target.matches && e.target.matches('input');
    if (inField) { if (e.target.value) { e.target.value = ''; e.target.dispatchEvent(new Event('input', { bubbles: true })); } else e.target.blur(); return; }
    if (drawerKind) { closeDrawer(); return; }
    onClose();
  });

  /* -------------------------------- position -------------------------------- */

  function clamp(p) {
    const vw = document.documentElement.clientWidth || window.innerWidth, vh = window.innerHeight;
    const w = el.offsetWidth || 660, hh = el.offsetHeight || 600;
    return { x: Math.round(Math.min(Math.max(p.x, MARGIN), Math.max(MARGIN, vw - w - MARGIN))), y: Math.round(Math.min(Math.max(p.y, MARGIN), Math.max(MARGIN, vh - hh - MARGIN))) };
  }
  function place(p) {
    if (p) pos = p;
    pos = clamp(pos);
    el.style.transform = `translate(${pos.x}px, ${pos.y}px)`;
  }
  const defaultPos = () => ({ x: (document.documentElement.clientWidth || window.innerWidth) - (el.offsetWidth || 660) - 18, y: 64 });

  const head = q('.seo-head');
  head.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('button, a')) return;
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

  /* -------------------------------- public -------------------------------- */

  return {
    async show() {
      if (!open) {
        open = true;
        el.style.visibility = 'hidden'; // shown only once it stands where it belongs: no flash in the corner
        el.hidden = false;
        collect();
        render({ keepScroll: false });
        let vTimer = 0;
        vitalsWatch = startVitals((v) => {
          vitals = v;
          if (!open || tab !== 'overview' || vTimer) return;
          vTimer = setTimeout(() => { vTimer = 0; if (open && tab === 'overview') render(); }, 400); // a burst of layout shifts must not re-draw the page 60 times a second
        });
        let saved = null;
        try { saved = await loadPos(); } catch (_) { /* extension context gone */ }
        if (!open) return;
        place(saved && Number.isFinite(saved.x) && Number.isFinite(saved.y) ? saved : defaultPos());
        el.style.visibility = '';
        window.addEventListener('resize', onResize, { passive: true });
      }
    },
    hide() {
      if (!open) return;
      open = false;
      linkCancel = true;
      if (vitalsWatch) vitalsWatch.stop();
      vitalsWatch = null;
      el.hidden = true;
      closeDrawer();
      onHover(null);
      window.removeEventListener('resize', onResize);
    },
    isOpen: () => open,
    destroy() { this.hide(); el.remove(); },
  };
}
