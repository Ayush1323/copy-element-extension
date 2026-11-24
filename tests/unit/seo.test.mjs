import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const S = await import('../../src/content/core/seo.js');

const URL0 = 'https://www.example.com/blog/post?x=1';
const HTML = `<!doctype html><html lang="en"><head>
<title>A fairly good page title for a blog post here</title>
<meta name="description" content="A description that is long enough to be useful to a reader browsing search results, but not too long.">
<meta name="robots" content="noindex, nofollow, max-snippet:-1">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="canonical" href="/blog/post">
<link rel="alternate" hreflang="de" href="https://www.example.com/de/blog/post">
<link rel="icon" href="/favicon.ico">
<meta property="og:title" content="OG Title"><meta property="og:image" content="/img/og.png"><meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Article","headline":"Hello","author":"Me"},{"@type":"Organization","name":"Acme","url":"https://acme.test"}]}</script>
<script type="application/ld+json">{ broken json </script>
</head><body>
<h2>Intro first</h2><h1>Main</h1><h4>Skipped</h4><h1></h1><h3 style="display:none">Hidden</h3>
<a href="/about">About us</a><a href="https://other.com/x" rel="nofollow sponsored" target="_blank">Other</a><a href="#top">top</a><a href="javascript:void(0)">js</a>
<a href="mailto:a@b.co">mail</a><a href="/empty"></a><a href="/more">read more</a><a href="http://insecure.test/">plain http</a><a href="/about">About us</a><a href="#">hash</a>
<a href="/pic"><img src="/linked.png" alt=""></a>
<img src="/a.jpg" alt="A cat sitting" width="100" height="50"><img src="/b.png"><img src="/c.webp" alt="photo.jpg" width="10" height="10"><img src="/pixel.gif" width="1" height="1">
<div itemscope itemtype="https://schema.org/Product"></div><div typeof="Person"></div>
</body></html>`;

const dom = new JSDOM(HTML, { url: URL0 });
const doc = dom.window.document, win = dom.window;

test('meta: title, description, canonical, robots, language and friends', () => {
  const m = S.readMeta(doc, URL0);
  assert.equal(m.title, 'A fairly good page title for a blog post here');
  assert.equal(m.titleLen, 45); assert.equal(m.titleStatus, 'good');
  assert.equal(m.descriptionStatus, 'good');
  assert.equal(m.canonical, 'https://www.example.com/blog/post');
  assert.equal(m.canonicalSelf, false, 'canonical without the query differs');
  assert.equal(m.robots.noindex, true); assert.equal(m.robots.nofollow, true);
  assert.ok(m.robots.tokens.includes('max-snippet:-1'));
  assert.equal(m.lang, 'en'); assert.equal(m.https, true);
  assert.equal(m.viewport, 'width=device-width, initial-scale=1');
  assert.deepEqual(m.hreflang, [{ lang: 'de', href: 'https://www.example.com/de/blog/post' }]);
  assert.equal(m.favicon, 'https://www.example.com/favicon.ico');
});

test('title / description length judgement', () => {
  assert.equal(S.titleStatus(0), 'bad'); assert.equal(S.titleStatus(20), 'warn'); assert.equal(S.titleStatus(45), 'good'); assert.equal(S.titleStatus(80), 'warn');
  assert.equal(S.descriptionStatus(0), 'bad'); assert.equal(S.descriptionStatus(50), 'warn'); assert.equal(S.descriptionStatus(120), 'good'); assert.equal(S.descriptionStatus(200), 'warn');
});

test('robots meta understands "none" and several tags', () => {
  assert.deepEqual([S.parseRobotsMeta(['none']).noindex, S.parseRobotsMeta(['none']).nofollow], [true, true]);
  const r = S.parseRobotsMeta(['index, follow', 'googlebot: noindex'.replace('googlebot: ', '')]);
  assert.equal(r.noindex, true); assert.equal(S.parseRobotsMeta([]).noindex, false);
});

test('headings: counts, skipped levels, empty and multiple H1', () => {
  const h = S.readHeadings(doc, win);
  assert.deepEqual(h.counts, { 1: 2, 2: 1, 3: 1, 4: 1, 5: 0, 6: 0 });
  assert.equal(h.items.find((i) => i.text === 'Skipped').skipped, true);
  assert.equal(h.items.find((i) => i.text === 'Hidden').hidden, true);
  const texts = h.issues.map((i) => i.text).join(' | ');
  assert.match(texts, /2 H1 headings/); assert.match(texts, /first heading is an H2/); assert.match(texts, /skip a level/); assert.match(texts, /empty heading/);
  assert.match(S.headingsMarkdown(h), /^## Intro first\n# Main\n#### Skipped/);
  const none = S.readHeadings(new JSDOM('<p>x</p>').window.document, win);
  assert.equal(none.issues[0].text, 'No H1 heading on the page.');
});

test('links: type, rel, anchor text problems, duplicates', () => {
  const l = S.readLinks(doc, URL0);
  const by = (h) => l.items.find((i) => i.href === h);
  assert.equal(by('/about').type, 'internal');
  assert.equal(by('https://other.com/x').type, 'external');
  assert.equal(by('https://other.com/x').nofollow, true); assert.equal(by('https://other.com/x').sponsored, true); assert.equal(by('https://other.com/x').newTab, true);
  assert.equal(by('#top').type, 'anchor'); assert.equal(by('javascript:void(0)').type, 'js'); assert.equal(by('mailto:a@b.co').type, 'mail');
  assert.deepEqual(by('/empty').issues, ['No anchor text']);
  assert.deepEqual(by('/more').issues, ['Generic anchor text']);
  assert.ok(by('http://insecure.test/').issues.includes('Insecure http:// link'));
  assert.ok(by('#').issues.includes('Empty link target'));
  assert.equal(l.counts.unique, l.counts.total - 1, 'one duplicate target');
  assert.equal(l.counts.nofollow, 1);
  assert.match(S.linksCsv(l).split('\n')[0], /^url,type,anchor text/);
});

test('images: alt state, tiny tracking pixels, file-name alt, missing size attributes', () => {
  const im = S.readImages(doc, win);
  const by = (s) => im.items.find((i) => i.src.endsWith(s));
  assert.equal(by('/a.jpg').altState, 'ok'); assert.deepEqual(by('/a.jpg').issues, []);
  assert.equal(by('/b.png').altState, 'missing'); assert.ok(by('/b.png').issues.includes('Missing alt attribute'));
  assert.ok(by('/c.webp').issues.includes('Alt text looks like a file name'));
  assert.ok(by('/linked.png').issues.includes('Empty alt on a linked image'));
  assert.equal(by('/pixel.gif').tiny, true); assert.deepEqual(by('/pixel.gif').issues, []);
  assert.equal(im.counts.missingAlt, 1);
  assert.equal(S.imageFormat('https://x.test/a/b.JPEG?x=1'), 'jpg'); assert.equal(S.imageFormat('data:image/svg+xml;base64,AAA'), 'svg');
});

test('schema: JSON-LD graph, missing required properties, broken JSON, microdata and RDFa', () => {
  const s = S.readSchema(doc);
  assert.equal(s.blocks.length, 2);
  assert.deepEqual(s.blocks[0].types.sort(), ['Article', 'Organization']);
  assert.deepEqual(s.blocks[0].entities.find((e) => e.types[0] === 'Article').missing, ['datePublished', 'image']);
  assert.deepEqual(s.blocks[0].entities.find((e) => e.types[0] === 'Organization').missing, []);
  assert.ok(s.blocks[1].error, 'invalid JSON is reported');
  assert.equal(s.errors, 1); assert.deepEqual(s.microdata, ['Product']); assert.deepEqual(s.rdfa, ['Person']);
});

test('social: Open Graph and Twitter tags with absolute image URLs and issues', () => {
  const so = S.readSocial(doc, URL0);
  assert.equal(so.og.title, 'OG Title'); assert.equal(so.og.image, 'https://www.example.com/img/og.png');
  assert.equal(so.twitter.card, 'summary_large_image');
  const missing = so.issues.map((i) => i.text);
  assert.ok(missing.includes('og:description is missing') && missing.includes('og:url is missing'));
  assert.ok(!missing.includes('twitter:card is missing'));
});

test('resources: grouped by type, third-party and render-blocking detected', () => {
  const r = S.readResources([
    { name: 'https://www.example.com/app.js', initiatorType: 'script', transferSize: 50000, encodedBodySize: 50000, decodedBodySize: 120000, duration: 80.4, renderBlockingStatus: 'blocking' },
    { name: 'https://cdn.other.com/lib.js', initiatorType: 'script', transferSize: 30000, duration: 120 },
    { name: 'https://www.example.com/s.css', initiatorType: 'link', transferSize: 8000, duration: 30 },
    { name: 'https://www.example.com/f.woff2', initiatorType: 'css', transferSize: 20000, duration: 40 },
    { name: 'https://www.example.com/p.png', initiatorType: 'img', transferSize: 0, decodedBodySize: 90000, duration: 5 },
    { name: 'data:image/png;base64,xx', initiatorType: 'img', transferSize: 0, duration: 0 },
  ], 'www.example.com');
  assert.equal(r.requests, 5);
  assert.equal(r.byType.script.count, 2); assert.equal(r.byType.style.count, 1); assert.equal(r.byType.font.count, 1); assert.equal(r.byType.image.count, 1);
  assert.equal(r.total, 108000); assert.equal(r.thirdParty, 1); assert.deepEqual(r.hosts, ['cdn.other.com']); assert.equal(r.blocking, 1);
  assert.equal(r.items.find((i) => i.url.endsWith('p.png')).cached, true);
});

test('web vitals: ratings follow the usual thresholds; CLS uses the worst session window', () => {
  assert.equal(S.rateVital('LCP', 2000), 'good'); assert.equal(S.rateVital('LCP', 3000), 'warn'); assert.equal(S.rateVital('LCP', 5000), 'bad');
  assert.equal(S.rateVital('CLS', 0.05), 'good'); assert.equal(S.rateVital('CLS', 0.3), 'bad'); assert.equal(S.rateVital('INP', null), 'none');
  assert.equal(S.formatVital('LCP', 1234), '1.23 s'); assert.equal(S.formatVital('INP', 180), '180 ms'); assert.equal(S.formatVital('CLS', 0.1234), '0.123'); assert.equal(S.formatVital('FCP', null), '—');
  const cls = S.cumulativeShift([{ value: 0.05, startTime: 100 }, { value: 0.04, startTime: 500 }, { value: 0.3, startTime: 9000, hadRecentInput: true }, { value: 0.02, startTime: 20000 }]);
  assert.ok(Math.abs(cls - 0.09) < 1e-9, 'first two shifts form one window; input-driven ones are ignored: ' + cls);
});

test('navigation timing and status text', () => {
  const nav = S.readNavigation({ getEntriesByType: () => [{ responseStatus: 200, redirectCount: 1, startTime: 0, responseStart: 120.4, domContentLoadedEventEnd: 900, loadEventEnd: 1500, transferSize: 5000, nextHopProtocol: 'h2', type: 'navigate' }] });
  assert.deepEqual([nav.status, nav.redirects, nav.ttfb, nav.dom, nav.load, nav.protocol], [200, 1, 120, 900, 1500, 'h2']);
  assert.equal(S.readNavigation({ getEntriesByType: () => [] }), null);
  assert.equal(S.statusText(404), 'Not Found'); assert.equal(S.statusLevel(200), 'good'); assert.equal(S.statusLevel(301), 'warn'); assert.equal(S.statusLevel(500), 'bad');
});

test('response headers: SEO, security and X-Robots-Tag', () => {
  const h = S.pickHeaders({ 'content-type': 'text/html', 'x-robots-tag': 'noindex', 'strict-transport-security': 'max-age=1', server: 'nginx' });
  assert.ok(h.seo.some(([k]) => k === 'x-robots-tag')); assert.equal(h.xRobots.noindex, true);
  assert.deepEqual(h.security.find(([k]) => k === 'strict-transport-security'), ['strict-transport-security', true]);
  assert.deepEqual(h.security.find(([k]) => k === 'content-security-policy'), ['content-security-policy', false]);
});

const ROBOTS = `# comment
User-agent: *
Disallow: /private/
Allow: /private/public/
Disallow: /*.pdf$
Crawl-delay: 5

User-agent: Googlebot
User-agent: Bingbot
Disallow: /nogoogle

Sitemap: https://www.example.com/sitemap.xml
Sitemap: https://www.example.com/news.xml`;

test('robots.txt: groups, sitemaps and the longest-match rule', () => {
  const p = S.parseRobots(ROBOTS);
  assert.equal(p.groups.length, 2); assert.deepEqual(p.groups[1].agents, ['googlebot', 'bingbot']); assert.equal(p.sitemaps.length, 2); assert.equal(p.groups[0].delay, '5');
  assert.equal(S.robotsAllows(p, '/private/secret').allowed, false);
  assert.equal(S.robotsAllows(p, '/private/public/page').allowed, true, 'the longer Allow wins');
  assert.equal(S.robotsAllows(p, '/files/doc.pdf').allowed, false, 'wildcard and end anchor');
  assert.equal(S.robotsAllows(p, '/files/doc.pdf?x=1').allowed, true, '$ means the URL must end there');
  assert.equal(S.robotsAllows(p, '/blog').allowed, true);
  assert.equal(S.robotsAllows(p, '/nogoogle', 'Googlebot').allowed, false, 'a specific group replaces the * group');
  assert.equal(S.robotsAllows(p, '/private/x', 'Googlebot').allowed, true);
  assert.equal(S.robotsAllows(S.parseRobots('User-agent: *\nDisallow:'), '/x').allowed, true, 'an empty Disallow allows everything');
  assert.equal(S.robotsAllows(S.parseRobots(''), '/x').allowed, true);
});

test('sitemap: urlset, index and invalid XML', () => {
  const u = S.parseSitemap('<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://e.test/a</loc><lastmod>2026-01-02</lastmod><priority>0.8</priority></url><url><loc>https://e.test/b</loc></url></urlset>', JSDOM.fragment ? new JSDOM('').window.DOMParser : null);
  assert.equal(u.type, 'urlset'); assert.equal(u.urls.length, 2); assert.equal(u.urls[0].lastmod, '2026-01-02'); assert.equal(u.urls[0].priority, '0.8');
  const idx = S.parseSitemap('<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>https://e.test/s1.xml</loc></sitemap></sitemapindex>', new JSDOM('').window.DOMParser);
  assert.equal(idx.type, 'index'); assert.equal(idx.sitemaps[0].loc, 'https://e.test/s1.xml');
  assert.equal(S.parseSitemap('<not xml', new JSDOM('').window.DOMParser).type, 'invalid');
  assert.ok(S.sameUrl('https://e.test/a/', 'https://e.test/a#x'));
});

test('checks and score: every finding above shows up, and the score reacts', () => {
  const r = S.readPage(doc, win, URL0);
  const checks = S.buildChecks(r, { status: 200 });
  const by = (id) => checks.find((c) => c.id === id);
  assert.equal(by('title').level, 'good'); assert.equal(by('indexable').level, 'bad'); assert.equal(by('h1').level, 'warn');
  assert.equal(by('canonical').level, 'info'); assert.equal(by('status').level, 'good'); assert.equal(by('schema').level, 'bad');
  assert.equal(by('alt').level, 'warn'); assert.equal(by('anchors').level, 'warn'); assert.equal(by('og').level, 'warn');
  const score = S.scoreOf(checks);
  assert.ok(score > 0 && score < 100, 'score: ' + score);
  const clean = S.scoreOf([{ level: 'good', weight: 10 }, { level: 'info', weight: 99 }]);
  assert.equal(clean, 100, 'info checks are not counted');
  assert.equal(S.scoreOf([{ level: 'bad', weight: 10 }, { level: 'warn', weight: 10 }]), 25);
  assert.equal(S.gradeOf(95), 'Excellent'); assert.equal(S.gradeOf(80), 'Good'); assert.equal(S.gradeOf(60), 'Needs work'); assert.equal(S.gradeOf(10), 'Poor');
});
