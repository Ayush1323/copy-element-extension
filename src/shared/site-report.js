// Turns a crawl (site-crawl.js) into the Site Analyzer's report. Every score is LinkLens's own, calculated here from what
// was read on the website, and every score can be explained line by line. Pure functions.
import { gradeOf, scoreOf } from '../content/core/seo.js';
import { siteKeywords } from './site-keywords.js';
import { THIN_WORDS, SLOW_MS, bareHost } from './site-crawl.js';

export { gradeOf };
export const HISTORY_SCANS = 30;
export const TOP_ROWS = 10;
const PAGE_WEIGHT = 0.6; // site score = 60% average page score + 40% site-wide checks

/* ------------------------------ internal link graph ------------------------------ */

/** PageRank over the internal links: `links[i]` = indexes page i links to. */
export function pageRank(links, damping = 0.85, rounds = 40) {
  const n = links.length;
  if (!n) return [];
  let rank = new Array(n).fill(1 / n);
  for (let r = 0; r < rounds; r++) {
    let loose = 0; // pages without links share their rank with everyone
    for (let i = 0; i < n; i++) if (!links[i].length) loose += rank[i];
    const next = new Array(n).fill((1 - damping) / n + (damping * loose) / n);
    for (let i = 0; i < n; i++) for (const j of links[i]) next[j] += (damping * rank[i]) / links[i].length;
    rank = next;
  }
  return rank;
}

/* ------------------------------ issues ------------------------------ */

const ISSUES = {
  broken: ['Broken pages', 'Fix or redirect these addresses and update the links that point to them.', 12],
  noindex: ['Pages hidden from search engines (noindex)', 'Remove noindex from pages that should be found.', 9],
  title: ['Title missing or the wrong length', 'Give every page a unique title of 30–60 characters.', 10],
  dupTitle: ['Duplicate titles', 'Each page needs its own title.', 8],
  h1: ['H1 heading missing or repeated', 'Use exactly one H1 per page.', 10],
  description: ['Meta description missing or the wrong length', 'Write a 70–160 character description for each page.', 8],
  dupDescription: ['Duplicate meta descriptions', 'Describe each page in its own words.', 5],
  content: ['Thin content', `Add useful text: aim for at least ${THIN_WORDS} words.`, 8],
  alt: ['Images without alt text', 'Describe every meaningful image with an alt attribute.', 8],
  canonical: ['No canonical URL', 'Add <link rel="canonical"> to avoid duplicate-content confusion.', 6],
  https: ['Not served over HTTPS', 'Serve every page over HTTPS.', 6],
  viewport: ['No mobile viewport', 'Add the viewport meta tag.', 6],
  orphan: ['Orphan pages (in the sitemap, linked from nowhere)', 'Link to these pages from related pages.', 5],
  speed: ['Slow pages', `Aim to send the HTML in under ${SLOW_MS / 1000} seconds.`, 4],
  og: ['Open Graph tags missing or incomplete', 'Add og:title, og:description, og:image and og:url.', 5],
  schema: ['Structured data problems', 'Fix JSON-LD errors and add the missing properties.', 4],
  anchors: ['Links with empty or generic text', 'Use link text that says where the link goes.', 4],
  hierarchy: ['Heading levels skipped', 'Go H1 → H2 → H3 without jumping levels.', 4],
  lang: ['No page language', 'Set lang on the <html> element.', 3],
  oversized: ['Oversized images', 'Resize images to the size they are shown at.', 3],
  twitter: ['No Twitter card', 'Add the twitter:card tag.', 2],
};

const duplicates = (pages, key) => {
  const groups = new Map();
  for (const p of pages) {
    const v = (p[key] || '').trim().toLowerCase();
    if (!v) continue;
    // pages that declare another page as canonical are expected to repeat it
    if (p.canonical && p.canonical.replace(/\/$/, '') !== p.url.replace(/\/$/, '')) continue;
    if (!groups.has(v)) groups.set(v, []);
    groups.get(v).push(p);
  }
  return [...groups.values()].filter((g) => g.length > 1);
};

/* ------------------------------ the report ------------------------------ */

const ratio = (n, of) => (of ? n / of : 0);
const share = (level) => (level === 'good' ? 1 : level === 'warn' ? 0.5 : 0);
const AREAS = [
  ['Content', ['title', 'description', 'content', 'h1', 'hierarchy']],
  ['Technical', ['indexable', 'status', 'https', 'canonical', 'viewport', 'lang', 'speed', 'favicon']],
  ['Links & images', ['anchors', 'alt', 'oversized']],
  ['Social & schema', ['og', 'twitter', 'schema']],
];

export function buildReport(crawl) {
  const ok = crawl.pages.filter((p) => p.score !== undefined);
  const failed = crawl.pages.filter((p) => p.score === undefined);
  const index = new Map(ok.map((p, i) => [p.url, i]));
  const resolve = (url) => { let u = url; for (let i = 0; i < 5 && crawl.aliases[u]; i++) u = crawl.aliases[u]; return u; };

  const graph = ok.map((p, i) => [...new Set(p.internal.map((u) => index.get(resolve(u))).filter((j) => j !== undefined && j !== i))]);
  const inlinks = ok.map(() => 0);
  for (const list of graph) for (const j of list) inlinks[j]++;
  const rank = pageRank(graph);
  const maxRank = Math.max(...rank, 0);
  const home = resolve(crawl.start);

  const pages = ok.map((p, i) => ({
    url: p.url, status: p.status, score: p.score, linkScore: maxRank ? Math.max(1, Math.round(100 * Math.sqrt(rank[i] / maxRank))) : 0,
    inlinks: inlinks[i], title: p.title, words: p.words, ms: p.ms, noindex: p.noindex,
    problems: p.checks.filter((c) => c.level === 'bad' || c.level === 'warn').length,
  }));

  /* broken addresses, with who links to them */
  const brokenPages = failed.map((p) => ({
    url: p.url, status: p.status, error: p.error,
    from: ok.filter((q) => q.internal.some((u) => resolve(u) === p.url)).map((q) => q.url).slice(0, 5),
  }));

  /* issues */
  const found = new Map();
  const add = (id, url, note, level) => {
    if (!ISSUES[id]) return;
    const e = found.get(id) || { id, title: ISSUES[id][0], fix: ISSUES[id][1], weight: ISSUES[id][2], level: 'warn', urls: [] };
    if (level === 'bad') e.level = 'bad';
    e.urls.push({ url, note });
    found.set(id, e);
  };
  for (const p of ok) {
    for (const c of p.checks) {
      if (c.level !== 'bad' && c.level !== 'warn') continue;
      add(c.id === 'indexable' ? 'noindex' : c.id, p.url, c.id === 'canonical' ? '' : c.detail && ['title', 'description', 'content', 'speed'].includes(c.id) ? c.detail : c.title, c.level);
    }
  }
  for (const b of brokenPages) add('broken', b.url, `${b.status ? `HTTP ${b.status}` : b.error}${b.from.length ? ` · linked from ${b.from[0]}` : ''}`, 'bad');
  const indexable = ok.filter((p) => !p.noindex);
  const dupT = duplicates(indexable, 'title'), dupD = duplicates(indexable, 'description');
  for (const g of dupT) for (const p of g) add('dupTitle', p.url, p.title, 'warn');
  for (const g of dupD) for (const p of g) add('dupDescription', p.url, p.description, 'warn');
  const inSitemap = new Set(crawl.sitemap.urls.map(resolve));
  // only meaningful when the whole site was read: otherwise the linking page may simply not have been visited
  const complete = !crawl.stopped && crawl.pages.length < crawl.limit;
  const orphans = complete ? ok.filter((p, i) => !inlinks[i] && inSitemap.has(p.url) && p.url !== home) : [];
  for (const p of orphans) add('orphan', p.url, 'No internal links point here', 'warn');
  const issues = [...found.values()].sort((a, b) => (a.level === b.level ? b.weight * b.urls.length - a.weight * a.urls.length : a.level === 'bad' ? -1 : 1));

  /* external domains the site links to */
  const ext = new Map();
  for (const p of ok) {
    for (const l of p.external) {
      const e = ext.get(l.host) || { domain: l.host, pages: new Set(), links: 0, nofollow: 0 };
      e.pages.add(p.url);
      e.links++;
      if (l.nofollow) e.nofollow++;
      ext.set(l.host, e);
    }
  }
  const domains = [...ext.values()].map((e) => ({ domain: e.domain, pages: e.pages.size, links: e.links, nofollow: e.nofollow }))
    .sort((a, b) => b.pages - a.pages || b.links - a.links || a.domain.localeCompare(b.domain));

  /* site-wide checks */
  const n = ok.length;
  const avgMs = Math.round(ratio(ok.reduce((s, p) => s + p.ms, 0), n));
  const level = (good, warn) => (good ? 'good' : warn ? 'warn' : 'bad');
  const https = ok.every((p) => p.https);
  const brokenShare = ratio(brokenPages.length, crawl.pages.length);
  const noindexShare = ratio(ok.length - indexable.length, n);
  const dupCount = dupT.reduce((s, g) => s + g.length, 0);
  const siteChecks = [
    { label: 'HTTPS everywhere', level: level(https, false), weight: 10, detail: https ? 'Every scanned page uses HTTPS.' : 'Some pages are served over plain HTTP.' },
    { label: 'No broken pages', level: level(!brokenPages.length, brokenShare <= 0.05), weight: 12, detail: `${brokenPages.length} of ${crawl.pages.length} addresses failed.` },
    { label: 'Pages open to search engines', level: level(noindexShare <= 0.1, noindexShare <= 0.4), weight: 8, detail: `${n - indexable.length} of ${n} pages are noindex.` },
    { label: 'Unique titles', level: level(!dupCount, ratio(dupCount, n) <= 0.15), weight: 8, detail: `${dupCount} pages share a title.` },
    { label: 'robots.txt', level: level(crawl.robots.found, true), weight: 4, detail: crawl.robots.found ? 'Found.' : 'Not found.' },
    { label: 'XML sitemap', level: level(crawl.sitemap.found, true), weight: 6, detail: crawl.sitemap.found ? `Found, ${crawl.sitemap.urls.length} addresses read.` : 'Not found.' },
    { label: 'Response time', level: level(avgMs <= SLOW_MS / 2, avgMs <= SLOW_MS), weight: 6, detail: `${avgMs} ms on average.` },
    { label: 'Structured data on the home page', level: level((ok.find((p) => p.url === home) || {}).schema > 0, true), weight: 4, detail: 'Schema.org markup helps search engines understand the site.' },
  ];
  const pageScore = Math.round(ratio(ok.reduce((s, p) => s + p.score, 0), n));
  const siteScore = scoreOf(siteChecks);
  const score = Math.round(pageScore * PAGE_WEIGHT + siteScore * (1 - PAGE_WEIGHT));

  const areas = AREAS.map(([name, ids]) => {
    let got = 0, max = 0;
    for (const p of ok) for (const c of p.checks) if (ids.includes(c.id) && c.level !== 'info') { got += share(c.level) * c.weight; max += c.weight; }
    return { name, score: max ? Math.round((got / max) * 100) : null };
  });

  /* risk: patterns search engines associate with low-quality or spammy sites */
  const signals = [];
  const risk = (points, label, detail) => { const p = Math.round(points); if (p > 0) signals.push({ points: p, label, detail }); };
  if (!https) risk(20, 'No HTTPS', 'Some pages are not encrypted.');
  const thin = ok.filter((p) => p.words < THIN_WORDS).length;
  if (ratio(thin, n) > 0.3) risk(20 * ratio(thin, n), 'Mostly thin pages', `${thin} of ${n} pages have under ${THIN_WORDS} words.`);
  if (ratio(dupCount, n) > 0.2) risk(15 * ratio(dupCount, n), 'Many duplicate titles', `${dupCount} of ${n} pages share a title.`);
  const stuffed = ok.filter((p) => p.terms.total >= 150 && p.terms.topShare > 0.08);
  if (stuffed.length) risk(Math.min(20, 5 + 30 * ratio(stuffed.length, n)), 'Keyword stuffing', `${stuffed.length} page(s) repeat one word in over 8% of the text, e.g. “${stuffed[0].terms.topWord}”.`);
  const linky = ok.filter((p) => p.external.length > 100 || (p.external.length > 30 && p.external.length > p.internal.length * 2));
  if (linky.length) risk(Math.min(15, 5 + 20 * ratio(linky.length, n)), 'Pages full of outgoing links', `${linky.length} page(s) link out far more than usual.`);
  const hidden = ok.filter((p) => p.hiddenLinks >= 5);
  if (hidden.length) risk(Math.min(15, 5 + 20 * ratio(hidden.length, n)), 'Hidden links', `${hidden.length} page(s) hide 5 or more links with inline styles. Check that this is intended.`);
  if (!ok.some((p) => p.trust)) risk(10, 'No contact, about or privacy page', 'Trustworthy sites link to who they are.');
  const riskScore = Math.min(100, signals.reduce((s, x) => s + x.points, 0));

  /* things that make this report less complete */
  const notes = [];
  if (crawl.stopped) notes.push(`The scan was stopped early: results cover ${crawl.pages.length} pages.`);
  else if (crawl.pages.length >= crawl.limit) notes.push(`The ${crawl.limit}-page limit was reached. Raise the limit to scan more of the site.`);
  if (crawl.blocked.length) notes.push(`${crawl.blocked.length} address(es) were skipped because robots.txt disallows them.`);
  const empty = ok.filter((p) => p.words < 50 && p.scripts >= 3).length;
  if (ratio(empty, n) > 0.4) notes.push('Many pages have almost no text in their HTML. The site probably builds its content with JavaScript, which this scan does not run, so content scores may be too low.');

  return {
    domain: crawl.domain, at: crawl.at, limit: crawl.limit, complete, stopped: crawl.stopped,
    score, pageScore, siteScore, grade: gradeOf(score), areas, siteChecks,
    riskScore, signals,
    counts: { pages: ok.length, broken: brokenPages.length, discovered: crawl.discovered, internalLinks: graph.reduce((s, l) => s + l.length, 0), domains: domains.length, issues: issues.reduce((s, i) => s + i.urls.length, 0), avgMs },
    pages: pages.sort((a, b) => b.linkScore - a.linkScore || b.inlinks - a.inlinks || a.url.length - b.url.length),
    broken: brokenPages, domains, issues, keywords: siteKeywords(ok.filter((p) => bareHost(new URL(p.url).hostname) === crawl.domain)), notes,
  };
}

/* ------------------------------ changes between scans ------------------------------ */

/** What is remembered of a scan, to compare the next one with. */
export const snapshot = (r) => ({
  at: r.at, limit: r.limit, stopped: r.stopped, score: r.score,
  pages: r.pages.map((p) => p.url).sort(),
  domains: r.domains.map((d) => d.domain).sort(),
});

const minus = (a, b) => { const s = new Set(b); return a.filter((x) => !s.has(x)); };

/**
 * Discovered and lost pages / linked domains between consecutive scans. Only full scans with the same page limit are
 * compared: otherwise a "lost" page might simply not have been visited.
 */
export function changes(history) {
  const out = [];
  const last = new Map(); // limit → previous scan
  for (const s of history) {
    if (s.stopped) continue;
    const prev = last.get(s.limit);
    if (prev) {
      const c = { at: s.at, since: prev.at, score: s.score - prev.score, newPages: minus(s.pages, prev.pages), lostPages: minus(prev.pages, s.pages), newDomains: minus(s.domains, prev.domains), lostDomains: minus(prev.domains, s.domains) };
      c.gained = c.newPages.length + c.newDomains.length;
      c.lost = c.lostPages.length + c.lostDomains.length;
      out.push(c);
    }
    last.set(s.limit, s);
  }
  return out;
}

/* ------------------------------ export ------------------------------ */

const md = (t) => String(t).replace(/\|/g, '\\|').replace(/\s+/g, ' ');
const day = (ms) => new Date(ms).toISOString().slice(0, 10);

/** `authority` = the Domain Authority answer, when there is one. */
export function reportMarkdown(r, authority) {
  const table = (head, rows) => [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((row) => `| ${row.map(md).join(' | ')} |`)];
  const out = [
    `# Site report: ${r.domain}`, '', `Scanned ${day(r.at)} by LinkLens (${r.counts.pages} pages).`, '',
    ...(authority ? [`- DA (LinkLens): ${authority.score}`] : []), `- Pages analysed: ${r.counts.pages}`, `- Broken pages: ${r.counts.broken}`, `- Content keywords: ${r.keywords.found}`, `- Spam score: ${r.riskScore}%`,
  ];
  if (r.notes.length) out.push('', ...r.notes.map((x) => `> ${x}`));
  if (r.issues.length) out.push('', '## What to fix', '', ...r.issues.map((i) => `- **${i.title}** (${i.urls.length}): ${i.fix}`));
  if (r.signals.length) out.push('', '## Spam signals', '', ...r.signals.map((s) => `- ${s.label} (+${s.points}%): ${s.detail}`));
  if (r.pages.length) out.push('', '## Top pages by internal links', '', ...table(['Page', 'PA', 'Links in', 'Page score'], r.pages.slice(0, TOP_ROWS).map((p) => [p.url, p.linkScore, p.inlinks, p.score])));
  if (r.domains.length) out.push('', '## Most linked external domains', '', ...table(['Domain', 'Pages', 'Links'], r.domains.slice(0, TOP_ROWS).map((d) => [d.domain, d.pages, d.links])));
  if (r.keywords.top.length) out.push('', '## Content keywords', '', ...table(['Keyword', 'Pages', 'Uses'], r.keywords.top.slice(0, 20).map((k) => [k.term, k.pages, k.count])));
  return out.join('\n');
}

const csvCell = (v) => { const s = String(v == null ? '' : v); return `"${(/^[=+\-@\t\r]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`; }; // the quote stops spreadsheet formulas
export function pagesCsv(r) {
  const rows = [['url', 'status', 'page score', 'PA', 'links in', 'words', 'response ms', 'noindex', 'title']];
  for (const p of r.pages) rows.push([p.url, p.status, p.score, p.linkScore, p.inlinks, p.words, p.ms, p.noindex ? 'yes' : 'no', p.title]);
  for (const b of r.broken) rows.push([b.url, b.status || b.error, '', '', '', '', '', '', '']);
  return rows.map((row) => row.map(csvCell).join(',')).join('\n');
}
