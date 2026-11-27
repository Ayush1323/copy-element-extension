// The Site Analyzer's crawler: reads a website the way a search bot would (robots.txt, sitemap, then the internal links,
// breadth first) and turns every page into plain data. No chrome.* here and fetch / DOMParser are passed in, so it is unit
// tested. The only requests are to the website being scanned.
import { readMeta, readHeadings, readLinks, readImages, readSchema, readSocial, buildChecks, scoreOf, pickHeaders, parseRobots, robotsAllows, parseSitemap } from '../content/core/seo.js';
import { pageTerms } from './site-keywords.js';

export const PAGE_LIMITS = Object.freeze([25, 50, 100, 200]);
export const DEFAULT_LIMIT = 50;
const CONCURRENCY = 4;
const TIMEOUT_MS = 15000;
const MAX_BYTES = 4 * 1024 * 1024;
const MAX_SITEMAPS = 6;
const MAX_SITEMAP_URLS = 3000;
export const THIN_WORDS = 200;
export const SLOW_MS = 2000;
export const AGENT = 'linklens';

export class CrawlError extends Error {}

/* ------------------------------ addresses ------------------------------ */

/** "https://www.Example.com/page?q=1" → "example.com". Returns '' for anything that is not a public domain name. */
export function normalizeDomain(input) {
  let s = String(input == null ? '' : input).trim();
  if (!s || /\s/.test(s)) return '';
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `http://${s.replace(/^\/+/, '')}`;
  let u;
  try { u = new URL(s); } catch (_) { return ''; }
  if (!/^https?:$/.test(u.protocol) || u.username || u.password) return '';
  const host = u.hostname.toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
  const labels = host.split('.');
  if (host.length > 253 || labels.length < 2) return '';
  if (!labels.every((l) => /^[a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9_])?$/.test(l))) return '';
  if (!/^([a-z]{2,}|xn--[a-z0-9-]+)$/.test(labels[labels.length - 1])) return ''; // rejects IP addresses
  return host;
}

/** What Chrome is asked for before a scan: this website (and its subdomains, e.g. www) only. */
export const originsFor = (domain) => [`*://*.${domain}/*`];
export const bareHost = (host) => String(host).toLowerCase().replace(/^www\./, '');

const TRACKING = /^(utm_[a-z]+|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid|_ga|ref_src)$/i;
const NOT_A_PAGE = /\.(jpe?g|png|gif|webp|avif|svg|ico|bmp|tiff?|pdf|docx?|xlsx?|pptx?|zip|rar|7z|gz|tar|dmg|exe|apk|mp[34]|webm|mov|avi|wav|ogg|css|js|mjs|json|xml|rss|atom|txt|csv|woff2?|ttf|otf|eot)$/i;
/** Links that do something when visited: never requested. */
const ACTION = /(^|[/?&=_-])(log-?out|sign-?out|delete|remove|unsubscribe|add-to-cart|add_to_cart)([/?&=_.-]|$)/i;

/** One spelling per page: no #fragment, no tracking parameters. Returns '' for anything that is not http(s). */
export function cleanUrl(url, base) {
  let u;
  try { u = new URL(url, base); } catch (_) { return ''; }
  if (!/^https?:$/.test(u.protocol)) return '';
  u.hash = '';
  u.username = '';
  u.password = '';
  for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
  return u.href;
}

export function isCrawlable(url, domain) {
  let u;
  try { u = new URL(url); } catch (_) { return false; }
  return bareHost(u.hostname) === domain && !NOT_A_PAGE.test(u.pathname) && !ACTION.test(u.pathname + u.search);
}

/* ------------------------------ one request ------------------------------ */

const abortError = () => Object.assign(new Error('Stopped'), { name: 'AbortError' });
const pause = (ms, signal) => new Promise((resolve, reject) => {
  if (signal && signal.aborted) { reject(abortError()); return; }
  const onAbort = () => { clearTimeout(t); reject(abortError()); };
  const t = setTimeout(() => { if (signal) signal.removeEventListener('abort', onAbort); resolve(); }, ms);
  if (signal) signal.addEventListener('abort', onAbort, { once: true });
});

/** GET → { url, status, redirected, headers, type, text, ms, bytes, error }. Only throws when the user stops the scan. */
async function get(url, { fetchImpl, signal, wantText = () => true, timeout = TIMEOUT_MS }) {
  if (signal && signal.aborted) throw abortError();
  const ctl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ctl.abort(); }, timeout);
  const onAbort = () => ctl.abort();
  if (signal) signal.addEventListener('abort', onAbort, { once: true });
  const started = Date.now();
  try {
    const res = await fetchImpl(url, { credentials: 'omit', cache: 'no-store', redirect: 'follow', signal: ctl.signal });
    const type = (res.headers.get('content-type') || '').toLowerCase();
    let text = '';
    if (res.ok && wantText(type) && !(Number(res.headers.get('content-length')) > MAX_BYTES)) text = (await res.text()).slice(0, MAX_BYTES);
    else ctl.abort(); // the body is not needed: stop the download
    return { url: res.url || url, status: res.status, redirected: !!res.redirected, headers: res.headers, type, text, ms: Date.now() - started, bytes: text.length, error: '' };
  } catch (e) {
    if (signal && signal.aborted) throw abortError();
    return { url, status: 0, redirected: false, headers: null, type: '', text: '', ms: Date.now() - started, bytes: 0, error: timedOut ? 'Timed out' : 'Could not be reached' };
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

/* ------------------------------ one page ------------------------------ */

const SKIP_TEXT = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'IFRAME']);
const CHROME_PARTS = new Set(['NAV', 'HEADER', 'FOOTER', 'ASIDE']);

/** The page's text, and the same without menus / header / footer (for keywords). */
function textOf(root) {
  const all = [], main = [];
  const walk = (node, boilerplate) => {
    for (const child of node.childNodes) {
      if (child.nodeType === 3) {
        const t = child.nodeValue.trim();
        if (t) { all.push(t); if (!boilerplate) main.push(t); }
      } else if (child.nodeType === 1) {
        const tag = child.nodeName.toUpperCase();
        if (!SKIP_TEXT.has(tag)) walk(child, boilerplate || CHROME_PARTS.has(tag));
      }
    }
  };
  if (root) walk(root, false);
  return { all: all.join(' '), main: main.join('\n') };
}
const countWords = (s) => (s.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length;

const HIDDEN = /display\s*:\s*none|visibility\s*:\s*hidden|font-size\s*:\s*0(?![.\d])|(left|text-indent)\s*:\s*-\d{4,}/i;
/** Links inside text that is hidden with an inline style (menus hidden this way are normal, so <nav> is left out). */
function hiddenLinks(doc) {
  const found = new Set();
  for (const el of doc.querySelectorAll('[style]')) {
    if (!HIDDEN.test(el.getAttribute('style')) || el.closest('nav, header, [role="menu"], [role="dialog"]')) continue;
    for (const a of el.matches('a[href]') ? [el] : el.querySelectorAll('a[href]')) {
      let u = null;
      try { u = new URL(a.getAttribute('href'), doc.baseURI); } catch (_) { /* ignore */ }
      if (u) found.add(a);
    }
  }
  return found.size;
}

const STATIC_WIN = { getComputedStyle: () => ({}) }; // a fetched page is not rendered

export function analyzePage(res, domain, DOMParserImpl) {
  const doc = new DOMParserImpl().parseFromString(res.text, 'text/html');
  let base = res.url;
  const baseEl = doc.querySelector('base[href]');
  if (baseEl) base = cleanUrl(baseEl.getAttribute('href'), res.url) || res.url;
  const meta = readMeta(doc, res.url);
  const report = {
    meta, headings: readHeadings(doc, STATIC_WIN), links: readLinks(doc, base), images: readImages(doc, STATIC_WIN),
    schema: readSchema(doc), social: readSocial(doc, res.url),
  };
  const headers = res.headers ? pickHeaders(res.headers) : null;
  const text = textOf(doc.body);
  const words = countWords(text.all);
  const checks = buildChecks(report, { status: res.status, headers }).map(({ id, level, title, detail, weight }) => ({ id, level, title, detail, weight }));
  checks.push({ id: 'content', level: words >= THIN_WORDS ? 'good' : words >= 50 ? 'warn' : 'bad', title: words >= THIN_WORDS ? 'Enough text content' : 'Thin content', detail: `${words} words (aim for at least ${THIN_WORDS}).`, weight: 8 });
  checks.push({ id: 'speed', level: res.ms <= SLOW_MS ? 'good' : res.ms <= SLOW_MS * 2 ? 'warn' : 'bad', title: res.ms <= SLOW_MS ? 'Fast response' : 'Slow response', detail: `The HTML took ${(res.ms / 1000).toFixed(1)} s to download.`, weight: 4 });

  const internal = new Set(), external = [];
  let trust = false;
  for (const l of report.links.items) {
    if (!l.abs || (l.type !== 'internal' && l.type !== 'external')) continue;
    const url = cleanUrl(l.abs);
    if (!url) continue;
    const u = new URL(url);
    if (bareHost(u.hostname) === domain) internal.add(url);
    else external.push({ host: bareHost(u.hostname), nofollow: l.nofollow || l.sponsored || l.ugc });
    if (/contact|about|privacy|terms|imprint|impressum/i.test(`${u.pathname} ${l.text}`)) trust = true;
  }
  const noindex = meta.robots.noindex || !!(headers && headers.xRobots.noindex);
  return {
    url: res.url, status: res.status, ms: res.ms, bytes: res.bytes,
    title: meta.title, description: meta.description, canonical: meta.canonical, noindex, https: meta.https,
    words, score: scoreOf(checks), checks,
    internal: [...internal], external, trust,
    scripts: doc.querySelectorAll('script[src]').length,
    images: report.images.counts.total, missingAlt: report.images.counts.missingAlt,
    h1: report.headings.counts[1], schema: report.schema.total,
    hiddenLinks: hiddenLinks(doc),
    terms: pageTerms({ title: meta.title, headings: report.headings.items.map((h) => ({ level: h.level, text: h.text })), body: text.main }),
  };
}

/* ------------------------------ the crawl ------------------------------ */

const isHtml = (type) => type === '' || type.includes('html');

async function findStart(domain, opts) {
  let last = null;
  for (const url of [`https://${domain}/`, `https://www.${domain}/`, `http://${domain}/`]) {
    const res = await get(url, { ...opts, wantText: isHtml });
    if (res.status) {
      if (bareHost(new URL(res.url).hostname) !== domain) throw new CrawlError(`${domain} redirects to ${new URL(res.url).hostname}. Scan that domain instead.`);
      if (res.status >= 400) throw new CrawlError(`The home page answered with HTTP ${res.status}. The site may be blocking automated requests.`);
      if (!isHtml(res.type) || !res.text) throw new CrawlError('The home page is not a readable HTML page.');
      return { requested: url, res };
    }
    last = res;
  }
  throw new CrawlError(`Could not open ${domain} (${last.error.toLowerCase()}). Check the address. A redirect to a different domain also causes this.`);
}

async function readSitemaps(listed, origin, domain, opts, DOMParserImpl) {
  const queue = [...new Set([...listed, `${origin}/sitemap.xml`].map((u) => cleanUrl(u, origin)).filter((u) => u && bareHost(new URL(u).hostname) === domain))];
  const urls = new Set();
  let found = 0;
  for (let i = 0; i < queue.length && i < MAX_SITEMAPS; i++) {
    const res = await get(queue[i], opts);
    if (!res.text) continue;
    const map = parseSitemap(res.text, DOMParserImpl);
    if (map.type === 'invalid' || (!map.urls.length && !map.sitemaps.length)) continue;
    found++;
    for (const s of map.sitemaps) { const u = cleanUrl(s.loc); if (u && bareHost(new URL(u).hostname) === domain && !queue.includes(u)) queue.push(u); }
    for (const e of map.urls) { const u = cleanUrl(e.loc); if (u && urls.size < MAX_SITEMAP_URLS && isCrawlable(u, domain)) urls.add(u); }
  }
  return { found: found > 0, urls: [...urls] };
}

/**
 * Scans up to `limit` pages. `signal` stops it: whatever was read so far is returned with `stopped: true`.
 * onProgress({ done, limit, queued, url }) is called as pages finish.
 */
export async function crawlSite(domain, { limit = DEFAULT_LIMIT, signal, fetchImpl = globalThis.fetch.bind(globalThis), DOMParserImpl = globalThis.DOMParser, onProgress = () => {}, sleep = pause } = {}) {
  const opts = { fetchImpl, signal };
  onProgress({ done: 0, limit, queued: 1, url: `https://${domain}/` });
  const home = await findStart(domain, opts);
  const start = cleanUrl(home.res.url);
  const origin = new URL(start).origin;

  const out = { domain, start, limit, pages: [], aliases: {}, blocked: [], robots: { found: false }, sitemap: { found: false, urls: [] }, stopped: false, discovered: 0, at: Date.now() };
  const seen = new Set([start, cleanUrl(home.requested)]);
  const queue = [];
  let rules = null;
  const allowed = (url) => { if (!rules) return true; const u = new URL(url); return robotsAllows(rules, u.pathname + u.search, AGENT).allowed; };
  const enqueue = (url) => {
    if (seen.has(url) || !isCrawlable(url, domain)) return;
    seen.add(url);
    if (allowed(url)) queue.push(url); else out.blocked.push(url);
  };
  const addPage = (page) => {
    out.pages.push(page);
    for (const u of page.internal || []) enqueue(u);
    onProgress({ done: out.pages.length, limit, queued: queue.length, url: page.url });
  };
  const broken = (url, res, why) => ({ url, status: res.status, ms: res.ms, error: why || res.error });

  try {
    const robots = await get(`${origin}/robots.txt`, { ...opts, wantText: (t) => !t.includes('html') });
    if (robots.status === 200 && robots.text) { rules = parseRobots(robots.text); out.robots.found = true; }
    out.sitemap = await readSitemaps(rules ? rules.sitemaps : [], origin, domain, opts, DOMParserImpl);
    if (home.requested !== start) out.aliases[cleanUrl(home.requested)] = start;
    addPage(analyzePage({ ...home.res, url: start }, domain, DOMParserImpl));

    const fromSitemap = [...out.sitemap.urls];
    while (out.pages.length < limit) {
      // pages reached through links come first; the sitemap fills what is left
      while (!queue.length && fromSitemap.length) enqueue(fromSitemap.shift());
      if (!queue.length) break;
      const batch = queue.splice(0, Math.min(CONCURRENCY, limit - out.pages.length));
      const results = await Promise.all(batch.map(async (url) => {
        let res = await get(url, { ...opts, wantText: isHtml });
        if (res.status === 429 || res.status === 503) { await sleep(2500, signal); res = await get(url, { ...opts, wantText: isHtml }); }
        return { url, res };
      }));
      // handled in queue order, so two scans of an unchanged site visit the same pages
      for (const { url, res } of results) {
        if (res.status === 0 || res.status >= 400) { addPage(broken(url, res)); continue; }
        const final = cleanUrl(res.url) || url;
        if (final !== url) {
          out.aliases[url] = final;
          if (bareHost(new URL(final).hostname) !== domain) continue; // redirects off the site: not a page of it
          if (seen.has(final) && (out.pages.some((p) => p.url === final) || results.some((r) => r.url === final))) continue;
          seen.add(final);
          const waiting = queue.indexOf(final);
          if (waiting >= 0) queue.splice(waiting, 1);
        }
        if (!isHtml(res.type) || !res.text) continue; // a file, not a page
        if (out.pages.some((p) => p.url === final)) continue;
        addPage(analyzePage({ ...res, url: final }, domain, DOMParserImpl));
      }
    }
  } catch (e) {
    if (e.name !== 'AbortError') throw e;
    out.stopped = true;
    if (!out.pages.length) addPage(analyzePage({ ...home.res, url: start }, domain, DOMParserImpl));
  }
  out.discovered = new Set([...out.pages.map((p) => p.url), ...queue, ...out.sitemap.urls]).size;
  return out;
}
