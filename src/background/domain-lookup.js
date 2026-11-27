// Domain Authority lookups, run by the background worker. Only the DOMAIN NAME is ever sent (never the page, its URL path,
// cookies or anything about the user), only to these public services, and only when the Domain Authority panel asks:
//   · tranco-list.eu            popularity rank (top 1M, 30 daily lists)
//   · openpagerank (optional)   link-graph PageRank, only when the user saved their own free API key in Settings
//   · rdap.org → the registry   registration date, expiry, registrar, locks (the official successor of WHOIS)
//   · web.archive.org           how often the Wayback Machine captures the homepage
//   · dns.google                DNS-over-HTTPS: MX, SPF, DMARC, CAA, NS, DNSSEC
// Answers are cached in chrome.storage.local (per source, with a lifetime that matches how often the source changes).
import { parseTranco, parseOpr, parseRdap, parseSparkline, parseWaybackFirst, parseDns, parseDomainInput, parseTopPages } from '../shared/authority.js';
import { STORAGE_KEYS } from '../shared/constants.js';

const H = 3600e3;
const TTL = { tranco: 12 * H, opr: 7 * 24 * H, rdap: 3 * 24 * H, archive: 3 * 24 * H, dns: 6 * H, pages: 7 * 24 * H };
export const SOURCES = Object.keys(TTL);
const CACHE_PREFIX = 'mi_da:';
const cacheKey = (source, domain) => `${CACHE_PREFIX}${source}:${domain}`;

class LookupError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

async function getJson(url, { timeout = 15000, headers = {}, okStatuses = [] } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetch(url, { credentials: 'omit', cache: 'no-store', redirect: 'follow', referrerPolicy: 'no-referrer', headers: { Accept: 'application/json, application/rdap+json', ...headers }, signal: ctl.signal });
    if (res.status === 429) throw new LookupError('rate', 'The service is busy (rate limited). Try again in a minute.');
    if (!res.ok && !okStatuses.includes(res.status)) throw new LookupError(res.status === 404 ? 'notfound' : 'http', `The service answered ${res.status}.`);
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch (_) { throw new LookupError('parse', 'The service sent an unreadable answer.'); }
    return { status: res.status, json };
  } catch (e) {
    if (e instanceof LookupError) throw e;
    if (e && e.name === 'AbortError') throw new LookupError('timeout', 'The service did not answer in time.');
    throw new LookupError('network', 'The service could not be reached.');
  } finally { clearTimeout(timer); }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* Tranco allows about one request per second: requests are queued and spaced, and a 429 is retried with a back-off. */
let trancoChain = Promise.resolve();
let trancoLast = 0;
function trancoQueued(fn) {
  const run = trancoChain.then(async () => {
    const gap = Date.now() - trancoLast;
    if (gap < 1100) await wait(1100 - gap);
    try { return await fn(); } finally { trancoLast = Date.now(); }
  });
  trancoChain = run.catch(() => {});
  return run;
}

const FETCHERS = {
  async tranco(domain) {
    const url = `https://tranco-list.eu/api/ranks/domain/${encodeURIComponent(domain)}`;
    for (let attempt = 0; ; attempt++) {
      try {
        const { json } = await trancoQueued(() => getJson(url, { timeout: 15000 }));
        return parseTranco(json);
      } catch (e) {
        if (e.code === 'rate' && attempt < 3) { await wait(1500 * (attempt + 1)); continue; }
        throw e;
      }
    }
  },

  async opr(domain) {
    const key = await oprKey();
    if (!key) return { needsKey: true };
    const url = `https://openpagerank.keywordseverywhere.com/api/v1.0/getPageRank?domains%5B0%5D=${encodeURIComponent(domain)}`;
    try {
      const { json } = await getJson(url, { headers: { 'API-OPR': key }, timeout: 15000 });
      return parseOpr(json, domain);
    } catch (e) {
      if (/40[13]/.test(e.message)) throw new LookupError('key', 'Open PageRank rejected the API key. Check it in Settings.');
      throw e;
    }
  },

  async rdap(domain) {
    try {
      const { json } = await getJson(`https://rdap.org/domain/${encodeURIComponent(domain)}`, { timeout: 15000 });
      const r = parseRdap(json);
      if (!r.found) throw new LookupError('parse', 'The registry sent no domain record.');
      return r;
    } catch (e) {
      // rdap.org answers 404 both for "no RDAP service for this TLD" (.de, .es …) and for "not registered"
      if (e.code === 'notfound') return { found: false, unsupported: true };
      throw e;
    }
  },

  async archive(domain) {
    // monthly homepage captures (needs the web.archive.org host permission: the endpoint sends no CORS headers)
    try {
      const { json } = await getJson(`https://web.archive.org/__wb/sparkline?output=json&url=${encodeURIComponent(domain)}&collapse=timestamp:4`, { timeout: 25000 });
      const s = parseSparkline(json);
      if (s.found || s.blocked) return s;
      // homepage never captured under the bare name: try www.
      const www = await getJson(`https://web.archive.org/__wb/sparkline?output=json&url=${encodeURIComponent('www.' + domain)}&collapse=timestamp:4`, { timeout: 20000 }).catch(() => null);
      if (www) { const s2 = parseSparkline(www.json); if (s2.found) return s2; }
      return s;
    } catch (e) {
      // fallback with CORS: only the first capture (still gives a "first seen" date for the age)
      const { json } = await getJson(`https://archive.org/wayback/available?url=${encodeURIComponent(domain)}&timestamp=19900101`, { timeout: 15000 });
      return parseWaybackFirst(json);
    }
  },

  async pages(domain) {
    // every successful HTML capture of the domain (and its subdomains) in the last 12 months, URLs only
    const since = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10).replace(/-/g, '');
    const url = `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(domain)}&matchType=domain&from=${since}&fl=timestamp,original&filter=statuscode:200&filter=mimetype:text/html&limit=20000`;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 75000); // the archive needs 20–40 s for a busy domain
    try {
      const res = await fetch(url, { credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', signal: ctl.signal });
      if (res.status === 429) throw new LookupError('rate', 'The Web Archive is busy. Try again in a minute.');
      const text = await res.text();
      if (!res.ok || /^\s*</.test(text)) throw new LookupError('http', /Temporarily Offline/i.test(text) ? 'The Web Archive page index is temporarily offline. Try again later.' : `The Web Archive answered ${res.status}.`);
      return parseTopPages(text, domain);
    } catch (e) {
      if (e instanceof LookupError) throw e;
      if (e && e.name === 'AbortError') throw new LookupError('timeout', 'The Web Archive took too long to list the pages.');
      throw new LookupError('network', 'The Web Archive could not be reached.');
    } finally { clearTimeout(timer); }
  },

  async dns(domain) {
    const q = (name, type, extra = '') => getJson(`https://dns.google/resolve?name=${encodeURIComponent(name)}&type=${type}${extra}`, { timeout: 10000 }).then((r) => r.json).catch(() => null);
    const [A, AAAA, MX, TXT, DMARC, CAA, NS] = await Promise.all([
      q(domain, 'A', '&do=1'), q(domain, 'AAAA'), q(domain, 'MX'), q(domain, 'TXT'), q(`_dmarc.${domain}`, 'TXT'), q(domain, 'CAA'), q(domain, 'NS'),
    ]);
    if (!A && !NS) throw new LookupError('network', 'DNS could not be queried.');
    const d = parseDns({ A, AAAA, MX, TXT, DMARC, CAA, NS });
    if (!d.resolves && !d.nxdomain) {
      // apex without an address but www has one (common for older setups)
      const w = await q(`www.${domain}`, 'A');
      if (w && Array.isArray(w.Answer) && w.Answer.some((x) => x.type === 1 || x.type === 5)) d.resolves = true;
    }
    return d;
  },
};

async function oprKey() {
  try {
    const res = await chrome.storage.local.get(STORAGE_KEYS.DA_KEYS);
    const k = res[STORAGE_KEYS.DA_KEYS] && res[STORAGE_KEYS.DA_KEYS].opr;
    return typeof k === 'string' ? k.trim() : '';
  } catch (_) { return ''; }
}

/** One source for one domain → { ok, data, at, cached } or { ok: false, error, code }. */
export async function lookup(domainInput, source, { fresh = false } = {}) {
  const p = parseDomainInput(domainInput);
  if (!p.ok) return { ok: false, error: p.error, code: 'input' };
  const domain = p.domain;
  if (!FETCHERS[source]) return { ok: false, error: 'Unknown source', code: 'input' };
  const key = cacheKey(source, domain);
  if (!fresh) {
    try {
      const hit = (await chrome.storage.local.get(key))[key];
      if (hit && Date.now() - hit.at < TTL[source] && hit.data && !(source === 'opr' && hit.data.needsKey)) return { ok: true, data: hit.data, at: hit.at, cached: true };
    } catch (_) { /* no cache */ }
  }
  try {
    const data = await FETCHERS[source](domain);
    const at = Date.now();
    if (!(source === 'opr' && data.needsKey)) { try { await chrome.storage.local.set({ [key]: { at, data } }); } catch (_) { /* quota */ } }
    return { ok: true, data, at, cached: false };
  } catch (e) {
    return { ok: false, error: (e && e.message) || 'Lookup failed', code: (e && e.code) || 'error' };
  }
}

/** Expired cache entries are removed once per worker start. */
export async function pruneCache() {
  try {
    const all = await chrome.storage.local.get(null);
    const dead = Object.entries(all).filter(([k, v]) => {
      if (!k.startsWith(CACHE_PREFIX)) return false;
      const src = k.slice(CACHE_PREFIX.length).split(':')[0];
      return !v || !v.at || Date.now() - v.at > (TTL[src] || H) * 2;
    }).map(([k]) => k);
    if (dead.length) await chrome.storage.local.remove(dead);
  } catch (_) { /* noop */ }
}

/** Domains looked up recently (newest first), from the cache. */
export async function recentDomains(limit = 6) {
  try {
    const all = await chrome.storage.local.get(null);
    const seen = new Map();
    for (const [k, v] of Object.entries(all)) {
      if (!k.startsWith(CACHE_PREFIX) || !v) continue;
      const domain = k.slice(CACHE_PREFIX.length).split(':').slice(1).join(':');
      seen.set(domain, Math.max(seen.get(domain) || 0, v.at || 0));
    }
    return [...seen.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([d]) => d);
  } catch (_) { return []; }
}
