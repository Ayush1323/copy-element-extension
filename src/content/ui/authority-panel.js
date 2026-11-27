import { h } from './shadow-root-ui.js';
import { icon } from '../../shared/icons.js';
import { MSG } from '../../shared/message-types.js';
import { parseDomainInput, scoreAuthority, reportText, formatDate, formatAge, TIERS } from '../../shared/authority.js';

const MARGIN = 6;
const SOURCES = [
  ['tranco', 'Tranco popularity rank'],
  ['opr', 'Open PageRank link graph'],
  ['rdap', 'Registry (RDAP)'],
  ['archive', 'Wayback Machine'],
  ['dns', 'DNS & e-mail security'],
];

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ESC[c]);
const chip = (text, level = '') => `<span class="seo-chip ${level}">${esc(text)}</span>`;
const dot = (level) => `<i class="seo-dot ${level}"></i>`;
const compact = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}k` : String(Math.round(n))).replace('.0', '');
const num = (n) => (n == null || !Number.isFinite(n) ? '—' : Math.round(n).toLocaleString('en-US'));
export const daColor = (s) => (s >= 80 ? '#15803D' : s >= 65 ? '#16A34A' : s >= 50 ? '#65A30D' : s >= 35 ? '#CA8A04' : s >= 20 ? '#EA580C' : '#DC2626');
const ago = (t) => {
  if (!t) return '';
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
};

/**
 * Domain Authority: a floating, draggable panel. Analyses the current site's root domain (or any domain typed in) from
 * public data sources fetched by the background worker, then scores it with the model in src/shared/authority.js.
 */
export function createAuthorityPanel(ui, { onCopy, onClose, loadPos, savePos }) {
  const el = h('div', 'seo da', `
    <div class="seo-head">
      <span class="seo-grip" title="Drag to move" aria-hidden="true">${icon('grip', 14)}</span>
      <span class="seo-logo">${icon('authority', 17)}</span>
      <div class="seo-ttl"><b>Domain Authority</b><span class="seo-host"></span></div>
      <div class="seo-mini" title="Domain Authority"><b>–</b></div>
      <button class="seo-hb" data-act="refresh" data-tip="Fetch fresh data" aria-label="Fetch fresh data">${icon('refresh', 15)}</button>
      <button class="seo-hb" data-act="close" data-tip="Close" aria-label="Close Domain Authority">${icon('x', 15)}</button>
    </div>
    <form class="da-bar" autocomplete="off">
      <span class="da-in">${icon('globe', 15)}<input class="da-q" type="text" spellcheck="false" autocapitalize="off" placeholder="Analyse any domain, e.g. example.com" aria-label="Domain to analyse"></span>
      <button class="da-go" type="submit">${icon('search', 14)}Analyse</button>
    </form>
    <div class="da-recent" hidden></div>
    <div class="seo-body da-body"></div>
    <div class="seo-foot da-foot"></div>`);
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Domain Authority');
  el.tabIndex = -1;
  el.hidden = true;
  ui.layer.appendChild(el);

  const q = (s) => el.querySelector(s);
  const body = q('.da-body'), foot = q('.da-foot'), input = q('.da-q'), form = q('.da-bar'), recentEl = q('.da-recent'), mini = q('.seo-mini');

  let open = false;
  let pos = { x: 0, y: 0 };
  let drag = null;
  let target = null; // parseDomainInput result
  let src = {}; // source → data | { error } ; missing = loading
  let meta = {}; // source → { at, cached }
  let runId = 0;
  let result = null;
  let error = '';
  let recent = [];
  let showMethod = false;

  const done = () => SOURCES.every(([s]) => s in src);
  const loadedCount = () => SOURCES.filter(([s]) => s in src).length;

  /* ------------------------------ data ------------------------------ */

  async function ask(source, domain, fresh, id) {
    let res;
    try { res = await chrome.runtime.sendMessage({ type: MSG.DOMAIN_LOOKUP, domain, source, fresh }); } catch (_) { res = null; }
    // no answer at all: the background worker is an older LinkLens that does not know this tool (the extension was rebuilt but not reloaded)
    // …or an older one that knows the tool but not this data source ("Unknown source")
    if (!res || (!res.ok && res.code === 'input' && /unknown source/i.test(res.error || ''))) res = { ok: false, code: 'stale', error: 'The LinkLens background is out of date. Reload LinkLens at chrome://extensions, then reload this page.' };
    if (id !== runId) return; // an older lookup
    if (res && res.ok) { src[source] = res.data; meta[source] = { at: res.at, cached: res.cached }; } else src[source] = { error: (res && res.error) || 'Lookup failed', code: res && res.code };
    rescore();
    render();
  }

  /** At least one source that carries real evidence answered. Without any, there is no score to show (never a fake 0). */
  const hasData = () => ['tranco', 'rdap', 'archive', 'dns'].some((s) => src[s] && !src[s].error);
  const failedAll = () => done() && !hasData();

  function rescore() {
    const opr = src.opr && src.opr.needsKey ? undefined : src.opr;
    result = hasData() && (done() || ('tranco' in src && 'dns' in src)) ? scoreAuthority({ ...src, opr }, { shared: !!(target && target.shared), domain: target ? target.domain : '' }) : null;
  }

  function analyse(value, { fresh = false } = {}) {
    const p = parseDomainInput(value);
    if (!p.ok) { error = p.error; target = null; src = {}; result = null; render(); return; }
    error = '';
    target = p;
    input.value = p.host;
    src = {}; meta = {}; result = null;
    const id = ++runId;
    render();
    for (const [s] of SOURCES) ask(s, p.domain, fresh, id);
    ask('pages', p.domain, fresh, id);
    loadRecent();
  }

  async function loadRecent() {
    try {
      const r = await chrome.runtime.sendMessage({ type: MSG.DOMAIN_RECENT, limit: 7 });
      recent = (r && r.domains) || [];
    } catch (_) { recent = []; }
    renderRecent();
  }

  /* ------------------------------ render ------------------------------ */

  function renderRecent() {
    const list = recent.filter((d) => !target || d !== target.domain).slice(0, 6);
    recentEl.hidden = !list.length;
    recentEl.innerHTML = list.length ? `<span>Recent</span>${list.map((d) => `<button type="button" data-domain="${esc(d)}">${esc(d)}</button>`).join('')}` : '';
  }

  function renderHeader() {
    q('.seo-host').textContent = target ? target.domain : '';
    const final = result && done();
    if (failedAll()) { mini.innerHTML = '<b style="color:#DC2626">!</b>'; mini.style.setProperty('--p', 0); return; }
    mini.innerHTML = final ? `<b style="color:${daColor(result.score)}">${result.score}</b>` : '<b>–</b>';
    mini.style.setProperty('--p', final ? result.score : 0);
    mini.style.setProperty('--c', final ? daColor(result.score) : 'transparent');
  }

  function render() {
    const top = body.scrollTop;
    renderHeader();
    if (error) {
      body.innerHTML = `<div class="seo-emptybig">${icon('alert', 28)}<h3>Cannot analyse that</h3><p>${esc(error)}</p></div>`;
      foot.innerHTML = '';
      return;
    }
    if (!target) { body.innerHTML = ''; foot.innerHTML = ''; return; }
    if (failedAll()) { body.innerHTML = hero(); renderFoot(); return; }
    body.innerHTML = [hero(), overviewTiles(), breakdown(), estimatesCard(), topPagesCard(), `<div class="da-grid">${popularityCard()}${linkCard()}</div>`, spamCard(), registrationCard(), archiveCard(), `<div class="da-grid">${dnsCard()}${signalsCard()}</div>`, method()].join('');
    body.scrollTop = top;
    renderFoot();
  }

  function hero() {
    const final = result && done();
    const note = target.shared
      ? `<div class="seo-note">${dot('info')}<span>Hosted on <b>${esc(target.platform)}</b>: scored as its own site, not the platform.</span></div>`
      : target.isSub ? `<div class="seo-note">${dot('info')}<span>Authority belongs to the root domain: <b>${esc(target.domain)}</b> (you entered ${esc(target.host)}).</span></div>` : '';
    if (failedAll()) {
      const stale = SOURCES.some(([s]) => src[s] && src[s].code === 'stale');
      const rows = SOURCES.map(([s, label]) => `<li><em class="bad">${icon('x', 12)}</em><span><b>${esc(label)}</b> — ${esc((src[s] && src[s].error) || (src[s] && src[s].needsKey ? 'no key (optional)' : 'failed'))}</span></li>`).join('');
      return `<div class="seo-hero da-hero da-fail"><div class="seo-ring da-ring" style="--p:0;--c:#DC2626"><b style="color:#DC2626">!</b></div>
        <div class="seo-hero-t"><h3>${stale ? 'LinkLens needs a reload' : 'The data sources could not be reached'}</h3>
        <p>${stale ? 'The extension was updated, but Chrome is still running the old background part. Open <b>chrome://extensions</b>, click ↻ on LinkLens (and allow the new permission if asked), then reload this page.' : 'No score is shown because none of the sources answered. Check your connection, VPN or firewall, then retry.'}</p>
        ${stale ? '' : `<ul class="da-steps">${rows}</ul>`}
        ${stale ? '' : '<button class="seo-btn" type="button" data-act="retry" style="margin-top:10px">Retry</button>'}</div></div>`;
    }
    if (!final) {
      const steps = SOURCES.map(([s, label]) => {
        const v = src[s];
        const state = !(s in src) ? '<i class="seo-spin"></i>' : v && v.error ? `<em class="bad">${icon('x', 12)}</em>` : `<em class="ok">${icon('check', 12)}</em>`;
        return `<li>${state}<span>${esc(label)}</span></li>`;
      }).join('');
      return `<div class="seo-hero da-hero"><div class="seo-ring da-ring" style="--p:${loadedCount() * 20};--c:var(--t-primary)"><i class="seo-spin"></i></div>
        <div class="seo-hero-t"><h3>Analysing ${esc(target.domain)}…</h3><p>Reading ${loadedCount()} of ${SOURCES.length} public data sources</p><ul class="da-steps">${steps}</ul></div></div>${note}`;
    }
    const r = result, c = daColor(r.score);
    const confLv = r.confidence === 'High' ? 'good' : r.confidence === 'Medium' ? 'warn' : 'bad';
    return `
      <div class="seo-hero da-hero">
        <div class="seo-ring da-ring" style="--p:${r.score};--c:${c}"><b>${r.score}</b><span>/100</span></div>
        <div class="seo-hero-t">
          <h3 style="color:${c}">${esc(r.tier.name)} authority</h3>
          <p>${esc(r.tier.text)}</p>
          <div class="seo-chips">${chip(`Likely range ${r.low}–${r.high}`, 'info')}${chip(`${r.confidence} confidence · ${r.confidenceValue}%`, confLv)}${r.ageYears != null ? chip(`${formatAge(r.ageYears)} old`, '') : ''}</div>
        </div>
      </div>
      ${scale(r)}
      ${note}`;
  }

  /** The 0–100 scale with the tier bands, the score and its likely range. */
  function scale(r) {
    const bands = TIERS.slice().reverse().map(([min], i, arr) => {
      const max = i + 1 < arr.length ? arr[i + 1][0] : 100;
      return `<i style="left:${min}%;width:${max - min}%;background:${daColor(min + 0.1)}"></i>`;
    }).join('');
    return `<div class="da-scale" aria-hidden="true"><div class="da-track">${bands}<u style="left:${r.low}%;width:${Math.max(1, r.high - r.low)}%"></u><b style="left:${r.score}%"></b></div>
      <div class="da-ticks"><span>0</span><span>20</span><span>35</span><span>50</span><span>65</span><span>80</span><span>100</span></div></div>`;
  }

  function breakdown() {
    if (!result || !done()) return '';
    const from = { 'tranco+opr': 'Tranco rank + Open PageRank', tranco: 'Tranco rank', opr: 'Open PageRank (not in the Tranco top 1M)', archive: 'estimated from archive interest (not in the Tranco top 1M)', none: 'no data' };
    const sub = {
      core: from[result.core.from],
      archive: 'How often the Wayback Machine captures the homepage',
      age: result.ageFrom === 'archive' ? 'From the first archive capture (registry has no RDAP)' : 'From the registry record',
      trust: `${result.trust.checks.filter((c) => c.ok).length} of ${result.trust.checks.length} checks passed`,
    };
    const rows = result.parts.map((p) => `
      <div class="da-row${p.available ? '' : ' off'}">
        <div class="da-rl"><b>${esc(p.label)}</b><small>${esc(p.available ? sub[p.id] : 'No data: left out of the score')}</small></div>
        <div class="da-rb"><i style="width:${p.available ? p.score : 0}%;background:${p.available ? daColor(p.score) : 'transparent'}"></i></div>
        <div class="da-rv"><b>${p.available ? p.score : '—'}</b><small>${p.weight}%</small></div>
      </div>`).join('');
    const core = result.core.P != null && result.core.O != null ? `<p class="da-sub">Link popularity = 55 % Tranco (${result.core.P}) + 45 % Open PageRank (${result.core.O}).</p>` : '';
    return `<div class="seo-sec"><h4>Score breakdown <small>score · weight</small></h4>${rows}${core}</div>`;
  }

  const loading = (label) => `<div class="seo-load"><i class="seo-spin"></i>${esc(label)}…</div>`;
  const failed = (v) => `<div class="seo-note warn">${dot('warn')}<span>${esc(v.error)}${v.code === 'rate' || v.code === 'timeout' || v.code === 'network' ? ' <button class="da-retry" type="button" data-act="retry">Retry</button>' : ''}</span></div>`;
  const kv = (k, v, extra = '') => `<div class="da-kv"><span>${esc(k)}</span><b>${v}</b>${extra}</div>`;

  function popularityCard() {
    const v = src.tranco;
    let inner;
    if (!('tranco' in src)) inner = loading('Reading the Tranco list');
    else if (v.error) inner = failed(v);
    else if (!v.ranked) inner = `<div class="da-big"><b>Not ranked</b><small>Outside the top 1,000,000 sites</small></div><p class="da-sub">Every domain with a strong link profile or a large audience is in this list. Its score comes from the other sources.</p>`;
    else {
      const tr = v.trend;
      const places = (n) => `${num(n)} place${n === 1 ? '' : 's'}`;
      const trend = tr > 0 ? chip(`▲ ${places(tr)}`, 'good') : tr < 0 ? chip(`▼ ${places(-tr)}`, 'bad') : chip('stable', 'info');
      inner = `<div class="da-big"><b>#${num(v.latest)}</b><small>of the top 1M · ${esc(v.latestDate)}</small></div>
        ${rankSpark(v.history)}
        ${kv('30-day median', `#${num(v.median)}`)}${kv('Best · worst', `#${num(v.best)} · #${num(v.worst)}`)}${kv('Trend (30 days)', trend)}${kv('Days in list', `${v.days} / 30`)}`;
    }
    return `<div class="seo-sec da-card"><h4>${icon('up', 13)}Popularity <small>Tranco</small></h4>${inner}</div>`;
  }

  function rankSpark(history) {
    if (!history || history.length < 2) return '';
    const W = 240, H = 40, P = 3;
    const ys = history.map((x) => Math.log10(x.rank));
    const min = Math.min(...ys), max = Math.max(...ys), span = max - min || 1;
    const pts = ys.map((y, i) => [P + (i * (W - 2 * P)) / (ys.length - 1), P + ((y - min) / span) * (H - 2 * P)]); // lower rank (better) = higher
    const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('');
    const area = `${d}L${pts[pts.length - 1][0].toFixed(1)},${H}L${pts[0][0].toFixed(1)},${H}Z`;
    return `<svg class="da-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><path d="${area}" class="a"/><path d="${d}" class="l"/></svg>`;
  }

  function linkCard() {
    const v = src.opr;
    let inner;
    if (!('opr' in src)) inner = loading('Reading Open PageRank');
    else if (v.needsKey) {
      inner = `<p class="da-sub">Add a free Open PageRank key to include <b>backlink data</b> from the Common Crawl link graph. It makes the score more accurate, especially for sites outside the top 1M.</p>
        <button class="seo-btn wide" type="button" data-act="settings">${icon('settings', 13)}Add a free key in Settings</button>`;
    } else if (v.error) inner = failed(v);
    else if (!v.found) inner = `<div class="da-big"><b>No data</b><small>Not in the Open PageRank index</small></div>`;
    else {
      inner = `<div class="da-big"><b>${v.pr.toFixed(2)}<em>/10</em></b><small>PageRank (log scale)</small></div>
        <div class="seo-gauge da-g"><i class="mark good" style="left:${v.pr * 10}%"></i></div>
        ${v.rank ? kv('Global link rank', `#${num(v.rank)}`) : ''}${kv('Maps to', `${result && result.core.O != null ? result.core.O : '—'} / 100`)}`;
    }
    return `<div class="seo-sec da-card"><h4>${icon('link', 13)}Link graph <small>Open PageRank</small></h4>${inner}</div>`;
  }

  function registrationCard() {
    const v = src.rdap;
    let inner;
    if (!('rdap' in src)) inner = loading('Asking the registry');
    else if (v.error) inner = failed(v);
    else if (!v.found) {
      const a = src.archive && !src.archive.error && src.archive.found ? src.archive : null;
      inner = `<div class="seo-note">${dot('info')}<span>The <b>.${esc(target.domain.split('.').pop())}</b> registry offers no public RDAP record${a && a.firstSeen ? `, so the age is taken from the first Web Archive capture (${esc(formatDate(a.firstSeen))}).` : '.'}</span></div>`;
    } else {
      const now = Date.now();
      const left = v.expires ? (Date.parse(v.expires) - now) / 864e5 : null;
      const expLv = left == null ? '' : left < 0 ? 'bad' : left < 45 ? 'warn' : left > 365 ? 'good' : '';
      const locks = [v.serverLock ? chip('Registry lock', 'good') : '', v.clientLock ? chip('Transfer lock', 'good') : chip('No transfer lock', 'warn'), v.dnssec ? chip('DNSSEC', 'good') : '', v.hold ? chip('On hold', 'bad') : ''].join('');
      inner = `<div class="da-tiles">
          <div><span>Registered</span><b>${esc(formatDate(v.registered))}</b><small>${result && result.ageYears != null ? esc(formatAge(result.ageYears)) + ' ago' : ''}</small></div>
          <div><span>Expires</span><b>${esc(formatDate(v.expires))}</b><small class="${expLv}">${left == null ? '' : left < 0 ? 'expired' : `in ${formatAge(left / 365.25)}`}</small></div>
          <div><span>Updated</span><b>${esc(formatDate(v.updated))}</b><small>last change</small></div>
        </div>
        ${kv('Registrar', esc(v.registrar || '—'))}
        ${kv('Protection', `<span class="seo-chips">${locks}</span>`)}
        ${v.nameservers.length ? kv('Name servers', esc(v.nameservers.slice(0, 4).join(', '))) : ''}
        ${v.status.length ? `<details class="seo-det"><summary>Registry status (${v.status.length})</summary><div class="seo-chips">${v.status.map((s) => chip(s, '')).join('')}</div></details>` : ''}`;
    }
    return `<div class="seo-sec"><h4>${icon('file', 13)}Registration <small>RDAP · official registry data</small></h4>${inner}</div>`;
  }

  function archiveCard() {
    const v = src.archive;
    let inner;
    const wb = `https://web.archive.org/web/*/${target.domain}`;
    if (!('archive' in src)) inner = loading('Counting Wayback Machine captures (can take a few seconds)');
    else if (v.error) inner = failed(v);
    else if (v.blocked) inner = `<div class="seo-note">${dot('info')}<span>The site owner has excluded this domain from the Wayback Machine, so archive interest is left out of the score (it does not count against it).</span></div>`;
    else if (!v.found) inner = `<div class="seo-note warn">${dot('warn')}<span>The Wayback Machine has never captured this homepage. Sites that are linked to get archived; this one has no record.</span></div>`;
    else if (v.firstOnly) inner = `${kv('First seen', esc(formatDate(v.firstSeen)))}<p class="da-sub">Only the first capture is available right now.</p>`;
    else {
      inner = `<div class="da-tiles">
          <div><span>First seen</span><b>${esc(formatDate(v.firstSeen))}</b><small>${v.yearsCaptured} year${v.yearsCaptured === 1 ? '' : 's'} with captures</small></div>
          <div><span>Last 12 months</span><b>${num(v.last12)}</b><small>${v.perMonth >= 10 ? num(v.perMonth) : v.perMonth.toFixed(1)} per month</small></div>
          <div><span>Active months</span><b>${v.activeMonths24} / 24</b><small>${num(v.total)} captures in total</small></div>
        </div>
        ${archiveBars(v.series)}
        ${historyBars(v.yearly)}`;
    }
    return `<div class="seo-sec"><h4>${icon('history', 13)}Web Archive <small>homepage captures</small><a class="seo-lk da-ext" href="${esc(wb)}" target="_blank" rel="noopener noreferrer">${icon('external', 12)}Wayback</a></h4>${inner}</div>`;
  }

  function archiveBars(series) {
    if (!series || !series.length) return '';
    const max = Math.max(1, ...series.map((c) => Math.log1p(c)));
    const bars = series.map((c, i) => `<i title="${num(c)} captures" style="height:${Math.max(c ? 8 : 2, (Math.log1p(c) / max) * 100)}%;${c ? '' : 'opacity:.35'}" data-i="${i}"></i>`).join('');
    return `<div class="da-bars" aria-label="Captures per month, last 24 months">${bars}</div><div class="da-ticks two"><span>24 months ago</span><span>last month</span></div>`;
  }

  function dnsCard() {
    const v = src.dns;
    let inner;
    if (!('dns' in src)) inner = loading('Querying DNS');
    else if (v.error) inner = failed(v);
    else if (!result) inner = loading('Scoring');
    else {
      inner = `<ul class="da-checks">${result.trust.checks.map((c) => `<li class="${c.ok ? 'ok' : 'no'}"><em>${icon(c.ok ? 'check' : 'x', 11)}</em><span><b>${esc(c.label)}</b><small>${esc(c.detail)}</small></span></li>`).join('')}</ul>`;
    }
    return `<div class="seo-sec da-card"><h4>${icon('shield', 13)}Trust &amp; security <small>DNS · registry</small></h4>${inner}</div>`;
  }

  function signalsCard() {
    let inner;
    if (!result || !done()) inner = loading('Looking for warning signs');
    else inner = result.risks.map((s) => `<div class="da-risk ${s.level}">${dot(s.level)}<span><b>${esc(s.title)}</b><small>${esc(s.detail)}</small></span></div>`).join('');
    return `<div class="seo-sec da-card"><h4>${icon('alert', 13)}Signals</h4>${inner}</div>`;
  }

  /** The headline numbers, side by side (like an SEO tool's overview). */
  function overviewTiles() {
    if (!result || !done()) return '';
    const t = src.tranco && !src.tranco.error ? src.tranco : null;
    const sp = result.spam;
    const spLv = sp.level === 'low' ? 'good' : sp.level === 'medium' ? 'warn' : 'bad';
    const lk = result.links, kw = result.keywords;
    const pagesPending = !('pages' in src);
    return `<div class="da-over">
      <div><span>Domain Authority</span><b style="color:${daColor(result.score)}">${result.score}</b><small>est. · ${result.low}–${result.high}</small></div>
      <div><span>Linking Root Domains</span><b>${lk ? compact(lk.mid) : '—'}</b><small>est. · ${lk ? `${compact(lk.low)}–${compact(lk.high)}` : 'no data'}</small></div>
      <div><span>Ranking Keywords</span><b>${kw ? compact(kw.mid) : '—'}${kw && pagesPending ? '<i class="seo-spin da-tspin" title="Refining with the page count…"></i>' : ''}</b><small>est. · ${kw ? `${compact(kw.low)}–${compact(kw.high)}` : 'no data'}</small></div>
      <div><span>Spam Score</span><b class="${spLv}">${sp.percent}%</b><small>est. · ${sp.hits} of ${sp.checked} flags</small></div>
    </div>`;
  }

  /** How the link and keyword numbers were estimated, and how far to trust them. */
  function estimatesCard() {
    if (!result || !done()) return '';
    const lk = result.links, kw = result.keywords, t = src.tranco && !src.tranco.error ? src.tranco : null;
    const pg = src.pages && !src.pages.error && src.pages.found ? src.pages : null;
    const row = (label, v, basis) => `<div class="da-est"><div><b>${esc(label)}</b><small>${esc(basis)}</small></div><div class="da-er"><b>${v ? num(v.mid) : '—'}</b><small>${v ? `likely ${num(v.low)} – ${num(v.high)}` : ''}</small></div></div>`;
    return `<div class="seo-sec"><h4>${icon('link', 13)}Links &amp; keywords <small>estimated</small></h4>
      ${row('Linking root domains', lk, lk ? `From authority ${result.score}${lk.basis.includes('archive') ? ' and archive interest' : ''}` : '')}
      ${row('Ranking keywords', kw, kw ? `From ${kw.basis}${pg ? ` · ${num(pg.distinct)} pages` : ''}${t && t.ranked ? ` · rank #${num(t.median)}` : ''}` : '')}
      <p class="da-sub">Exact counts of linking domains and ranking keywords exist only in paid crawler indexes (Moz, Ahrefs, Semrush). These are model estimates calibrated against measured Moz values, shown with their likely range. Use "Compare on Moz" for the exact figures.</p></div>`;
  }

  function topPagesCard() {
    const v = src.pages;
    let inner;
    if (!('pages' in src)) inner = loading('Finding the most important pages (can take a few seconds)');
    else if (v.error) inner = `<div class="seo-note warn">${dot('warn')}<span>${esc(v.error)}${v.code === 'stale' ? '' : ' <button class="da-retry" type="button" data-act="retry-pages">Retry</button>'}</span></div>`;
    else if (!v.found) inner = `<p class="da-sub">The Web Archive has no captures of this domain's pages in the last 12 months.</p>`;
    else {
      const max = v.pages[0].days || 1;
      inner = `<div class="da-tbl"><div class="da-th"><span>Page / URL</span><span>Days archived</span></div>
        ${v.pages.map((pg, i) => `<div class="da-tr"><span class="da-n">${i + 1}</span><a class="seo-a" href="${esc(pg.url)}" target="_blank" rel="noopener noreferrer" title="${esc(pg.url)} · ${num(pg.captures)} captures">${esc((pg.host === target.domain ? '' : pg.host) + pg.path)}</a><span class="da-pc"><i style="width:${Math.max(4, (pg.days / max) * 100)}%"></i><b>${num(pg.days)}</b></span></div>`).join('')}</div>
        <p class="da-sub">Ranked by how many different days the Wayback Machine captured each page in the last 12 months (${num(v.sampled)} captures of ${num(v.distinct)} pages${v.truncated ? ', sampled' : ''}). The archive keeps coming back to what is linked and visited most, so this approximates a site's strongest pages. Menu and footer pages (contact, about, legal, tag lists) are left out. It is not Moz Page Authority.</p>`;
    }
    return `<div class="seo-sec"><h4>${icon('file', 13)}Top pages <small>by archive interest</small></h4>${inner}</div>`;
  }

  function spamCard() {
    if (!result || !done()) return '';
    const sp = result.spam;
    const lv = sp.level === 'low' ? 'good' : sp.level === 'medium' ? 'warn' : 'bad';
    const flags = sp.flags.filter((x) => x.known).sort((a, b) => (b.hit - a.hit) || (b.p - a.p));
    return `<div class="seo-sec"><h4>${icon('shield', 13)}Spam score <small>estimated</small></h4>
      <div class="da-spam"><div class="da-sb ${lv}"><b>${sp.percent}%</b><span>${sp.level === 'low' ? 'Low' : sp.level === 'medium' ? 'Medium' : 'High'} risk</span></div>
        <div class="da-st"><div class="da-sbar"><i style="left:0;width:30%" class="g"></i><i style="left:30%;width:30%" class="w"></i><i style="left:60%;width:40%" class="b"></i><u style="left:${sp.percent}%"></u></div>
        <p class="da-sub">The share of domains with these features that turn out to be spammy, the way Moz describes its Spam Score: 1–30 % low, 31–60 % medium, 61–100 % high. ${sp.hits} of ${sp.checked} warning features found.</p></div></div>
      <ul class="da-checks da-flags">${flags.map((x) => `<li class="${x.hit ? 'hit' : 'ok'}"><em>${icon(x.hit ? 'alert' : 'check', 11)}</em><span><b>${esc(x.title)}</b><small>${esc(x.detail)}</small></span>${x.hit ? `<i>+${Math.round(x.p * 100)}%</i>` : ''}</li>`).join('')}</ul></div>`;
  }

  function historyBars(yearly) {
    if (!yearly || yearly.length < 2) return '';
    const max = Math.max(1, ...yearly.map((y) => Math.log1p(y.count)));
    return `<h4 class="da-h5">Domain history <small>captures per year</small></h4>
      <div class="da-bars da-years">${yearly.map((y) => `<i title="${y.year}: ${num(y.count)} captures" style="height:${Math.max(y.count ? 8 : 2, (Math.log1p(y.count) / max) * 100)}%;${y.count ? '' : 'opacity:.35'}"></i>`).join('')}</div>
      <div class="da-ticks two"><span>${yearly[0].year}</span><span>${yearly[yearly.length - 1].year}</span></div>`;
  }

  function method() {
    return `<div class="seo-sec da-method"><button class="da-mt" type="button" data-act="method" aria-expanded="${showMethod}">${icon('settings', 13)}How this score is calculated<em>${icon('up', 12)}</em></button>
      ${showMethod ? `<div class="da-mb">
        <p>Like Moz DA, Ahrefs DR and Semrush AS, the score is a <b>logarithmic 0–100 scale</b>: going from 20 to 30 is far easier than from 70 to 80. Those vendors use private backlink indexes; LinkLens estimates the same scale from independent public data, each mapped with anchor points calibrated against well-known domains.</p>
        <pre class="da-f">Authority = 78% × Link popularity + 22% × Supporting signals

Link popularity = 55% × Tranco + 45% × Open PageRank
                  (either one alone when only one is available)
  Tranco      log-interpolated median rank of 30 daily lists
              #1 → 100 · #100 → 96 · #1k → 92 · #10k → 83 · #100k → 66 · #1M → 42
  PageRank    0–10 → 0–100   (4 → 35 · 6 → 62 · 8 → 88)

Supporting = 45% Web Archive + 35% Domain age + 20% Trust
  Archive     captures / month (log) × (0.6 + 0.4 × active months / 24)
  Age         100 × ln(1 + years) / ln(21)   (20+ years = 100)
  Trust       MX, SPF, DMARC, CAA, DNSSEC, NS, registrar &amp; registry locks, renewal

Missing sources are left out and the weights renormalised.
Confidence reflects how many sources answered and whether they agree.</pre>
        <p class="da-sub">Data: <a class="seo-a" href="https://tranco-list.eu" target="_blank" rel="noopener noreferrer">Tranco</a> · <a class="seo-a" href="https://openpagerank.keywordseverywhere.com" target="_blank" rel="noopener noreferrer">Open PageRank</a> · RDAP (the registries) · <a class="seo-a" href="https://web.archive.org" target="_blank" rel="noopener noreferrer">Internet Archive</a> · Google Public DNS. Only the domain name is sent, and answers are cached on this computer.</p>
      </div>` : ''}</div>`;
  }

  function renderFoot() {
    const ats = Object.values(meta).map((m) => m.at).filter(Boolean);
    const oldest = ats.length ? Math.min(...ats) : 0;
    const cached = Object.values(meta).some((m) => m.cached);
    foot.innerHTML = `
      <span class="da-upd">${failedAll() ? `${icon('alert', 12)}No data received` : done() ? `${icon('clock', 12)}${cached ? `Cached data · ${esc(ago(oldest))}` : 'Fresh data · just now'}` : '<i class="seo-spin"></i>Loading…'}</span>
      <a class="seo-lk" href="https://moz.com/domain-analysis?site=${encodeURIComponent(target.domain)}" target="_blank" rel="noopener noreferrer">${icon('external', 12)}Compare on Moz</a>
      <button class="seo-btn" type="button" data-act="copy" ${result && done() ? '' : 'disabled'}>${icon('copy', 13)}Copy report</button>`;
  }

  /* ------------------------------ events ------------------------------ */

  form.addEventListener('submit', (e) => { e.preventDefault(); analyse(input.value); });
  // keys typed in the panel stay in the panel: the page's own shortcuts must not fire while typing a domain
  for (const t of ['keydown', 'keyup', 'keypress']) el.addEventListener(t, (e) => { if (e.key !== 'Escape') e.stopPropagation(); });

  recentEl.addEventListener('click', (e) => { const b = e.target.closest && e.target.closest('[data-domain]'); if (b) analyse(b.dataset.domain); });

  el.addEventListener('click', async (e) => {
    const a = e.target.closest && e.target.closest('[data-act]');
    if (!a) return;
    switch (a.dataset.act) {
      case 'close': onClose(); break;
      case 'refresh': if (target) analyse(target.host, { fresh: true }); break;
      case 'retry': {
        if (!target) break;
        const id = runId;
        for (const [s] of SOURCES) if (src[s] && src[s].error) { delete src[s]; ask(s, target.domain, true, id); }
        rescore(); render();
        break;
      }
      case 'retry-pages': if (target) { delete src.pages; ask('pages', target.domain, true, runId); render(); } break;
      case 'method': showMethod = !showMethod; render(); break;
      case 'settings': try { chrome.runtime.sendMessage({ type: MSG.OPEN_OPTIONS, section: 'authority' }); } catch (_) { /* context gone */ } break;
      case 'copy': {
        if (!result) break;
        const ok = await onCopy(reportText(target.domain, result, src));
        if (ok) { a.classList.add('ok'); a.innerHTML = `${icon('check', 13)}Copied`; setTimeout(() => { if (a.isConnected) { a.classList.remove('ok'); a.innerHTML = `${icon('copy', 13)}Copy report`; } }, 1400); }
        break;
      }
      default:
    }
  });

  el.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    if (e.target === input && document.activeElement && input.value && target && input.value !== target.host) { input.value = target.host; return; }
    onClose();
  });

  // a new key saved in Settings: look the link-graph source up again
  let unsubKeys = null;
  function watchKeys() {
    if (unsubKeys) return;
    const fn = (changes, area) => {
      if (area === 'local' && changes.mi_da_keys && open && target) {
        delete src.opr; delete meta.opr; rescore(); render();
        ask('opr', target.domain, true, runId);
      }
    };
    try { chrome.storage.onChanged.addListener(fn); unsubKeys = () => chrome.storage.onChanged.removeListener(fn); } catch (_) { /* context gone */ }
  }

  /* -------------------------------- position -------------------------------- */

  function clamp(p) {
    const vw = document.documentElement.clientWidth || window.innerWidth, vh = window.innerHeight;
    const w = el.offsetWidth || 600, hh = el.offsetHeight || 600;
    return { x: Math.round(Math.min(Math.max(p.x, MARGIN), Math.max(MARGIN, vw - w - MARGIN))), y: Math.round(Math.min(Math.max(p.y, MARGIN), Math.max(MARGIN, vh - hh - MARGIN))) };
  }
  function place(p) {
    if (p) pos = p;
    pos = clamp(pos);
    el.style.transform = `translate(${pos.x}px, ${pos.y}px)`;
  }
  const defaultPos = () => ({ x: (document.documentElement.clientWidth || window.innerWidth) - (el.offsetWidth || 600) - 18, y: 64 });

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
      if (open) return;
      open = true;
      el.style.visibility = 'hidden';
      el.hidden = false;
      watchKeys();
      if (!target) analyse(location.hostname);
      else render();
      let saved = null;
      try { saved = await loadPos(); } catch (_) { /* extension context gone */ }
      if (!open) return;
      place(saved && Number.isFinite(saved.x) && Number.isFinite(saved.y) ? saved : defaultPos());
      el.style.visibility = '';
      try { el.focus({ preventScroll: true }); } catch (_) { /* not focusable yet */ }
      window.addEventListener('resize', onResize, { passive: true });
    },
    hide() {
      if (!open) return;
      open = false;
      el.hidden = true;
      if (unsubKeys) { unsubKeys(); unsubKeys = null; }
      window.removeEventListener('resize', onResize);
    },
    isOpen: () => open,
    destroy() { this.hide(); el.remove(); },
  };
}
