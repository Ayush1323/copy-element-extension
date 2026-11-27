// Domain Authority: everything that is pure (no network, no DOM) — domain parsing, the parsers for each public data source,
// and the scoring model. The background worker fetches the sources (src/background/domain-lookup.js) and the panel
// (src/content/ui/authority-panel.js) turns the parsed data into a score with `scoreAuthority`.
//
// THE MODEL
// ---------
// A "domain authority" (Moz DA, Ahrefs DR, Semrush AS) is a log-scaled 0–100 estimate of how strong a domain's link profile
// is. Those vendors compute it from their private backlink indexes. LinkLens estimates the same scale from public,
// independent datasets, each one mapped onto the 0–100 scale with anchor points calibrated against well known domains:
//
//   1. Popularity / link reach (the core, 78 % of the score)
//      · Tranco rank — a research-grade top-1M list that averages Chrome UX Report, Cloudflare Radar, Majestic (a backlink
//        index: referring subnets), Umbrella and Farsight over 30 days. Majestic's share makes it a link signal, the other
//        lists make it a real-traffic signal. Median rank of the last 30 daily lists, log-interpolated.
//      · Open PageRank (optional, free key) — PageRank computed on the Common Crawl link graph, 0–10. A pure link metric.
//      When both exist they are blended (55 / 45). A domain outside the Tranco top 1M can only reach "moderate" from links
//      alone, because every domain with a strong link profile is in that list.
//   2. Supporting signals (22 %)
//      · Web Archive interest — how often the Wayback Machine crawls the homepage (it crawls what is linked and visited).
//      · Domain age — from the registry (RDAP), or the first archive capture when the registry has no RDAP service.
//      · Trust & infrastructure — DNSSEC, mail authentication (SPF, DMARC), CAA, registrar/registry locks, renewal horizon.
//
// Every part reports whether its data was available. Missing parts are left out (weights renormalised), and the result
// carries a confidence (how much of the evidence was available and whether the sources agree) and an error margin.

/* ------------------------------------------------------------------ domains ------------------------------------------------------------------ */

// Two-label public suffixes (a pragmatic subset of the Public Suffix List: the ones real sites use).
const MULTI_SUFFIX = new Set(`
co.uk org.uk ac.uk gov.uk me.uk net.uk ltd.uk plc.uk sch.uk nhs.uk police.uk
com.au net.au org.au edu.au gov.au asn.au id.au co.nz org.nz net.nz ac.nz govt.nz geek.nz school.nz
co.in net.in org.in firm.in gen.in ind.in ac.in edu.in gov.in res.in nic.in
co.jp ne.jp or.jp ac.jp go.jp ed.jp gr.jp lg.jp co.kr or.kr ne.kr ac.kr go.kr re.kr
com.cn net.cn org.cn gov.cn edu.cn ac.cn com.hk net.hk org.hk edu.hk gov.hk com.tw net.tw org.tw edu.tw gov.tw idv.tw
com.sg net.sg org.sg edu.sg gov.sg com.my net.my org.my edu.my gov.my co.id or.id ac.id go.id web.id co.th or.th ac.th go.th in.th
com.ph net.ph org.ph edu.ph gov.ph com.vn net.vn org.vn edu.vn gov.vn com.pk net.pk org.pk edu.pk gov.pk com.bd net.bd org.bd edu.bd gov.bd
com.np org.np edu.np com.lk org.lk edu.lk
com.br net.br org.br gov.br edu.br art.br blog.br eco.br com.mx org.mx gob.mx edu.mx net.mx com.ar org.ar gob.ar edu.ar net.ar
com.co org.co edu.co gov.co net.co com.pe org.pe edu.pe gob.pe com.ve com.uy com.ec com.bo com.py com.gt com.do com.pa com.sv com.ni com.hn com.cu
co.za org.za ac.za gov.za net.za web.za co.ke or.ke ac.ke go.ke com.ng org.ng edu.ng gov.ng com.gh com.eg org.eg edu.eg gov.eg co.ug co.tz co.zw com.et
com.sa org.sa edu.sa gov.sa net.sa com.ae org.ae gov.ae ac.ae co.ae com.qa com.kw com.bh com.om com.jo com.lb co.il org.il ac.il gov.il net.il muni.il
com.tr org.tr edu.tr gov.tr net.tr gen.tr av.tr bel.tr com.ua org.ua net.ua edu.ua gov.ua in.ua kiev.ua com.ru org.ru net.ru msk.ru spb.ru
com.pl net.pl org.pl edu.pl gov.pl waw.pl com.gr edu.gr gov.gr com.cy com.mt com.es org.es nom.es gob.es edu.es com.pt org.pt gov.pt
co.at or.at ac.at gv.at co.hu org.hu com.ro org.ro co.rs org.rs com.hr co.ba com.mk co.me com.ge com.am com.az co.uz com.kz org.kz
eu.com uk.com us.com gb.net uk.net jpn.com za.com de.com
`.trim().split(/\s+/));

// Shared hosting platforms. Every customer site lives on its own subdomain, and the platform's authority is NOT the site's:
// for these, the full subdomain is the domain (exactly how the Public Suffix List's private section treats them).
export const SHARED_HOSTS = new Set(`
github.io gitlab.io bitbucket.io blogspot.com wordpress.com wpcomstaging.com tumblr.com substack.com medium.com
vercel.app netlify.app herokuapp.com pages.dev workers.dev web.app firebaseapp.com appspot.com azurewebsites.net azurestaticapps.net cloudfront.net
onrender.com fly.dev glitch.me repl.co replit.app wixsite.com weebly.com square.site squarespace.com webflow.io framer.website framer.app carrd.co
myshopify.com bigcartel.com strikingly.com jimdosite.com site123.me godaddysites.com notion.site gitbook.io readthedocs.io surge.sh neocities.org
`.trim().split(/\s+/));

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

/**
 * Normalises whatever the user typed (a URL, "www.Example.com/path", an IDN) to a hostname.
 * Returns { ok: true, host } or { ok: false, error }.
 */
export function normalizeHost(input) {
  let s = String(input == null ? '' : input).trim();
  if (!s) return { ok: false, error: 'Enter a domain, for example example.com' };
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = 'http://' + s.replace(/^\/+/, '');
  let host;
  try { host = new URL(s).hostname.toLowerCase(); } catch (_) { return { ok: false, error: 'That does not look like a domain.' }; }
  host = host.replace(/\.+$/, '');
  if (!host) return { ok: false, error: 'That does not look like a domain.' };
  if (IPV4.test(host) || host.startsWith('[')) return { ok: false, error: 'IP addresses have no domain authority. Enter a domain name.' };
  if (host === 'localhost' || /\.(localhost|local|test|invalid|example|internal|lan|home\.arpa)$/.test(host)) return { ok: false, error: 'Local and reserved names are not on the public web.' };
  const labels = host.split('.');
  if (labels.length < 2 || !labels.every((l) => LABEL.test(l)) || !/^(xn--[a-z0-9-]+|[a-z]{2,63})$/.test(labels[labels.length - 1])) {
    return { ok: false, error: 'That does not look like a domain.' };
  }
  return { ok: true, host };
}

/** The registrable domain ("eTLD+1") a score belongs to: blog.example.co.uk → example.co.uk; me.github.io stays me.github.io. */
export function registrableDomain(host) {
  const labels = String(host || '').toLowerCase().replace(/\.+$/, '').split('.').filter(Boolean);
  if (labels.length <= 2) return { domain: labels.join('.'), shared: false, suffix: labels.slice(1).join('.') };
  const last2 = labels.slice(-2).join('.');
  if (SHARED_HOSTS.has(last2)) {
    return { domain: labels.slice(-3).join('.'), shared: true, platform: last2, suffix: last2 };
  }
  const n = MULTI_SUFFIX.has(last2) ? 3 : 2;
  return { domain: labels.slice(-n).join('.'), shared: false, suffix: labels.slice(-(n - 1)).join('.') };
}

/** Everything a lookup needs from user input. */
export function parseDomainInput(input) {
  const n = normalizeHost(input);
  if (!n.ok) return n;
  const r = registrableDomain(n.host);
  return { ok: true, host: n.host, domain: r.domain, shared: r.shared, platform: r.platform || '', isSub: n.host !== r.domain && n.host !== 'www.' + r.domain };
}

/* ------------------------------------------------------------------ math ------------------------------------------------------------------ */

export const clamp = (v, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, v));
const median = (arr) => { const a = [...arr].sort((x, y) => x - y); const m = a.length >> 1; return a.length ? (a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2) : NaN; };

/** Piecewise-linear interpolation of y over log10(x) between anchor points [[x, y], …] sorted by x. */
export function interpLog(x, anchors) {
  if (!(x > 0)) return anchors[0][1];
  const lx = Math.log10(x);
  if (x <= anchors[0][0]) return anchors[0][1];
  for (let i = 1; i < anchors.length; i++) {
    const [x1, y1] = anchors[i];
    if (x <= x1) {
      const [x0, y0] = anchors[i - 1];
      const l0 = Math.log10(x0), l1 = Math.log10(x1);
      return y0 + ((lx - l0) / (l1 - l0)) * (y1 - y0);
    }
  }
  return anchors[anchors.length - 1][1];
}
/** Piecewise-linear interpolation on a linear x scale. */
export function interpLin(x, anchors) {
  if (x <= anchors[0][0]) return anchors[0][1];
  for (let i = 1; i < anchors.length; i++) {
    const [x1, y1] = anchors[i];
    if (x <= x1) { const [x0, y0] = anchors[i - 1]; return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0); }
  }
  return anchors[anchors.length - 1][1];
}

// Calibration anchors, fitted against published Moz DA of well-known domains (google.com #1 → 100, github.com #34 → 96,
// dribbble.com #1.5k → 90, css-tricks.com #10k → 83, a #500k business site → ~50, the edge of the top 1M → 42).
// The 300k–1M band was re-fitted to a measured Moz value (mindinventory.com: Tranco #484k, Moz DA 48).
export const RANK_ANCHORS = [[1, 100], [10, 98.5], [100, 96], [1000, 92], [10000, 83], [100000, 66], [300000, 51], [1000000, 40]];
// Open PageRank 0–10 (log-scale PageRank) → authority.
export const OPR_ANCHORS = [[0, 0], [1, 4], [2, 12], [3, 22], [4, 35], [5, 48], [6, 62], [7, 76], [8, 88], [9, 95], [10, 100]];
// Average homepage captures per month in the Wayback Machine (+1) → crawl-interest score.
export const ARCHIVE_ANCHORS = [[1, 0], [2, 18], [6, 32], [21, 45], [101, 60], [501, 74], [2001, 86], [10001, 96], [50001, 100]];

export const rankScore = (rank) => clamp(interpLog(rank, RANK_ANCHORS));
export const oprScore = (pr) => clamp(interpLin(clamp(pr, 0, 10), OPR_ANCHORS));
/** Age in years → 0–100 (log: the first years count most; 20+ years = 100). */
export const ageScore = (years) => (years > 0 ? clamp((100 * Math.log1p(years)) / Math.log1p(20)) : 0);

/* ------------------------------------------------------------------ parsers ------------------------------------------------------------------ */

/** Tranco /api/ranks/domain response → { ranked, latest, median, best, worst, days, trend, history:[{date, rank}] }. */
export function parseTranco(json) {
  const list = (json && Array.isArray(json.ranks) ? json.ranks : [])
    .filter((r) => r && Number.isFinite(Number(r.rank)) && Number(r.rank) > 0)
    .map((r) => ({ date: String(r.date || ''), rank: Number(r.rank) }))
    .sort((a, b) => (a.date < b.date ? 1 : -1)); // newest first
  if (!list.length) return { ranked: false, days: 0, history: [] };
  const last30 = list.slice(0, 30);
  const ranks = last30.map((r) => r.rank);
  const latest = last30[0].rank, oldest = last30[last30.length - 1].rank;
  return {
    ranked: true,
    latest,
    median: Math.round(median(ranks)),
    best: Math.min(...ranks),
    worst: Math.max(...ranks),
    days: last30.length,
    trend: last30.length > 1 ? oldest - latest : 0, // > 0: climbing (rank number shrinking)
    latestDate: last30[0].date,
    history: last30.slice().reverse(),
  };
}

/** Open PageRank getPageRank response → { found, pr, rank } */
export function parseOpr(json, domain) {
  const rows = json && Array.isArray(json.response) ? json.response : [];
  const row = rows.find((r) => r && String(r.domain || '').toLowerCase() === String(domain).toLowerCase()) || rows[0];
  if (!row || Number(row.status_code) !== 200) return { found: false };
  const pr = Number(row.page_rank_decimal);
  return { found: Number.isFinite(pr), pr: Number.isFinite(pr) ? pr : 0, rank: row.rank != null && row.rank !== '' ? Number(row.rank) : null };
}

const vcardName = (ent) => {
  try {
    const card = ent.vcardArray && ent.vcardArray[1];
    const fn = card && card.find((p) => p[0] === 'fn');
    return fn ? String(fn[3] || '').trim() : '';
  } catch (_) { return ''; }
};

/** RDAP domain object → registration facts. */
export function parseRdap(json) {
  if (!json || json.objectClassName !== 'domain') return { found: false };
  const ev = {};
  for (const e of json.events || []) {
    const a = String(e.eventAction || '').toLowerCase();
    if (e.eventDate && !ev[a]) ev[a] = e.eventDate;
  }
  const date = (v) => { const t = Date.parse(v); return Number.isFinite(t) ? new Date(t).toISOString() : null; };
  let registrar = '';
  let registrarIana = null;
  const walk = (ents) => {
    for (const ent of ents || []) {
      const roles = (ent.roles || []).map((r) => String(r).toLowerCase());
      if (roles.includes('registrar') && !registrar) {
        registrar = vcardName(ent) || (ent.publicIds && ent.publicIds[0] && ent.publicIds[0].identifier) || ent.handle || '';
        const iana = (ent.publicIds || []).find((p) => /iana/i.test(p.type || ''));
        if (iana) registrarIana = String(iana.identifier);
      }
      if (ent.entities) walk(ent.entities);
    }
  };
  walk(json.entities);
  const status = (json.status || []).map((s) => String(s).toLowerCase().replace(/\s+/g, ' ').trim());
  const has = (re) => status.some((s) => re.test(s.replace(/\s/g, '')));
  return {
    found: true,
    name: String(json.ldhName || '').toLowerCase(),
    registered: date(ev.registration),
    expires: date(ev.expiration),
    updated: date(ev['last changed'] || ev['last update']),
    registrar: registrar.replace(/\s+/g, ' '),
    registrarIana,
    status,
    clientLock: has(/clienttransferprohibited/),
    serverLock: has(/servertransferprohibited|serverupdateprohibited|serverdeleteprohibited/),
    hold: has(/clienthold|serverhold|redemptionperiod|pendingdelete|pendingrestore|inactive/),
    nameservers: (json.nameservers || []).map((n) => String(n.ldhName || '').toLowerCase()).filter(Boolean),
    dnssec: !!(json.secureDNS && json.secureDNS.delegationSigned),
  };
}

const tsToIso = (ts) => {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?/.exec(String(ts || ''));
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0))).toISOString();
};

/**
 * Wayback "sparkline" response ({ years: { "2024": [12 monthly counts] }, first_ts, last_ts }) → crawl statistics.
 * `now` is injectable for tests. The current (incomplete) month is not counted.
 */
export function parseSparkline(json, now = new Date()) {
  if (json && json.error && /blocked|excluded/i.test(String(json.error.type || json.error))) return { found: false, blocked: true }; // the owner opted out of the archive
  const years = json && json.years && typeof json.years === 'object' ? json.years : null;
  if (!years) return { found: false };
  const monthly = new Map(); // "YYYY-MM" → count
  let total = 0;
  for (const [y, arr] of Object.entries(years)) {
    if (!Array.isArray(arr)) continue;
    arr.forEach((c, i) => { const n = Number(c) || 0; total += n; monthly.set(`${y}-${String(i + 1).padStart(2, '0')}`, n); });
  }
  const back = (k) => { const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - k, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; };
  const last = (n) => Array.from({ length: n }, (_, i) => monthly.get(back(i + 1)) || 0); // complete months only, newest first
  const l12 = last(12), l24 = last(24);
  const firstSeen = tsToIso(json.first_ts);
  const lastSeen = tsToIso(json.last_ts);
  return {
    found: total > 0,
    total,
    firstSeen,
    lastSeen,
    last12: l12.reduce((a, b) => a + b, 0),
    perMonth: l12.reduce((a, b) => a + b, 0) / 12,
    activeMonths24: l24.filter((c) => c > 0).length,
    series: l24.slice().reverse(), // oldest → newest, for a small chart
    yearsCaptured: Object.values(years).filter((a) => Array.isArray(a) && a.some((c) => c > 0)).length,
    yearly: Object.entries(years).filter(([, a]) => Array.isArray(a)).map(([y, a]) => ({ year: Number(y), count: a.reduce((s, c) => s + (Number(c) || 0), 0) })).sort((a, b) => a.year - b.year),
  };
}

/* ------------------------------------------------------------------ top pages ------------------------------------------------------------------ */

const ASSET = /\.(css|js|mjs|json|xml|txt|ico|png|jpe?g|gif|webp|avif|svg|woff2?|ttf|eot|otf|mp4|webm|mp3|pdf|zip|gz|map)$/i;
const NOISE = /^\/(wp-(json|admin|includes|content|login)|xmlrpc|feed|cdn-cgi|_next|static|assets|amp)\b|\/(feed|amp|embed|trackback)\/?$/i;

/** A page URL reduced to how a person would name it: no scheme, no "www.", no query/fragment, no trailing slash (except the homepage). */
export function canonicalPage(url) {
  let u;
  try { u = new URL(/^[a-z]+:\/\//i.test(url) ? url : 'http://' + url); } catch (_) { return null; }
  let path = u.pathname.replace(/\/{2,}/g, '/').replace(/\/index\.(html?|php|aspx?)$/i, '/');
  if (path.length > 1) path = path.replace(/\/$/, '');
  return { host: u.hostname.toLowerCase().replace(/^www\./, ''), path: decodeURIComponentSafe(path) };
}
const decodeURIComponentSafe = (s) => { try { return decodeURI(s); } catch (_) { return s; } };

// Pages every site links from its menu or footer: crawled constantly, but they say nothing about which content earns links.
const UTILITY = /^\/(contact(-us)?|about(-us)?|careers?|jobs|team|privacy(-policy)?|terms([-\w]*)?|cookie[-\w]*|legal|disclaimer|faq|sitemap(\.html)?|login|log-in|sign-?in|sign-?up|register|account|cart|checkout|search|thank-?you[-\w]*|404|blog|news|articles|resources|portfolio|case-studies|(tag|tags|category|categories|author|page|topics?)(\/.*)?|(blog|news|resources|insights)\/(videos?|podcasts?|whitepapers?|infographics?|insights|e-?books?|webinars?|guides?|press|events?|case-studies|news|all|latest|page\/\d+))$/i;

/**
 * Wayback CDX lines ("timestamp original" of successful HTML captures in the last year) → the pages the archive keeps
 * coming back to. The Wayback Machine re-captures what is linked and visited, so pages it revisits on many different days
 * are the domain's strongest pages. Ranked by distinct capture DAYS (a burst of captures on one day counts once), with
 * menu/footer utility pages (contact, about, legal, tag lists …) left out. Returns [{ url, path, host, days, captures }].
 */
export function parseTopPages(text, domain, limit = 10) {
  const pages = new Map(); // key → { days:Set, captures }
  let total = 0, utility = 0;
  const lines = String(text || '').split('\n');
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('[') || line.startsWith('<')) continue;
    const parts = line.split(' ');
    const url = parts[parts.length - 1];
    const ts = parts.length > 1 && /^\d{8}/.test(parts[0]) ? parts[0].slice(0, 8) : '';
    const p = canonicalPage(url);
    if (!p || (p.host !== domain && !p.host.endsWith('.' + domain))) continue;
    if (ASSET.test(p.path) || NOISE.test(p.path)) continue;
    total++;
    if (UTILITY.test(p.path)) { utility++; continue; }
    const key = p.host + p.path;
    const e = pages.get(key) || { days: new Set(), captures: 0, hosts: new Map() };
    let origHost = p.host;
    try { origHost = new URL(/^[a-z]+:\/\//i.test(url) ? url : 'http://' + url).hostname.toLowerCase(); } catch (_) { /* keep */ }
    e.hosts.set(origHost, (e.hosts.get(origHost) || 0) + 1);
    e.captures++;
    e.days.add(ts || String(e.captures)); // no timestamps: every capture counts
    pages.set(key, e);
  }
  const list = [...pages.entries()]
    .map(([key, e]) => ({ key, days: e.days.size, captures: e.captures, shown: [...e.hosts.entries()].sort((a, b) => b[1] - a[1])[0][0] }))
    .sort((a, b) => b.days - a.days || b.captures - a.captures || a.key.length - b.key.length)
    .slice(0, limit)
    .map(({ key, days, captures, shown }) => {
      const slash = key.indexOf('/');
      const host = slash < 0 ? key : key.slice(0, slash), path = slash < 0 ? '/' : key.slice(slash);
      return { url: `https://${shown}${path}`, host, path, days, captures };
    });
  return { found: list.length > 0, pages: list, sampled: total, utility, distinct: pages.size, truncated: lines.length >= 20000 };
}

/* ------------------------------------------------------------- link & keyword estimates ------------------------------------------------------------- */
// Linking root domains and ranking keywords can only be MEASURED by a crawler with a link index (Moz, Ahrefs, Majestic) or
// a keyword database (Semrush, Moz). No free source publishes them. These are model estimates with a range, never shown as
// measured values. Calibration point: mindinventory.com = Moz DA 48, 5.6k linking root domains, 7.2k ranking keywords.

const round2 = (n) => { if (!(n > 0)) return 0; const p = 10 ** Math.max(0, Math.floor(Math.log10(n)) - 1); return Math.round(n / p) * p; };
const band = (mid, factor) => ({ mid: round2(mid), low: round2(Math.max(1, mid / factor)), high: round2(mid * factor) });

// authority → log10(linking root domains). The curve steepens at the top: each point above ~85 needs far more domains.
// DA 20 ≈ 100 · DA 48 ≈ 5.6k (measured) · DA 65 ≈ 16k · DA 80 ≈ 45k · DA 90 ≈ 160k · DA 96 ≈ 1M
export const LRD_ANCHORS = [[0, 0.7], [10, 1.4], [20, 2], [35, 3], [48, 3.75], [65, 4.2], [80, 4.65], [90, 5.2], [96, 6], [100, 6.5]];

/**
 * Linking root domains. Authority scales (Moz DA, Ahrefs DR) are, by construction, logarithmic in the number of distinct
 * linking domains (anchors above; DA 48 → 5.6k is a measured Moz value). Strong archive interest
 * nudges it up, a site the archive ignores nudges it down. The range is wide (×/÷ 2.5) because sites with the same authority
 * can differ a lot in raw link count.
 */
export function estimateLinkingDomains({ score, archiveScore: A = null }) {
  if (!(score >= 0)) return null;
  let log = interpLin(score, LRD_ANCHORS);
  if (A != null) log += clamp((A - 50) / 50, -1, 1) * 0.15;
  const mid = 10 ** log;
  return { ...band(mid, 2.5), basis: A != null ? 'authority + archive interest' : 'authority' };
}

/**
 * Ranking keywords (in Google's top 50, all countries), from two independent measurements:
 *  · content size × authority: distinct pages in the Web Archive × keywords per page, which grows with authority
 *    (kw/page = 0.345 × 10^(authority / 40): ~5 at DA 48, ~60 at DA 90)
 *  · audience: Tranco rank, log-linear (log10 KW = 3.86 + 0.8 × (5.685 − log10 rank): #484k → ~7.2k, #1k → ~1M)
 * When both exist they are combined geometrically (and the range tightens).
 */
export function estimateKeywords({ score, pages = null, tranco = null }) {
  const ests = [];
  if (pages && pages.found && pages.distinct > 0 && !pages.truncated && score >= 0) ests.push({ v: pages.distinct * 0.345 * 10 ** (score / 40), from: 'pages' });
  if (tranco && tranco.ranked) ests.push({ v: 10 ** (3.86 + 0.8 * (5.685 - Math.log10(tranco.median))), from: 'rank' });
  if (!ests.length && score >= 0) ests.push({ v: 10 ** (0.6 + 0.068 * score), from: 'authority' }); // DA 48 → ~7k, DA 20 → ~90
  if (!ests.length) return null;
  const mid = 10 ** (ests.reduce((a, e) => a + Math.log10(Math.max(1, e.v)), 0) / ests.length);
  const factor = ests.length > 1 ? 2.2 : ests[0].from === 'authority' ? 4 : 3;
  const names = { pages: 'pages × authority', rank: 'traffic rank', authority: 'authority only' };
  return { ...band(mid, factor), basis: ests.map((e) => names[e.from]).join(' + ') };
}

/* ------------------------------------------------------------------ spam score ------------------------------------------------------------------ */

// TLDs with abuse rates far above average (Spamhaus / Interisle "most abused TLD" reports, recurring entries).
const RISKY_TLDS = new Set('xyz top click loan work gq tk ml cf ga icu buzz rest cfd sbs bond cyou monster quest support live online site shop store fun space website ru su cn pw ws cc biz info lol mom hair beauty skin makeup boats'.split(' '));

/**
 * Estimated spam score, Moz-style: each warning feature carries the share of sites with that feature that turn out to be
 * spammy, and the features combine as independent risks: 1 − Π(1 − pᵢ). 1–30 % low, 31–60 % medium, 61–100 % high.
 */
export function spamScore({ tranco, rdap, archive, dns, ageYears, archiveBlocked, archiveKnown = true }, domain, now = Date.now()) {
  const flags = [];
  const label = String(domain || '').split('.')[0] || '';
  const tld = String(domain || '').split('.').pop();
  const f = (id, title, p, hit, detail, known = true) => flags.push({ id, title, p, hit: !!hit && known, known, detail });
  f('resolve', 'Website resolves', 0.6, dns && !dns.resolves, dns ? (dns.resolves ? 'Has an address' : 'No A/AAAA record') : 'DNS unknown', !!dns);
  f('hold', 'Not on registry hold', 0.7, rdap && rdap.hold, rdap ? (rdap.hold ? 'Hold / pending delete' : 'Active') : 'Registry unknown', !!rdap);
  f('new', 'Older than 6 months', 0.35, ageYears != null && ageYears < 0.5, ageYears != null ? formatAge(ageYears) : 'Age unknown', ageYears != null);
  f('young', 'Older than 1 year', 0.15, ageYears != null && ageYears >= 0.5 && ageYears < 1, ageYears != null ? formatAge(ageYears) : 'Age unknown', ageYears != null);
  f('short', 'Registered for more than a year ahead', 0.1, rdap && rdap.expires && (Date.parse(rdap.expires) - now) / (365.25 * 864e5) < 1 && ageYears != null && ageYears < 2, rdap && rdap.expires ? `Expires ${formatDate(rdap.expires)}` : '—', !!(rdap && rdap.expires));
  // an established domain about to renew is normal (most renew automatically); a young one letting it lapse is a throwaway pattern
  f('expiring', 'Not about to expire', 0.08, rdap && rdap.expires && (Date.parse(rdap.expires) - now) / 864e5 < 45 && (ageYears == null || ageYears < 2), rdap && rdap.expires ? `Expires ${formatDate(rdap.expires)}` : '—', !!(rdap && rdap.expires));
  f('lock', 'Transfer lock', 0.04, rdap && !rdap.clientLock && !rdap.serverLock, rdap ? (rdap.clientLock || rdap.serverLock ? 'Locked' : 'Not locked') : '—', !!rdap);
  f('archived', 'In the Web Archive', 0.2, !archiveBlocked && (!archive || !archive.found), archiveBlocked ? 'Owner opted out' : archive && archive.found ? `${archive.yearsCaptured || 1}+ years of captures` : 'Never captured', archiveKnown || archiveBlocked);
  f('active', 'Regularly crawled', 0.08, archive && archive.found && !archive.firstOnly && archive.activeMonths24 < 4, archive && archive.found && !archive.firstOnly ? `${archive.activeMonths24} of the last 24 months` : '—', !!(archive && archive.found && !archive.firstOnly));
  f('mail', 'E-mail set up (MX or SPF)', 0.12, dns && !dns.mx.length && !dns.spf, dns ? (dns.mx.length ? 'MX present' : dns.spf ? 'SPF present' : 'None') : '—', !!dns);
  f('dmarc', 'DMARC policy', 0.03, dns && !dns.dmarc, dns ? (dns.dmarc ? `p=${dns.dmarcPolicy}` : 'Missing') : '—', !!dns);
  f('popular', 'Has a real audience (Tranco top 1M)', 0.05, tranco && !tranco.ranked, tranco ? (tranco.ranked ? `#${tranco.median.toLocaleString('en-US')}` : 'Not ranked') : '—', !!tranco);
  f('tld', 'Low-abuse TLD', 0.15, RISKY_TLDS.has(tld), `.${tld}`);
  f('name', 'Clean domain name', 0.08, (label.match(/-/g) || []).length >= 2 || (label.match(/\d/g) || []).length >= 3, label);
  f('length', 'Short domain name', 0.06, label.length > 20, `${label.length} characters`);
  const risk = 1 - flags.filter((x) => x.hit).reduce((a, x) => a * (1 - x.p), 1);
  const percent = Math.max(1, Math.min(100, Math.round(risk * 100)));
  return { percent, level: percent <= 30 ? 'low' : percent <= 60 ? 'medium' : 'high', flags, hits: flags.filter((x) => x.hit).length, checked: flags.filter((x) => x.known).length };
}

/** Fallback: Wayback "available" API asked for the closest capture to 1990 → the first capture. */
export function parseWaybackFirst(json) {
  const c = json && json.archived_snapshots && json.archived_snapshots.closest;
  if (!c || !c.available) return { found: false, firstOnly: true };
  return { found: true, firstOnly: true, firstSeen: tsToIso(c.timestamp) };
}

/** dns.google JSON answers → the records that matter for trust. `answers` is { A, AAAA, MX, TXT, DMARC, CAA, NS } of raw responses. */
export function parseDns(answers) {
  const data = (r, type) => (r && Array.isArray(r.Answer) ? r.Answer.filter((a) => !type || a.type === type).map((a) => String(a.data || '')) : []);
  const txt = (s) => s.replace(/^"|"$/g, '').replace(/"\s*"/g, '');
  const a = data(answers.A, 1), aaaa = data(answers.AAAA, 28);
  const mx = data(answers.MX, 15).map((m) => m.split(/\s+/).pop().replace(/\.$/, '')).filter((m) => m && m !== '.');
  const spf = data(answers.TXT, 16).map(txt).find((t) => /^v=spf1\b/i.test(t)) || '';
  const dmarc = data(answers.DMARC, 16).map(txt).find((t) => /^v=dmarc1\b/i.test(t)) || '';
  const dmarcPolicy = (/(?:^|;)\s*p\s*=\s*(none|quarantine|reject)/i.exec(dmarc) || [])[1] || '';
  const caa = data(answers.CAA, 257);
  const ns = data(answers.NS, 2).map((n) => n.replace(/\.$/, '').toLowerCase());
  const status = answers.A ? Number(answers.A.Status) : -1;
  return {
    resolves: a.length + aaaa.length > 0,
    nxdomain: status === 3,
    a, aaaa, mx, spf,
    spfStrict: /[-]all\b/i.test(spf),
    dmarc, dmarcPolicy: dmarcPolicy.toLowerCase(),
    caa,
    ns,
    dnssec: !!(answers.A && answers.A.AD),
  };
}

/* ------------------------------------------------------------------ scoring ------------------------------------------------------------------ */

export const TIERS = [
  [90, 'Exceptional', 'A household-name domain with one of the strongest link profiles on the web.'],
  [80, 'Very strong', 'A major site: links from it are highly valuable.'],
  [65, 'Strong', 'A well-established domain with a broad, healthy link profile.'],
  [50, 'Good', 'A solid, recognised domain that ranks competitively in its niche.'],
  [35, 'Moderate', 'An established site with a modest link profile.'],
  [20, 'Developing', 'Some authority, but few strong links point here yet.'],
  [10, 'Low', 'Little evidence of links or audience so far.'],
  [0, 'Very low', 'A new, small or inactive domain with no measurable authority.'],
];
export const tierOf = (score) => { const t = TIERS.find(([min]) => score >= min) || TIERS[TIERS.length - 1]; return { name: t[1], text: t[2] }; };

const yearsBetween = (iso, now) => { const t = Date.parse(iso); return Number.isFinite(t) ? Math.max(0, (now - t) / (365.25 * 864e5)) : null; };

/**
 * Trust & infrastructure points. Each check is only counted when its data source answered, so a registry without RDAP
 * does not pull the score down.
 */
export function trustScore({ dns, rdap }, now = Date.now()) {
  const checks = [];
  const add = (id, label, max, got, detail) => checks.push({ id, label, max, got: got ? max : 0, ok: !!got, detail });
  if (dns) {
    add('mx', 'Mail exchanger (MX)', 12, dns.mx.length > 0, dns.mx.length ? dns.mx.slice(0, 2).join(', ') : 'No MX records');
    add('spf', 'SPF record', 12, !!dns.spf, dns.spf ? (dns.spfStrict ? 'Strict (-all)' : 'Present') : 'Missing');
    checks.push({ id: 'spfStrict', label: 'Strict SPF (-all)', max: 4, got: dns.spfStrict ? 4 : 0, ok: dns.spfStrict, detail: dns.spfStrict ? 'Hard fail for unknown senders' : 'Soft or neutral' });
    add('dmarc', 'DMARC policy', 12, !!dns.dmarc, dns.dmarc ? `p=${dns.dmarcPolicy || '?'}` : 'Missing');
    checks.push({ id: 'dmarcEnf', label: 'DMARC enforced', max: 8, got: /quarantine|reject/.test(dns.dmarcPolicy) ? 8 : 0, ok: /quarantine|reject/.test(dns.dmarcPolicy), detail: dns.dmarcPolicy ? `p=${dns.dmarcPolicy}` : 'Not enforced' });
    add('caa', 'CAA (certificate authority lock)', 7, dns.caa.length > 0, dns.caa.length ? `${dns.caa.length} record${dns.caa.length > 1 ? 's' : ''}` : 'Any CA may issue');
    add('ns', 'Redundant name servers', 5, new Set(dns.ns).size >= 2, `${new Set(dns.ns).size} name server${new Set(dns.ns).size === 1 ? '' : 's'}`);
  }
  const signed = (rdap && rdap.found && rdap.dnssec) || (dns && dns.dnssec);
  if (dns || (rdap && rdap.found)) add('dnssec', 'DNSSEC', 10, signed, signed ? 'Signed' : 'Not signed');
  if (rdap && rdap.found) {
    add('clientLock', 'Registrar transfer lock', 8, rdap.clientLock, rdap.clientLock ? 'clientTransferProhibited' : 'Not locked');
    add('serverLock', 'Registry lock', 12, rdap.serverLock, rdap.serverLock ? 'Brand-grade registry lock' : 'None');
    const ahead = rdap.expires ? (Date.parse(rdap.expires) - now) / (365.25 * 864e5) : null;
    if (ahead != null) add('renew', 'Renewed > 1 year ahead', 6, ahead > 1, ahead > 0 ? `${ahead.toFixed(1)} years left` : 'Expired');
  }
  const max = checks.reduce((a, c) => a + c.max, 0);
  const got = checks.reduce((a, c) => a + c.got, 0);
  if (!max) return { available: false, score: 0, checks };
  let score = (100 * got) / max;
  if (dns && !dns.resolves) score = 0;
  return { available: true, score: clamp(score), checks };
}

export function archiveScore(archive) {
  if (!archive || !archive.found || archive.firstOnly) return null;
  const base = interpLog(archive.perMonth + 1, ARCHIVE_ANCHORS);
  const consistency = 0.6 + 0.4 * (archive.activeMonths24 / 24);
  return clamp(base * consistency);
}

/** Tranco data → popularity score, discounted when the domain is only in some of the 30 daily lists (near the 1M edge). */
export function popularityScore(tranco) {
  if (!tranco || !tranco.ranked) return null;
  const s = rankScore(tranco.median);
  const presence = Math.min(1, tranco.days / 30);
  return clamp(s - (1 - presence) * 8);
}

/**
 * The full model. `src` = { tranco, opr, rdap, archive, dns } — each either parsed data, or { error } when the source failed,
 * or undefined while loading / when not configured (opr without a key).
 */
export function scoreAuthority(src, { now = Date.now(), shared = false, domain = '' } = {}) {
  const ok = (x) => x && !x.error;
  const tranco = ok(src.tranco) ? src.tranco : null;
  const opr = ok(src.opr) && src.opr.found ? src.opr : null;
  const rdap = ok(src.rdap) && src.rdap.found ? src.rdap : null;
  const archive = ok(src.archive) && src.archive.found ? src.archive : null;
  const dns = ok(src.dns) ? src.dns : null;

  // ---- supporting signals ----
  const A = archiveScore(archive);
  const ageFrom = rdap && rdap.registered ? 'registry' : archive && archive.firstSeen ? 'archive' : '';
  const ageYears = ageFrom === 'registry' ? yearsBetween(rdap.registered, now) : ageFrom === 'archive' ? yearsBetween(archive.firstSeen, now) : null;
  // the first archive capture is a lower bound of the real age: the domain may have existed (unarchived) before
  const G = ageYears != null ? ageScore(ageYears) : null;
  const T = trustScore({ dns, rdap }, now);

  // ---- link / popularity core ----
  const P = popularityScore(tranco);
  const O = opr ? oprScore(opr.pr) : null;
  let L, coreFrom;
  if (P != null && O != null) { L = 0.55 * P + 0.45 * O; coreFrom = 'tranco+opr'; }
  else if (P != null) { L = P; coreFrom = 'tranco'; }
  else if (O != null) { L = tranco && !tranco.ranked ? Math.min(O, 55) : O; coreFrom = 'opr'; }
  else if (A != null) { L = Math.min(38, 0.6 * A); coreFrom = 'archive'; }
  else { L = 0; coreFrom = 'none'; }

  // ---- supporting blend (weights renormalised over what is available) ----
  const sup = [[A, 0.45], [G, 0.35], [T.available ? T.score : null, 0.2]].filter(([v]) => v != null);
  const wSum = sup.reduce((a, [, w]) => a + w, 0);
  const S = wSum ? sup.reduce((a, [v, w]) => a + v * w, 0) / wSum : null;

  let score = S != null ? 0.78 * L + 0.22 * S : L;
  if (dns && !dns.resolves) score = Math.min(score, 5);
  if (rdap && rdap.hold) score = Math.min(score, 10);
  score = Math.round(clamp(score));

  // ---- confidence: how much evidence there is, and whether the link sources agree ----
  let conf = 0;
  if (tranco) conf += 0.34;
  if (opr || (ok(src.opr) && !src.opr.found)) conf += 0.22;
  if (archive && !archive.firstOnly) conf += 0.2; else if (archive) conf += 0.08;
  if (rdap) conf += 0.12; else if (ageFrom === 'archive') conf += 0.05;
  if (dns) conf += 0.08;
  if (!opr && tranco && tranco.ranked) conf += 0.1; // a stable Tranco rank on its own is already strong evidence
  if (P != null && O != null && Math.abs(P - O) > 25) conf -= 0.12;
  if (tranco && tranco.ranked && tranco.worst / tranco.best > 3) conf -= 0.05;
  conf = clamp(conf, 0.05, 1);
  const confidence = conf >= 0.72 ? 'High' : conf >= 0.48 ? 'Medium' : 'Low';
  const margin = Math.round(2 + (1 - conf) * 12);

  const parts = [
    { id: 'core', label: 'Link popularity', weight: 78, score: Math.round(L), available: coreFrom !== 'none', from: coreFrom },
    { id: 'archive', label: 'Web Archive interest', weight: 0, score: A != null ? Math.round(A) : null, available: A != null },
    { id: 'age', label: 'Domain age', weight: 0, score: G != null ? Math.round(G) : null, available: G != null, from: ageFrom },
    { id: 'trust', label: 'Trust & infrastructure', weight: 0, score: T.available ? Math.round(T.score) : null, available: T.available },
  ];
  // the effective weights the user sees (they add up to 100)
  const eff = { archive: 0.45, age: 0.35, trust: 0.2 };
  for (const p of parts) {
    if (p.id === 'core') { p.weight = S != null ? 78 : 100; continue; }
    p.weight = p.available && wSum ? Math.round((22 * eff[p.id]) / wSum) : 0;
  }

  return {
    score,
    low: Math.max(0, score - margin),
    high: Math.min(100, score + margin),
    margin,
    confidence,
    confidenceValue: Math.round(conf * 100),
    tier: tierOf(score),
    parts,
    core: { P: P != null ? Math.round(P) : null, O: O != null ? Math.round(O) : null, from: coreFrom },
    ageYears,
    ageFrom,
    trust: T,
    links: estimateLinkingDomains({ score, archiveScore: A }),
    keywords: estimateKeywords({ score, pages: ok(src.pages) ? src.pages : null, tranco }),
    spam: spamScore({ tranco, rdap, archive, dns, ageYears, archiveBlocked: !!(ok(src.archive) && src.archive.blocked), archiveKnown: !!ok(src.archive) }, domain, now),
    risks: riskSignals({ tranco, rdap, archive, dns, ageYears, ageFrom, shared, P, O, archiveBlocked: !!(ok(src.archive) && src.archive.blocked) }, now),
  };
}

/** Warning signs, worst first. level: bad | warn | info | good */
export function riskSignals({ tranco, rdap, archive, dns, ageYears, ageFrom, shared, P, O, archiveBlocked = false }, now = Date.now()) {
  const out = [];
  const push = (level, title, detail) => out.push({ level, title, detail });
  if (dns && dns.nxdomain) push('bad', 'Domain does not exist', 'DNS answers NXDOMAIN: the name is not registered or not delegated.');
  else if (dns && !dns.resolves) push('bad', 'Domain does not resolve', 'No A or AAAA record: there is no website at this name.');
  if (rdap && rdap.hold) push('bad', 'Registry hold or pending delete', `Status: ${rdap.status.filter((s) => /hold|pending|redemption|inactive/.test(s)).join(', ')}`);
  if (ageYears != null && ageYears < 0.5 && ageFrom === 'registry') push('bad', 'Brand-new domain', `Registered ${Math.max(1, Math.round(ageYears * 12))} month(s) ago. New domains are a common spam pattern.`);
  else if (ageYears != null && ageYears < 1 && ageFrom === 'registry') push('warn', 'Young domain', 'Registered less than a year ago: authority takes time to build.');
  if (rdap && rdap.expires) {
    const days = (Date.parse(rdap.expires) - now) / 864e5;
    if (days < 0) push('bad', 'Registration expired', 'The registration end date has passed.');
    else if (days < 45) push('warn', 'Expires soon', `The registration ends in ${Math.round(days)} days.`);
  }
  if (archive && !archive.firstOnly && archive.total > 0 && archive.lastSeen && (now - Date.parse(archive.lastSeen)) / 864e5 > 730) push('warn', 'No recent archive activity', 'The Web Archive has not captured the homepage for over two years: the site may be inactive.');
  if (archiveBlocked) push('info', 'Excluded from the Web Archive', 'The owner asked the Internet Archive not to keep copies: archive interest is left out of the score.');
  else if (!archive && dns && dns.resolves) push('warn', 'Never archived', 'The Web Archive has no capture of this homepage: very few sites link to it.');
  if (dns && dns.resolves && !dns.mx.length && !dns.spf) push('info', 'No e-mail set up', 'No MX or SPF record. Real businesses almost always send e-mail from their domain.');
  if (dns && dns.mx.length && !dns.dmarc) push('info', 'No DMARC', 'Mail from this domain can be spoofed more easily.');
  if (tranco && tranco.ranked && tranco.worst / tranco.best > 3) push('info', 'Unstable popularity', `Its rank moved between #${tranco.best.toLocaleString('en-US')} and #${tranco.worst.toLocaleString('en-US')} in 30 days.`);
  if (P != null && O != null && Math.abs(P - O) > 25) push('info', 'Sources disagree', P > O ? 'Much more traffic than backlinks (often a popular app or a newer brand).' : 'Many more backlinks than traffic (an older or link-heavy site).');
  if (shared) push('info', 'Shared platform subdomain', 'This site lives on a hosting platform: its authority is its own, not the platform’s.');
  if (!out.some((r) => r.level === 'bad' || r.level === 'warn')) push('good', 'No warning signs', 'Nothing in the registration, DNS or archive history looks suspicious.');
  const order = { bad: 0, warn: 1, info: 2, good: 3 };
  return out.sort((a, b) => order[a.level] - order[b.level]);
}

/* ------------------------------------------------------------------ report ------------------------------------------------------------------ */

const fmtDate = (iso) => { if (!iso) return '—'; const d = new Date(iso); return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : '—'; };
export const formatDate = fmtDate;
export const formatAge = (y) => {
  if (y == null) return '—';
  if (y < 1) { const m = Math.max(1, Math.round(y * 12)); return `${m} month${m === 1 ? '' : 's'}`; }
  const whole = Math.floor(y), m = Math.floor((y - whole) * 12);
  return `${whole} year${whole === 1 ? '' : 's'}${m ? ` ${m} mo` : ''}`;
};

/** A plain-text / Markdown report of a result, for the Copy button. */
export function reportText(domain, res, src) {
  const L = [];
  L.push(`# Domain Authority — ${domain}`);
  L.push('');
  L.push(`Score: ${res.score}/100 (${res.tier.name}) · range ${res.low}–${res.high} · confidence ${res.confidence}`);
  if (res.links) L.push(`Linking root domains (estimated): ${res.links.mid.toLocaleString('en-US')} (likely ${res.links.low.toLocaleString('en-US')}–${res.links.high.toLocaleString('en-US')})`);
  if (res.keywords) L.push(`Ranking keywords (estimated): ${res.keywords.mid.toLocaleString('en-US')} (likely ${res.keywords.low.toLocaleString('en-US')}–${res.keywords.high.toLocaleString('en-US')})`);
  if (res.spam) L.push(`Spam score (estimated): ${res.spam.percent}% (${res.spam.level}) · ${res.spam.hits} of ${res.spam.checked} warning features`);
  L.push('');
  L.push('## Breakdown');
  for (const p of res.parts) L.push(`- ${p.label}: ${p.available ? `${p.score}/100 (weight ${p.weight}%)` : 'no data'}`);
  L.push('');
  L.push('## Data');
  const t = src.tranco && !src.tranco.error ? src.tranco : null;
  L.push(`- Tranco rank: ${t ? (t.ranked ? `#${t.latest.toLocaleString('en-US')} (30-day median #${t.median.toLocaleString('en-US')}, best #${t.best.toLocaleString('en-US')})` : 'not in the top 1M') : 'unavailable'}`);
  const o = src.opr && !src.opr.error ? src.opr : null;
  if (o) L.push(`- Open PageRank: ${o.found ? `${o.pr.toFixed(2)}/10${o.rank ? ` (global #${o.rank.toLocaleString('en-US')})` : ''}` : 'not found'}`);
  const r = src.rdap && !src.rdap.error && src.rdap.found ? src.rdap : null;
  L.push(`- Domain age: ${formatAge(res.ageYears)}${res.ageFrom === 'archive' ? ' (from first archive capture)' : ''}`);
  if (r) L.push(`- Registered: ${fmtDate(r.registered)} · expires ${fmtDate(r.expires)} · registrar ${r.registrar || '—'}`);
  const a = src.archive && !src.archive.error && src.archive.found ? src.archive : null;
  if (a) L.push(`- Web Archive: first seen ${fmtDate(a.firstSeen)}${a.firstOnly ? '' : ` · ${a.last12.toLocaleString('en-US')} captures in the last 12 months · ${a.total.toLocaleString('en-US')} in total`}`);
  const d = src.dns && !src.dns.error ? src.dns : null;
  if (d) L.push(`- DNS: MX ${d.mx.length ? 'yes' : 'no'} · SPF ${d.spf ? 'yes' : 'no'} · DMARC ${d.dmarcPolicy || 'no'} · DNSSEC ${(r && r.dnssec) || d.dnssec ? 'yes' : 'no'} · CAA ${d.caa.length ? 'yes' : 'no'}`);
  const pg = src.pages && !src.pages.error && src.pages.found ? src.pages : null;
  if (pg) {
    L.push('');
    L.push('## Top pages (by days archived in the Web Archive, last 12 months)');
    pg.pages.forEach((x, i) => L.push(`${i + 1}. ${x.url} — archived on ${x.days} days`));
  }
  L.push('');
  L.push('## Signals');
  for (const s of res.risks) L.push(`- [${s.level}] ${s.title}: ${s.detail}`);
  L.push('');
  L.push('Estimated by LinkLens from public data (Tranco, Open PageRank, RDAP, Wayback Machine, DNS). Comparable to, but not the same as, Moz DA.');
  return L.join('\n');
}
