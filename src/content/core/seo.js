// SEO panel: reads everything an SEO check needs from the page (meta tags, headings, links, images, structured data, social
// tags, resources, robots.txt, sitemap) and turns it into plain data plus a checklist and a score.
// Everything here works on a `document` that is passed in, so it can be tested without a browser.

const norm = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
const lower = (s) => norm(s).toLowerCase();

/* ------------------------------------------------------------------ meta */

function metaContent(doc, selector) {
  const el = doc.querySelector(selector);
  return el ? norm(el.getAttribute('content')) : null;
}
const named = (doc, name) => metaContent(doc, `meta[name="${name}" i]`);
const prop = (doc, name) => metaContent(doc, `meta[property="${name}" i]`) ?? metaContent(doc, `meta[name="${name}" i]`);

/** Parse robots directives ("noindex, nofollow, max-snippet:-1") from every robots / googlebot meta tag. */
export function parseRobotsMeta(values) {
  const tokens = [];
  for (const v of values) for (const t of String(v || '').split(',')) { const x = lower(t); if (x) tokens.push(x); }
  const none = tokens.includes('none');
  return { raw: values.filter(Boolean).join(' | '), tokens, noindex: none || tokens.includes('noindex'), nofollow: none || tokens.includes('nofollow') };
}

export function titleStatus(len) { return len === 0 ? 'bad' : len < 30 || len > 60 ? 'warn' : 'good'; }
export function descriptionStatus(len) { return len === 0 ? 'bad' : len < 70 || len > 160 ? 'warn' : 'good'; }

export function readMeta(doc, url) {
  const base = new URL(url);
  const title = norm(doc.title);
  const description = named(doc, 'description');
  const canonEl = doc.querySelector('link[rel~="canonical" i]');
  const canonRaw = canonEl ? canonEl.getAttribute('href') : null;
  let canonical = null;
  try { canonical = canonRaw ? new URL(canonRaw, base).href : null; } catch (_) { /* invalid canonical */ }
  const strip = (u) => String(u).replace(/#.*$/, '').replace(/\/$/, '');
  const robots = parseRobotsMeta([named(doc, 'robots'), named(doc, 'googlebot')].filter((x) => x != null));
  const icon = doc.querySelector('link[rel~="icon" i], link[rel="shortcut icon" i], link[rel="apple-touch-icon" i]');
  let favicon = null;
  try { favicon = icon ? new URL(icon.getAttribute('href'), base).href : null; } catch (_) { /* invalid */ }
  const hreflang = Array.from(doc.querySelectorAll('link[rel~="alternate" i][hreflang]')).map((l) => ({ lang: l.getAttribute('hreflang'), href: l.getAttribute('href') }));
  const rel = (r) => { const l = doc.querySelector(`link[rel~="${r}" i]`); return l ? l.getAttribute('href') : null; };
  return {
    url: base.href,
    host: base.host,
    https: base.protocol === 'https:',
    local: ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname) || base.hostname.endsWith('.localhost'),
    title, titleLen: Array.from(title).length, titleStatus: titleStatus(Array.from(title).length),
    description: description || '', hasDescription: description != null, descriptionLen: Array.from(description || '').length,
    descriptionStatus: descriptionStatus(Array.from(description || '').length),
    canonical, canonicalRaw: canonRaw, canonicalSelf: !!canonical && strip(canonical) === strip(base.href),
    robots,
    viewport: named(doc, 'viewport'),
    charset: doc.characterSet || doc.charset || '',
    lang: doc.documentElement.getAttribute('lang') || '',
    hreflang, favicon,
    prev: rel('prev'), next: rel('next'),
    amp: rel('amphtml'),
    themeColor: named(doc, 'theme-color'),
    generator: named(doc, 'generator'),
    author: named(doc, 'author'),
    keywords: named(doc, 'keywords'),
  };
}

/* -------------------------------------------------------------- headings */

export function readHeadings(doc, win) {
  const items = Array.from(doc.querySelectorAll('h1,h2,h3,h4,h5,h6')).map((el) => {
    let hidden = false;
    try { const cs = win.getComputedStyle(el); hidden = cs.display === 'none' || cs.visibility === 'hidden'; } catch (_) { /* detached */ }
    return { el, level: Number(el.tagName[1]), text: norm(el.textContent), hidden, skipped: false };
  });
  const counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
  let prev = 0;
  for (const it of items) {
    counts[it.level]++;
    if (prev && it.level > prev + 1) it.skipped = true;
    prev = it.level;
  }
  const issues = [];
  if (!counts[1]) issues.push({ level: 'bad', text: 'No H1 heading on the page.' });
  if (counts[1] > 1) issues.push({ level: 'warn', text: `${counts[1]} H1 headings: one per page is the usual advice.` });
  if (items.length && items[0].level !== 1 && counts[1]) issues.push({ level: 'warn', text: `The first heading is an H${items[0].level}, not the H1.` });
  const skips = items.filter((i) => i.skipped).length;
  if (skips) issues.push({ level: 'warn', text: `${skips} heading${skips > 1 ? 's' : ''} skip a level (for example H2 straight to H4).` });
  const empty = items.filter((i) => !i.text).length;
  if (empty) issues.push({ level: 'bad', text: `${empty} empty heading${empty > 1 ? 's' : ''}.` });
  const long = items.filter((i) => i.level === 1 && Array.from(i.text).length > 70).length;
  if (long) issues.push({ level: 'warn', text: 'An H1 is longer than 70 characters.' });
  return { items, counts, issues };
}

/** The outline as Markdown ("## Heading"), for copying. */
export const headingsMarkdown = (h) => h.items.map((i) => `${'#'.repeat(i.level)} ${i.text}`).join('\n');

/* ----------------------------------------------------------------- links */

const GENERIC_ANCHORS = new Set(['click here', 'here', 'read more', 'more', 'learn more', 'link', 'this', 'click', 'details', 'continue']);
const sameSite = (a, b) => a.replace(/^www\./, '') === b.replace(/^www\./, '');

export function readLinks(doc, url) {
  const base = new URL(url);
  const seen = new Map();
  const items = [];
  for (const a of doc.querySelectorAll('a[href], area[href]')) {
    const raw = a.getAttribute('href').trim();
    let abs = null;
    try { abs = new URL(raw, base); } catch (_) { /* unparsable */ }
    let type = 'external';
    if (!abs) type = 'invalid';
    else if (/^javascript:/i.test(raw)) type = 'js';
    else if (abs.protocol === 'mailto:') type = 'mail';
    else if (abs.protocol === 'tel:') type = 'tel';
    else if (!/^https?:$/.test(abs.protocol)) type = 'other';
    else if (raw.startsWith('#') || (abs.href.replace(/#.*$/, '') === base.href.replace(/#.*$/, '') && abs.hash)) type = 'anchor';
    else if (sameSite(abs.hostname, base.hostname)) type = 'internal';
    const rel = lower(a.getAttribute('rel')).split(' ').filter(Boolean);
    let text = norm(a.textContent);
    let textSource = 'text';
    if (!text) { const img = a.querySelector('img[alt]'); if (img && norm(img.getAttribute('alt'))) { text = norm(img.getAttribute('alt')); textSource = 'image alt'; } }
    if (!text && a.getAttribute('aria-label')) { text = norm(a.getAttribute('aria-label')); textSource = 'aria-label'; }
    if (!text && a.getAttribute('title')) { text = norm(a.getAttribute('title')); textSource = 'title'; }
    const issues = [];
    if (!text) issues.push('No anchor text');
    else if (GENERIC_ANCHORS.has(lower(text))) issues.push('Generic anchor text');
    if (type === 'js') issues.push('javascript: link');
    if (raw === '#' || raw === '') issues.push('Empty link target');
    if (abs && type === 'external' && base.protocol === 'https:' && abs.protocol === 'http:') issues.push('Insecure http:// link');
    const key = abs ? abs.href : raw;
    const dup = seen.get(key);
    seen.set(key, (dup || 0) + 1);
    items.push({
      el: a, href: raw, abs: abs ? abs.href : null, type, text, textSource, rel,
      nofollow: rel.includes('nofollow'), sponsored: rel.includes('sponsored'), ugc: rel.includes('ugc'),
      newTab: a.getAttribute('target') === '_blank', issues,
    });
  }
  const counts = { total: items.length, internal: 0, external: 0, nofollow: 0, issues: 0, unique: seen.size };
  for (const i of items) {
    if (i.type === 'internal') counts.internal++;
    if (i.type === 'external') counts.external++;
    if (i.nofollow || i.sponsored || i.ugc) counts.nofollow++;
    if (i.issues.length) counts.issues++;
  }
  return { items, counts };
}

export const linksCsv = (links) => ['url,type,anchor text,rel,issues', ...links.items.map((i) => [i.abs || i.href, i.type, i.text, i.rel.join(' '), i.issues.join('; ')].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))].join('\n');

/* ---------------------------------------------------------------- images */

const EXT = /\.([a-z0-9]{2,5})(?:[?#]|$)/i;
export const imageFormat = (src) => {
  if (/^data:image\/([a-z+]+)/i.test(src)) return RegExp.$1.replace('+xml', '');
  const m = EXT.exec(String(src).split('?')[0] + '?');
  return m ? m[1].toLowerCase().replace('jpeg', 'jpg') : '';
};

export function readImages(doc, win) {
  const items = [];
  for (const img of doc.querySelectorAll('img')) {
    const src = img.currentSrc || img.getAttribute('src') || '';
    if (!src) continue;
    const hasAlt = img.hasAttribute('alt');
    const alt = norm(img.getAttribute('alt'));
    let rw = 0, rh = 0;
    try { const r = img.getBoundingClientRect(); rw = Math.round(r.width); rh = Math.round(r.height); } catch (_) { /* detached */ }
    const nw = img.naturalWidth || 0, nh = img.naturalHeight || 0;
    const aw = Number(img.getAttribute('width')), ah = Number(img.getAttribute('height'));
    const tiny = (nw > 0 && nw <= 2 && nh <= 2) || (rw > 0 && rw <= 2 && rh <= 2) || (aw > 0 && aw <= 2 && ah > 0 && ah <= 2);
    const inLink = !!img.closest('a[href]');
    const issues = [];
    if (!tiny) {
      if (!hasAlt) issues.push('Missing alt attribute');
      else if (!alt && inLink) issues.push('Empty alt on a linked image');
      else if (alt && /\.(jpe?g|png|gif|webp|avif|svg)$/i.test(alt)) issues.push('Alt text looks like a file name');
      else if (Array.from(alt).length > 125) issues.push('Alt text is very long (over 125 characters)');
      if (nw && rw && nw > rw * 2 && nh > rh * 2 && nw > 300) issues.push(`Oversized: ${nw}×${nh} shown at ${rw}×${rh}`);
      if (!(img.getAttribute('width') && img.getAttribute('height')) && !(win.getComputedStyle(img).aspectRatio && win.getComputedStyle(img).aspectRatio !== 'auto')) issues.push('No width / height attributes (layout shift)');
    }
    items.push({
      el: img, src, alt, hasAlt, altState: !hasAlt ? 'missing' : alt ? 'ok' : 'empty', rw, rh, nw, nh, tiny, inLink,
      loading: img.getAttribute('loading') || '', srcset: !!img.getAttribute('srcset'), format: imageFormat(src), issues,
    });
  }
  const counts = { total: items.length, missingAlt: 0, emptyAlt: 0, oversized: 0, noSize: 0, issues: 0 };
  for (const i of items) {
    if (i.tiny) continue;
    if (i.altState === 'missing') counts.missingAlt++;
    if (i.altState === 'empty') counts.emptyAlt++;
    if (i.issues.some((x) => x.startsWith('Oversized'))) counts.oversized++;
    if (i.issues.some((x) => x.startsWith('No width'))) counts.noSize++;
    if (i.issues.length) counts.issues++;
  }
  return { items, counts };
}

/* ---------------------------------------------------------------- schema */

const REQUIRED = {
  Article: ['headline', 'author', 'datePublished', 'image'], NewsArticle: ['headline', 'author', 'datePublished', 'image'], BlogPosting: ['headline', 'author', 'datePublished', 'image'],
  Product: ['name', 'image', 'offers'], Organization: ['name', 'url'], LocalBusiness: ['name', 'address'], WebSite: ['name', 'url'], WebPage: ['name'],
  BreadcrumbList: ['itemListElement'], FAQPage: ['mainEntity'], Recipe: ['name', 'image', 'recipeIngredient'], Event: ['name', 'startDate', 'location'],
  VideoObject: ['name', 'thumbnailUrl', 'uploadDate'], JobPosting: ['title', 'description', 'datePosted', 'hiringOrganization', 'jobLocation'],
  Person: ['name'], SoftwareApplication: ['name', 'offers'], Review: ['itemReviewed', 'reviewRating', 'author'], HowTo: ['name', 'step'],
};
const asArray = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);

function collectNodes(data, out = []) {
  for (const n of asArray(data)) {
    if (!n || typeof n !== 'object') continue;
    if (n['@graph']) collectNodes(n['@graph'], out);
    if (n['@type']) out.push(n);
  }
  return out;
}

export function readSchema(doc) {
  const blocks = [];
  for (const s of doc.querySelectorAll('script[type="application/ld+json" i]')) {
    const text = s.textContent || '';
    let data = null, error = '';
    try { data = JSON.parse(text); } catch (e) { error = (e && e.message) || 'Invalid JSON'; }
    const nodes = data ? collectNodes(data) : [];
    const entities = nodes.map((n) => {
      const types = asArray(n['@type']).map(String);
      const need = [...new Set(types.flatMap((t) => REQUIRED[t.replace(/^.*[/#]/, '')] || []))];
      const missing = need.filter((k) => n[k] == null || n[k] === '' || (Array.isArray(n[k]) && !n[k].length));
      return { types, name: norm(n.name || n.headline || n.title || ''), missing };
    });
    blocks.push({ text, pretty: data ? JSON.stringify(data, null, 2) : text, error, entities, types: [...new Set(entities.flatMap((e) => e.types))] });
  }
  const typesOf = (sel, attr) => [...new Set(Array.from(doc.querySelectorAll(sel)).flatMap((e) => String(e.getAttribute(attr)).split(/\s+/)).map((t) => t.replace(/^.*[/#]/, '')).filter(Boolean))];
  const microdata = typesOf('[itemscope][itemtype]', 'itemtype');
  const rdfa = typesOf('[typeof]', 'typeof');
  const total = blocks.reduce((n, b) => n + b.entities.length, 0) + microdata.length + rdfa.length;
  return { blocks, microdata, rdfa, total, errors: blocks.filter((b) => b.error).length, missing: blocks.reduce((n, b) => n + b.entities.reduce((m, e) => m + (e.missing.length ? 1 : 0), 0), 0) };
}

/* ---------------------------------------------------------------- social */

export function readSocial(doc, url) {
  const abs = (u) => { try { return u ? new URL(u, url).href : ''; } catch (_) { return u || ''; } };
  const og = {};
  for (const k of ['title', 'description', 'image', 'url', 'type', 'site_name', 'locale', 'image:alt', 'image:width', 'image:height']) { const v = prop(doc, `og:${k}`); if (v != null) og[k] = k === 'image' || k === 'url' ? abs(v) : v; }
  const tw = {};
  for (const k of ['card', 'title', 'description', 'image', 'site', 'creator', 'image:alt']) { const v = prop(doc, `twitter:${k}`); if (v != null) tw[k] = k === 'image' ? abs(v) : v; }
  const issues = [];
  for (const k of ['title', 'description', 'image', 'url']) if (!og[k]) issues.push({ level: k === 'image' || k === 'title' ? 'bad' : 'warn', text: `og:${k} is missing` });
  if (!og.type) issues.push({ level: 'info', text: 'og:type is missing (defaults to "website")' });
  if (!tw.card) issues.push({ level: 'warn', text: 'twitter:card is missing' });
  if (og.title && Array.from(og.title).length > 90) issues.push({ level: 'warn', text: 'og:title is longer than 90 characters' });
  if (og.description && Array.from(og.description).length > 200) issues.push({ level: 'warn', text: 'og:description is longer than 200 characters' });
  return { og, twitter: tw, issues, hasOg: Object.keys(og).length > 0, hasTwitter: Object.keys(tw).length > 0 };
}

/* ------------------------------------------------------------- resources */

const typeOfResource = (e) => {
  const it = e.initiatorType;
  const ext = (EXT.exec(e.name.split('?')[0] + '?') || [])[1] || '';
  if (/^(woff2?|ttf|otf|eot)$/.test(ext)) return 'font'; // before "css": fonts are requested by stylesheets
  if (it === 'script' || ext === 'js' || ext === 'mjs') return 'script';
  if (ext === 'css' || (it === 'link' && !ext)) return 'style';
  if (it === 'img' || it === 'image' || /^(png|jpe?g|gif|webp|avif|svg|ico)$/.test(ext)) return 'image';
  if (it === 'fetch' || it === 'xmlhttprequest' || it === 'beacon') return 'fetch';
  if (it === 'iframe' || it === 'frame') return 'document';
  return 'other';
};

/** `entries` = performance.getEntriesByType('resource') (or lookalikes); `host` = the page's hostname. */
export function readResources(entries, host) {
  const items = entries.map((e) => {
    let h = '';
    try { h = new URL(e.name).hostname; } catch (_) { /* data: etc. */ }
    const size = e.transferSize || e.encodedBodySize || 0;
    return {
      url: e.name, type: typeOfResource(e), size, decoded: e.decodedBodySize || 0, duration: Math.round(e.duration || 0),
      thirdParty: !!h && !sameSite(h, host), host: h, blocking: e.renderBlockingStatus === 'blocking', protocol: e.nextHopProtocol || '', cached: e.transferSize === 0 && (e.decodedBodySize || 0) > 0,
    };
  }).filter((i) => !i.url.startsWith('data:'));
  const byType = {};
  let total = 0, third = 0, blocking = 0;
  for (const i of items) {
    const b = byType[i.type] || (byType[i.type] = { count: 0, size: 0 });
    b.count++; b.size += i.size; total += i.size;
    if (i.thirdParty) third++;
    if (i.blocking) blocking++;
  }
  return { items, byType, total, requests: items.length, thirdParty: third, blocking, hosts: [...new Set(items.filter((i) => i.thirdParty).map((i) => i.host))] };
}

/* -------------------------------------------------------- web vitals */

const LIMITS = { LCP: [2500, 4000], CLS: [0.1, 0.25], FCP: [1800, 3000], TTFB: [800, 1800], INP: [200, 500] };
export function rateVital(name, value) {
  const l = LIMITS[name];
  if (!l || value == null || Number.isNaN(value)) return 'none';
  return value <= l[0] ? 'good' : value <= l[1] ? 'warn' : 'bad';
}
export const formatVital = (name, v) => (v == null ? '—' : name === 'CLS' ? v.toFixed(3) : v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${Math.round(v)} ms`);

/** Cumulative layout shift as Chrome reports it: the worst "session window" of shifts. */
export function cumulativeShift(entries) {
  let best = 0, cur = 0, first = 0, last = 0;
  for (const e of entries) {
    if (e.hadRecentInput) continue;
    if (cur && e.startTime - last < 1000 && e.startTime - first < 5000) cur += e.value;
    else { cur = e.value; first = e.startTime; }
    last = e.startTime;
    best = Math.max(best, cur);
  }
  return best;
}

/* ------------------------------------------------------- navigation */

export function readNavigation(perf) {
  let n = null;
  try { n = perf.getEntriesByType('navigation')[0]; } catch (_) { /* not available */ }
  if (!n) return null;
  return {
    status: n.responseStatus || 0, redirects: n.redirectCount || 0, ttfb: Math.round(n.responseStart - n.startTime), dom: Math.round(n.domContentLoadedEventEnd - n.startTime),
    load: n.loadEventEnd > 0 ? Math.round(n.loadEventEnd - n.startTime) : 0, transfer: n.transferSize || 0, decoded: n.decodedBodySize || 0, protocol: n.nextHopProtocol || '', type: n.type || '',
  };
}

export const statusText = (s) => ({ 200: 'OK', 201: 'Created', 204: 'No Content', 301: 'Moved Permanently', 302: 'Found', 303: 'See Other', 307: 'Temporary Redirect', 308: 'Permanent Redirect', 400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 410: 'Gone', 429: 'Too Many Requests', 500: 'Server Error', 502: 'Bad Gateway', 503: 'Service Unavailable', 504: 'Gateway Timeout' }[s] || '');
export const statusLevel = (s) => (!s ? 'none' : s < 300 ? 'good' : s < 400 ? 'warn' : 'bad');

/** Response headers that matter for SEO and security, from a fetch() Headers object (or a plain map). */
export function pickHeaders(headers) {
  const get = (k) => (headers.get ? headers.get(k) : headers[k]) || '';
  const keys = ['content-type', 'x-robots-tag', 'cache-control', 'content-encoding', 'last-modified', 'etag', 'server', 'content-language', 'link', 'vary', 'age'];
  const security = ['strict-transport-security', 'content-security-policy', 'x-frame-options', 'x-content-type-options', 'referrer-policy', 'permissions-policy'];
  const all = [];
  if (headers.forEach) headers.forEach((v, k) => all.push([k, v])); else for (const k of Object.keys(headers)) all.push([k, headers[k]]);
  all.sort((a, b) => a[0].localeCompare(b[0]));
  return { seo: keys.map((k) => [k, get(k)]).filter(([, v]) => v), security: security.map((k) => [k, !!get(k)]), all, xRobots: parseRobotsMeta([get('x-robots-tag')]) };
}

/* ------------------------------------------------- robots.txt + sitemap */

/** Groups of rules per user-agent, plus every Sitemap line. */
export function parseRobots(text) {
  const groups = [];
  const sitemaps = [];
  let cur = null, lastWasAgent = false;
  for (const line0 of String(text || '').split(/\r?\n/)) {
    const line = line0.replace(/#.*$/, '').trim();
    if (!line) continue;
    const i = line.indexOf(':');
    if (i < 0) continue;
    const k = line.slice(0, i).trim().toLowerCase(), v = line.slice(i + 1).trim();
    if (k === 'user-agent') {
      if (!cur || !lastWasAgent) { cur = { agents: [], rules: [] }; groups.push(cur); }
      cur.agents.push(v.toLowerCase());
      lastWasAgent = true;
    } else if (k === 'sitemap') { sitemaps.push(v); lastWasAgent = false; } else if ((k === 'allow' || k === 'disallow') && cur) { cur.rules.push({ type: k, path: v }); lastWasAgent = false; } else if (k === 'crawl-delay' && cur) { cur.delay = v; lastWasAgent = false; } else lastWasAgent = false;
  }
  return { groups, sitemaps };
}

function ruleRegex(path) {
  const end = path.endsWith('$');
  const body = (end ? path.slice(0, -1) : path).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${body}${end ? '$' : ''}`);
}

/** Longest matching rule wins, Allow wins a tie (the Google rule). Returns { allowed, rule }. */
export function robotsAllows(parsed, path, agent = '*') {
  const a = agent.toLowerCase();
  let group = parsed.groups.find((g) => g.agents.some((x) => x !== '*' && a.includes(x)));
  if (!group) group = parsed.groups.find((g) => g.agents.includes('*'));
  if (!group) return { allowed: true, rule: null };
  let best = null;
  for (const r of group.rules) {
    if (!r.path) continue; // "Disallow:" with nothing means allow everything
    if (!ruleRegex(r.path).test(path)) continue;
    if (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.type === 'allow')) best = r;
  }
  return best ? { allowed: best.type === 'allow', rule: best } : { allowed: true, rule: null };
}

export function parseSitemap(xml, DOMParserImpl = (typeof DOMParser !== 'undefined' ? DOMParser : null)) {
  if (!DOMParserImpl) return { type: 'unknown', urls: [], sitemaps: [] };
  const doc = new DOMParserImpl().parseFromString(String(xml || ''), 'application/xml');
  if (doc.querySelector('parsererror')) return { type: 'invalid', urls: [], sitemaps: [] };
  const text = (el, tag) => { const n = el.getElementsByTagName(tag)[0]; return n ? norm(n.textContent) : ''; };
  const sitemaps = Array.from(doc.getElementsByTagName('sitemap')).map((s) => ({ loc: text(s, 'loc'), lastmod: text(s, 'lastmod') }));
  const urls = Array.from(doc.getElementsByTagName('url')).map((u) => ({ loc: text(u, 'loc'), lastmod: text(u, 'lastmod'), priority: text(u, 'priority'), changefreq: text(u, 'changefreq') }));
  return { type: sitemaps.length ? 'index' : 'urlset', urls, sitemaps };
}

export const sameUrl = (a, b) => String(a).replace(/#.*$/, '').replace(/\/$/, '') === String(b).replace(/#.*$/, '').replace(/\/$/, '');

/* -------------------------------------------------------------- checks */

/**
 * The checklist behind the score. Each check: { id, tab, level: good|warn|bad|info, title, detail, weight }.
 * `ctx` may carry { status, headers } once those were loaded.
 */
export function buildChecks(r, ctx = {}) {
  const c = [];
  const add = (id, tab, level, title, detail, weight) => c.push({ id, tab, level, title, detail, weight });
  const m = r.meta;
  add('title', 'overview', m.titleStatus, m.titleLen ? 'Title length' : 'Title is missing', m.titleLen ? `${m.titleLen} characters (30–60 is ideal).` : 'Add a <title>: it is the headline in search results.', 10);
  add('description', 'overview', m.descriptionStatus, m.descriptionLen ? 'Meta description length' : 'Meta description is missing', m.descriptionLen ? `${m.descriptionLen} characters (70–160 is ideal).` : 'Search engines show it under the title.', 8);
  const h1 = r.headings.counts[1];
  add('h1', 'headings', h1 === 1 ? 'good' : h1 === 0 ? 'bad' : 'warn', h1 === 1 ? 'One H1 heading' : h1 === 0 ? 'No H1 heading' : `${h1} H1 headings`, h1 === 1 ? 'Exactly one, as recommended.' : 'Use one clear H1 per page.', 10);
  add('hierarchy', 'headings', r.headings.items.some((i) => i.skipped) ? 'warn' : 'good', r.headings.items.some((i) => i.skipped) ? 'Heading levels are skipped' : 'Heading order is logical', 'Go H1 → H2 → H3 without jumping levels.', 4);
  add('canonical', 'overview', !m.canonical ? 'warn' : m.canonicalSelf ? 'good' : 'info', !m.canonical ? 'No canonical URL' : m.canonicalSelf ? 'Canonical points to this page' : 'Canonical points to another URL', !m.canonical ? 'A canonical tag avoids duplicate-content confusion.' : m.canonical, 6);
  const noindex = m.robots.noindex || (ctx.headers && ctx.headers.xRobots.noindex);
  add('indexable', 'overview', noindex ? 'bad' : 'good', noindex ? 'Page is set to noindex' : 'Page can be indexed', noindex ? 'Search engines are told not to index it.' : 'No noindex directive found.', 12);
  if (ctx.status) add('status', 'status', ctx.status === 200 ? 'good' : ctx.status < 400 ? 'warn' : 'bad', `HTTP ${ctx.status} ${statusText(ctx.status)}`.trim(), ctx.status === 200 ? 'The page loaded normally.' : 'Not a plain 200 response.', 12);
  add('https', 'overview', m.https ? 'good' : m.local ? 'info' : 'bad', m.https ? 'Served over HTTPS' : m.local ? 'Local address (HTTPS not needed)' : 'Not served over HTTPS', 'HTTPS is a ranking signal and protects visitors.', 6);
  add('viewport', 'overview', m.viewport ? 'good' : 'bad', m.viewport ? 'Mobile viewport is set' : 'No viewport meta tag', 'Needed for mobile-friendly rendering.', 6);
  add('lang', 'overview', m.lang ? 'good' : 'warn', m.lang ? `Language: ${m.lang}` : 'No lang attribute on <html>', 'Helps search engines and screen readers.', 3);
  const imgs = r.images.counts;
  add('alt', 'images', imgs.total === 0 ? 'info' : imgs.missingAlt ? (imgs.missingAlt > imgs.total / 3 ? 'bad' : 'warn') : 'good', imgs.total === 0 ? 'No images' : imgs.missingAlt ? `${imgs.missingAlt} image${imgs.missingAlt > 1 ? 's' : ''} without alt` : 'Every image has alt text', 'Alt text describes images to search engines and screen readers.', 8);
  if (imgs.oversized) add('oversized', 'images', 'warn', `${imgs.oversized} oversized image${imgs.oversized > 1 ? 's' : ''}`, 'Images are much larger than they are shown. Resize or use srcset.', 3);
  const l = r.links.counts;
  const badAnchors = r.links.items.filter((i) => i.issues.some((x) => /anchor text/.test(x))).length;
  add('anchors', 'links', badAnchors ? 'warn' : 'good', badAnchors ? `${badAnchors} link${badAnchors > 1 ? 's' : ''} with empty or generic text` : 'Links have descriptive text', 'Anchor text tells search engines what the target is about.', 4);
  void l;
  const ogFull = ['title', 'description', 'image', 'url'].every((k) => r.social.og[k]);
  add('og', 'social', ogFull ? 'good' : r.social.hasOg ? 'warn' : 'bad', ogFull ? 'Open Graph tags present' : r.social.hasOg ? 'Open Graph tags are incomplete' : 'No Open Graph tags', 'Controls how the page looks when shared on social networks.', 5);
  add('twitter', 'social', r.social.hasTwitter ? 'good' : 'warn', r.social.hasTwitter ? 'Twitter card present' : 'No Twitter card', 'twitter:card makes shared links show a rich preview.', 2);
  add('schema', 'schema', r.schema.errors ? 'bad' : r.schema.total ? (r.schema.missing ? 'warn' : 'good') : 'info', r.schema.errors ? 'Structured data has JSON errors' : r.schema.total ? (r.schema.missing ? 'Structured data is missing recommended properties' : 'Structured data found') : 'No structured data', r.schema.total ? `${r.schema.total} item${r.schema.total > 1 ? 's' : ''} found.` : 'Schema.org markup can earn rich results.', 4);
  add('favicon', 'overview', m.favicon ? 'good' : 'info', m.favicon ? 'Favicon set' : 'No favicon link', 'Shown in tabs and in mobile search results.', 2);
  return c;
}

/** 0–100: good counts fully, warn half, bad nothing; "info" checks are left out. */
export function scoreOf(checks) {
  let got = 0, max = 0;
  for (const c of checks) {
    if (c.level === 'info') continue;
    max += c.weight;
    got += c.level === 'good' ? c.weight : c.level === 'warn' ? c.weight / 2 : 0;
  }
  return max ? Math.round((got / max) * 100) : 0;
}
export const gradeOf = (s) => (s >= 90 ? 'Excellent' : s >= 75 ? 'Good' : s >= 55 ? 'Needs work' : 'Poor');

/** Everything for the tabs, read from the live page. */
export function readPage(doc, win, url = win.location.href) {
  const meta = readMeta(doc, url);
  return { meta, headings: readHeadings(doc, win), links: readLinks(doc, url), images: readImages(doc, win), schema: readSchema(doc), social: readSocial(doc, url), at: Date.now() };
}
