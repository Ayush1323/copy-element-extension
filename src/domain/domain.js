// Site Analyzer page: scans the website the user asks for (their click grants access to that one site), builds the report
// and keeps it, with a short history for comparisons, in this browser only.
import { applyTheme } from '../shared/themes.js';
import { getSettings, onStorageChange, getSiteLimit, saveSiteLimit, listSiteScans, getSiteScan, saveSiteScan } from '../shared/storage.js';
import { logoMark, icon } from '../shared/icons.js';
import { escapeHtml as esc } from '../shared/helpers.js';
import { writeClipboard } from '../content/clipboard/clipboard-manager.js';
import { PAGE_LIMITS, DEFAULT_LIMIT, normalizeDomain, originsFor, crawlSite } from '../shared/site-crawl.js';
import { buildReport, snapshot, changes, reportMarkdown, pagesCsv, HISTORY_SCANS, TOP_ROWS } from '../shared/site-report.js';
import { drawChart } from './chart.js';
import { createOwnAuthority, OWN_ORIGIN } from './own-authority.js';

const $ = (s, r = document) => r.querySelector(s);
const PAGE_STEP = 25;

let own = null; // the Domain Authority card
let view = null; // { report, history: [snapshot] }
let run = null; // AbortController of the scan in progress
let filter = { q: '', kind: 'all', sort: 'linkScore', shown: PAGE_STEP };
const openIssues = new Set();

const level = (score) => (score >= 75 ? 'good' : score >= 55 ? 'warn' : 'bad');
const riskLevel = (score) => (score <= 15 ? 'good' : score <= 40 ? 'warn' : 'bad');
const pathOf = (url) => url.replace(/^https?:\/\//, '');
const link = (url, text = pathOf(url)) => (/^https?:\/\//i.test(url)
  ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer" title="${esc(url)}"><span>${esc(text)}</span>${icon('external', 12)}</a>`
  : `<span>${esc(text)}</span>`);
const when = (ms) => new Date(ms).toLocaleString();
const badge = (score) => `<i class="badge ${level(score)}">${score}</i>`;

/* ------------------------------ sections ------------------------------ */

const metric = (id, label, value, sub, tone = '') => `<div class="metric" data-metric="${id}"><span>${label}</span><b class="${tone}">${value}</b><small>${esc(sub)}</small></div>`;

function summary(r) {
  return `<section class="card summary">
    <h2>Site scan of <em>${esc(r.domain)}</em></h2>
    <div class="metrics">
      ${metric('pages', 'Pages Analyzed', r.counts.pages, `${r.counts.discovered} found`)}
      ${metric('broken', 'Broken Pages', r.counts.broken, 'addresses that failed', r.counts.broken ? 'bad' : 'good')}
      ${metric('keywords', 'Content Keywords', r.keywords.found.toLocaleString(), 'words and phrases')}
      ${metric('risk', 'Spam Score', `${r.riskScore}%`, r.signals.length ? `${r.signals.length} signal${r.signals.length > 1 ? 's' : ''}` : 'no signals found', riskLevel(r.riskScore))}
    </div>
    ${r.notes.map((n) => `<p class="note">${icon('alert', 14)}<span>${esc(n)}</span></p>`).join('')}
    <div class="actions">
      <span class="when">Scanned ${esc(when(r.at))}</span>
      <button type="button" class="btn" data-act="copy">${icon('copy', 14)}Copy report</button>
      <button type="button" class="btn" data-act="csv">${icon('download', 14)}Pages CSV</button>
      <button type="button" class="btn" data-act="rescan">${icon('refresh', 14)}Scan again</button>
    </div>
  </section>`;
}

function breakdown(r) {
  const meter = (name, score) => `<li><span>${esc(name)}</span><div class="meter"><i class="${level(score)}" style="width:${score}%"></i></div><b>${score}</b></li>`;
  return `<div class="columns">
    <section class="card"><h2>Page checks</h2><p>How the scanned pages do in each area, out of 100.</p>
      <ul class="meters">${r.areas.filter((a) => a.score !== null).map((a) => meter(a.name, a.score)).join('')}</ul>
      <ul class="checks">${r.siteChecks.map((c) => `<li><i class="dot ${c.level}" title="${c.level}"></i><b>${esc(c.label)}</b><span>${esc(c.detail)}</span></li>`).join('')}</ul>
    </section>
    <section class="card" data-part="risk"><h2>Spam signals</h2><p>Patterns that search engines associate with low-quality or spammy sites. Lower is better.</p>
      ${r.signals.length
    ? `<ul class="signals">${r.signals.map((s) => `<li><b>${esc(s.label)}</b><i class="badge bad">+${s.points}%</i><span>${esc(s.detail)}</span></li>`).join('')}</ul>`
    : '<div class="state"><span>None of the checked spam patterns were found.</span></div>'}
      <p class="small">Checked: HTTPS, thin pages, duplicate titles, keyword stuffing, heavy outgoing linking, hidden links and contact / about / privacy pages.</p>
    </section>
  </div>`;
}

function issuesCard(r) {
  const body = r.issues.length ? r.issues.map((i) => `<details class="issue" data-issue="${i.id}"${openIssues.has(i.id) ? ' open' : ''}>
      <summary><i class="dot ${i.level}"></i><b>${esc(i.title)}</b><span>${i.urls.length} page${i.urls.length > 1 ? 's' : ''}</span></summary>
      <p>${esc(i.fix)}</p>
      <ul>${i.urls.slice(0, 50).map((u) => `<li>${link(u.url)}${u.note ? `<small>${esc(u.note)}</small>` : ''}</li>`).join('')}</ul>
      ${i.urls.length > 50 ? `<p class="small">${i.urls.length - 50} more are not listed here.</p>` : ''}
    </details>`).join('') : '<div class="state"><span>No problems found on the scanned pages.</span></div>';
  return `<section class="card" data-part="issues"><h2>What to fix</h2><p>Most serious first. Open a row to see the pages.</p><div class="issues">${body}</div></section>`;
}

const table = (head, rows) => `<table><thead><tr>${head.map((h) => `<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
const empty = (text) => `<div class="state"><span>${text}</span></div>`;

function tops(r) {
  return `<div class="columns">
    <section class="card" data-part="top"><h2>Top Pages by Links</h2><p>PA (Page Authority, 1–100) shows how strongly your internal links point to a page.</p>
      ${r.pages.length ? table(['Page / URL', 'Links in', 'PA'], r.pages.slice(0, TOP_ROWS).map((p) => [link(p.url), p.inlinks, p.linkScore])) : empty('No pages.')}</section>
    <section class="card" data-part="domains"><h2>Top Linked Domains</h2><p>Other websites this site links to most (${r.counts.domains} in total).</p>
      ${r.domains.length ? table(['Domain', 'Links', 'Pages'], r.domains.slice(0, TOP_ROWS).map((d) => [link(`https://${d.domain}/`, d.domain), d.links, d.pages])) : empty('No links to other websites were found.')}</section>
  </div>`;
}

function keywordsCard(r) {
  const k = r.keywords.top;
  return `<section class="card" data-part="keywords"><h2>Content Keywords</h2><p>What the site talks about most, weighted towards titles and headings. This is not search-ranking data.</p>
    ${k.length ? `<ul class="keywords">${k.map((x) => `<li style="--w:${x.score}%"><b>${esc(x.term)}</b><span>${x.count}× on ${x.pages} page${x.pages > 1 ? 's' : ''}</span></li>`).join('')}</ul>` : empty('Not enough text was found.')}</section>`;
}

function changesCard() {
  const list = changes(view.history);
  const last = list[list.length - 1];
  const names = (title, items, asLink) => (items.length ? `<details><summary>${title} (${items.length})</summary><ul>${items.slice(0, 100).map((x) => `<li>${asLink(x)}</li>`).join('')}</ul></details>` : '');
  let body;
  if (!last) body = empty('Scan this site again later with the same page limit to see what was added and what disappeared.');
  else {
    body = `<div class="legend"><span class="g">Discovered <b>${last.gained}</b></span><span class="l">Lost <b>${last.lost}</b></span><em>since ${esc(when(last.since))}</em></div>
      <div class="chart" id="chart"></div>
      <div class="diffs">
        ${names('New pages', last.newPages, (u) => link(u))}${names('Lost pages', last.lostPages, (u) => link(u))}
        ${names('New linked domains', last.newDomains, (d) => link(`https://${d}/`, d))}${names('Lost linked domains', last.lostDomains, (d) => link(`https://${d}/`, d))}
      </div>`;
  }
  return `<section class="card" data-part="changes"><h2>Discovered and Lost</h2><p>Pages and outgoing linked domains that appeared or disappeared between your scans.</p>${body}</section>`;
}

const FILTERS = [['all', 'All pages'], ['problems', 'With problems'], ['broken', 'Broken'], ['noindex', 'Noindex']];
const SORTS = [['linkScore', 'Highest PA'], ['score', 'Lowest page score'], ['words', 'Fewest words'], ['ms', 'Slowest']];

function pageRows(r) {
  const q = filter.q.trim().toLowerCase();
  let rows = filter.kind === 'broken' ? [] : r.pages.filter((p) => filter.kind === 'all' || (filter.kind === 'problems' ? p.problems : p.noindex));
  if (filter.sort === 'score') rows = [...rows].sort((a, b) => a.score - b.score);
  if (filter.sort === 'words') rows = [...rows].sort((a, b) => a.words - b.words);
  if (filter.sort === 'ms') rows = [...rows].sort((a, b) => b.ms - a.ms);
  if (filter.kind === 'all' || filter.kind === 'broken') rows = rows.concat(r.broken);
  return q ? rows.filter((p) => `${p.url} ${p.title || ''}`.toLowerCase().includes(q)) : rows;
}

function pagesBody(r) {
  const rows = pageRows(r);
  if (!rows.length) return empty('No pages match.');
  return `<div class="scroll">${table(['Page / URL', 'Score', 'Links in', 'Words', 'Time'], rows.slice(0, filter.shown).map((p) => (p.score === undefined
    ? [link(p.url), `<i class="badge bad">${p.status || 'Failed'}</i>`, '—', '—', '—']
    : [`${link(p.url)}<small>${esc(p.title || 'No title')}</small>`, badge(p.score), p.inlinks, p.words, `${(p.ms / 1000).toFixed(1)} s`])))}</div>
    ${rows.length > filter.shown ? `<button type="button" class="btn more" data-act="more">Show more (${rows.length - filter.shown} left)</button>` : ''}`;
}

function pagesCard(r) {
  const options = (list, cur) => list.map(([v, t]) => `<option value="${v}"${v === cur ? ' selected' : ''}>${t}</option>`).join('');
  return `<section class="card all" data-part="all"><h2>All scanned pages</h2>
    <div class="tools">
      <input type="search" id="q" placeholder="Search address or title" aria-label="Search pages" value="${esc(filter.q)}">
      <select id="kind" aria-label="Filter pages">${options(FILTERS, filter.kind)}</select>
      <select id="sort" aria-label="Sort pages">${options(SORTS, filter.sort)}</select>
    </div>
    <div id="page-list">${pagesBody(r)}</div></section>`;
}

function chart() {
  const box = $('#chart');
  if (box) drawChart(box, changes(view.history).slice(-20).map((c) => ({ date: new Date(c.at).toISOString().slice(0, 10), gained: c.gained, lost: c.lost })));
}

function render() {
  $('#intro').hidden = !!view || !!run;
  const box = $('#report');
  box.hidden = !view || !!run;
  if (box.hidden) return;
  const r = view.report;
  box.innerHTML = summary(r) + breakdown(r) + issuesCard(r) + tops(r) + keywordsCard(r) + changesCard() + pagesCard(r);
  chart();
}

/* ------------------------------ scanning ------------------------------ */

function formError(text) {
  const e = $('#form-error');
  e.textContent = text || '';
  e.hidden = !text;
  $('#domain').setAttribute('aria-invalid', String(!!text));
}

async function renderRecent() {
  const list = (await listSiteScans()).slice(0, 5);
  $('#recent').innerHTML = list.length ? `Recent: ${list.map((s) => `<button type="button" data-domain="${esc(s.domain)}">${esc(s.domain)}</button>`).join('')}` : '';
}

function show(domain) {
  history.replaceState(null, '', `?domain=${encodeURIComponent(domain)}`);
  document.title = `${domain} · Site Analyzer · LinkLens`;
  $('#domain').value = domain;
}

async function openSaved(domain) {
  const saved = await getSiteScan(domain);
  if (!saved) return false;
  view = saved;
  filter = { q: '', kind: 'all', sort: 'linkScore', shown: PAGE_STEP };
  openIssues.clear();
  show(domain);
  render();
  own.load(domain);
  return true;
}

async function scan(domain) {
  if (run) return;
  // Chrome asks once per site. This must be the first thing awaited, or Chrome no longer counts it as the user's click.
  let allowed = false;
  const origins = [...originsFor(domain), OWN_ORIGIN];
  try { allowed = await chrome.permissions.request({ origins }); } catch (_) {
    try { allowed = await chrome.permissions.contains({ origins: originsFor(domain) }); } catch (e) { allowed = false; }
  }
  if (!allowed) { formError(`Chrome needs your permission to read ${domain}.`); return; }
  if (run) return;
  const ctl = new AbortController();
  run = ctl;
  formError('');
  show(domain);
  own.load(domain, { request: true }); // runs beside the scan
  const limit = Number($('#limit').value) || DEFAULT_LIMIT;
  $('#go').disabled = true;
  $('#limit').disabled = true;
  $('#progress').hidden = false;
  $('#p-title').textContent = `Scanning ${domain}…`;
  $('#p-url').textContent = 'Reading the home page, robots.txt and sitemap';
  const bar = $('#p-bar');
  bar.setAttribute('aria-valuemax', String(limit));
  const progress = (done, url) => {
    bar.firstElementChild.style.width = `${Math.round((done / limit) * 100)}%`;
    bar.setAttribute('aria-valuenow', String(done));
    if (done) $('#p-title').textContent = `Scanning ${domain}: ${done} of up to ${limit} pages`;
    if (url && done) $('#p-url').textContent = pathOf(url);
  };
  progress(0);
  render();
  try {
    const crawl = await crawlSite(domain, { limit, signal: ctl.signal, onProgress: (p) => progress(p.done, p.url) });
    $('#p-title').textContent = 'Building the report…';
    const report = buildReport(crawl);
    const previous = await getSiteScan(domain);
    const hist = [...((previous && previous.history) || []), snapshot(report)].slice(-HISTORY_SCANS);
    view = { report, history: hist };
    filter = { q: '', kind: 'all', sort: 'linkScore', shown: PAGE_STEP };
    openIssues.clear();
    try { await saveSiteScan(domain, view); } catch (_) { formError('The report could not be saved (browser storage is full). It is shown below.'); }
    await renderRecent();
  } catch (e) {
    if (e.name !== 'AbortError') formError(e.message || 'The scan failed.');
    // an earlier report of this site (if any) stays available
    view = await getSiteScan(domain);
  } finally {
    run = null;
    $('#go').disabled = false;
    $('#limit').disabled = false;
    $('#progress').hidden = true;
    render();
  }
}

/** Only the Domain Authority, without scanning the site. */
async function checkAuthority() {
  const domain = normalizeDomain($('#domain').value);
  if (!domain) { formError('Enter a website such as example.com.'); $('#domain').focus(); return; }
  formError('');
  let allowed = false;
  try { allowed = await chrome.permissions.request({ origins: [OWN_ORIGIN] }); } catch (_) { /* denied */ }
  if (!allowed) { formError('Chrome needs your permission to check authority.'); return; }
  if (!run && view && view.report.domain !== domain) { view = await getSiteScan(domain); render(); }
  show(domain);
  await own.load(domain, { request: true });
}

/* ------------------------------ events ------------------------------ */

function onSubmit(e) {
  e.preventDefault();
  const domain = normalizeDomain($('#domain').value);
  if (!domain) { formError('Enter a website such as example.com.'); $('#domain').focus(); return; }
  scan(domain);
}

function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([`﻿${text}`], { type: 'text/csv;charset=utf-8' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

async function onReportClick(e) {
  const b = e.target.closest('button[data-act]');
  if (!b || !view) return;
  const r = view.report;
  if (b.dataset.act === 'rescan') { scan(r.domain); return; }
  if (b.dataset.act === 'more') { filter.shown += PAGE_STEP * 2; $('#page-list').innerHTML = pagesBody(r); return; }
  if (b.dataset.act === 'csv') { download(`${r.domain}-pages.csv`, pagesCsv(r)); return; }
  const res = await writeClipboard({ text: reportMarkdown(r, own.data(r.domain)) });
  const label = b.innerHTML;
  b.textContent = res.ok ? 'Copied' : 'Copy failed';
  setTimeout(() => { b.innerHTML = label; }, 1600);
}

async function init() {
  const [settings, savedLimit] = await Promise.all([getSettings(), getSiteLimit()]);
  applyTheme(document.documentElement, settings.theme);
  $('#logo').innerHTML = logoMark(30);
  $('#limit').innerHTML = PAGE_LIMITS.map((n) => `<option value="${n}">${n} pages</option>`).join('');
  $('#limit').value = String(PAGE_LIMITS.includes(savedLimit) ? savedLimit : DEFAULT_LIMIT);

  own = createOwnAuthority($('#own'));
  $('#check-authority').addEventListener('click', checkAuthority);
  $('#form').addEventListener('submit', onSubmit);
  $('#limit').addEventListener('change', () => saveSiteLimit(Number($('#limit').value)));
  $('#stop').addEventListener('click', () => { if (run) { run.abort(); $('#p-title').textContent = 'Stopping…'; } });
  $('#domain').addEventListener('input', () => formError(''));
  $('#recent').addEventListener('click', (e) => { const b = e.target.closest('button[data-domain]'); if (b && !run) { formError(''); openSaved(b.dataset.domain); } });
  const report = $('#report');
  report.addEventListener('click', onReportClick);
  report.addEventListener('toggle', (e) => {
    const id = e.target.dataset && e.target.dataset.issue;
    if (id) { if (e.target.open) openIssues.add(id); else openIssues.delete(id); }
  }, true);
  const refilter = (e) => {
    if (!['q', 'kind', 'sort'].includes(e.target.id) || !view) return;
    filter[e.target.id] = e.target.value;
    filter.shown = PAGE_STEP;
    $('#page-list').innerHTML = pagesBody(view.report); // only the list: the search box keeps its focus
  };
  report.addEventListener('input', refilter);
  report.addEventListener('change', refilter);
  let resize = 0;
  window.addEventListener('resize', () => { clearTimeout(resize); resize = setTimeout(() => { if (view && !run) chart(); }, 120); });
  window.addEventListener('beforeunload', (e) => { if (run) e.preventDefault(); }); // a scan would be lost
  onStorageChange(async () => applyTheme(document.documentElement, (await getSettings()).theme));

  await renderRecent();
  // arriving from the popup only fills the box in (and shows the last report, if there is one): scanning is the user's click
  const domain = normalizeDomain(new URLSearchParams(location.search).get('domain'));
  if (domain) { $('#domain').value = domain; if (!(await openSaved(domain))) await own.load(domain); }
  $('#domain').focus();
}

init().catch((e) => { console.error(e); formError(`Something went wrong: ${e && e.message}`); });
