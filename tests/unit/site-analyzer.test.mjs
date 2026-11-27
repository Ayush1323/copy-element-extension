import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const C = await import('../../src/shared/site-crawl.js');
const R = await import('../../src/shared/site-report.js');
const K = await import('../../src/shared/site-keywords.js');
const { niceStep } = await import('../../src/domain/chart.js');
const { DOMParser } = new JSDOM('').window;

const words = (n, w = 'alpha bravo charlie delta echo foxtrot golf hotel') => Array.from({ length: n }, (_, i) => w.split(' ')[i % w.split(' ').length]).join(' ');
const html = ({ title = 'A good page title of a sensible length', body = '', head = '' } = {}) => `<!doctype html><html lang="en"><head><title>${title}</title>
<meta name="viewport" content="width=device-width">${head}</head><body>${body}</body></html>`;

/** A fake website: { path: html | { status, type, body, to } } */
function site(pages, log = []) {
  return async (url) => {
    log.push(url);
    const u = new URL(url);
    if (u.hostname !== 'example.com') throw new TypeError('Failed to fetch');
    let hit = pages[u.pathname + u.search];
    let final = url;
    if (hit && hit.to) { final = new URL(hit.to, url).href; hit = pages[new URL(final).pathname]; }
    const o = hit === undefined ? { status: 404, body: '' } : typeof hit === 'string' ? { body: hit } : hit;
    const status = o.status || 200;
    const type = o.type || (u.pathname.endsWith('.txt') ? 'text/plain' : u.pathname.endsWith('.xml') ? 'application/xml' : 'text/html');
    return { ok: status < 300, status, url: final, redirected: final !== url, headers: new Headers({ 'content-type': type }), text: async () => o.body || '' };
  };
}
const SITE = {
  '/': html({ body: `<nav><a href="/about">About us</a></nav><h1>Widget workshop</h1><p>${words(250)}</p>
    <a href="/a?utm_source=x#top">Widgets</a> <a href="/old">Old</a> <a href="/missing">Gone</a> <a href="/logout">Log out</a> <a href="/file.pdf">PDF</a>
    <a href="/secret/x">Secret</a> <a href="https://other.org/p" rel="nofollow">Partner site</a> <a href="https://sub.example.com/">Sub</a>` }),
  '/a': html({ title: 'Same title used on two different pages', body: `<h1>A</h1><p>${words(250)}</p><a href="/">Home page</a> <a href="/b">Page B</a> <a href="https://other.org/q">Other</a>` }),
  '/b': html({ title: 'Same title used on two different pages', body: '<p>short</p><img src="x.png"><a href="/">Home page</a>' }),
  '/about': html({ title: 'About the widget workshop and its people', body: `<h1>About</h1><p>${words(220)}</p><a href="/">Home page</a>` }),
  '/old': { to: '/a' },
  '/lonely': html({ title: 'A lonely page nobody links to at all', body: `<h1>Lonely</h1><p>${words(220)}</p>` }),
  '/secret/x': html(),
  '/robots.txt': { body: 'User-agent: *\nDisallow: /secret\nSitemap: https://example.com/map.xml' },
  '/map.xml': { body: '<?xml version="1.0"?><urlset><url><loc>https://example.com/lonely</loc></url><url><loc>https://evil.test/x</loc></url></urlset>' },
};
const crawl = (pages = SITE, extra = {}, log) => C.crawlSite('example.com', { fetchImpl: site(pages, log), DOMParserImpl: DOMParser, sleep: async () => {}, ...extra });

test('domains are cleaned up, and things that are not public domains are refused', () => {
  for (const [input, want] of [['mindinventory.com', 'mindinventory.com'], ['  HTTPS://WWW.Example.co.uk/a/b?c=1#d ', 'example.co.uk'], ['blog.example.com:8080/x', 'blog.example.com'], ['bücher.de', 'xn--bcher-kva.de']]) assert.equal(C.normalizeDomain(input), want, input);
  for (const bad of ['', null, 'localhost', 'http://127.0.0.1/', 'two words.com', 'chrome://extensions', 'file:///tmp/a', 'javascript:alert(1)', 'a@b.com', 'example', '[::1]']) assert.equal(C.normalizeDomain(bad), '', String(bad));
  assert.deepEqual(C.originsFor('example.com'), ['*://*.example.com/*']);
});

test('addresses: one spelling per page, and files, other hosts and action links are never requested', () => {
  assert.equal(C.cleanUrl('/p?utm_medium=a&id=2&gclid=z#x', 'https://example.com/'), 'https://example.com/p?id=2');
  assert.equal(C.cleanUrl('mailto:a@b.com'), '');
  for (const u of ['https://example.com/x', 'https://www.example.com/blog/delete-old-habits-guide']) assert.ok(C.isCrawlable(u, 'example.com') === !/delete/.test(u), u);
  for (const u of ['https://other.com/', 'https://sub.example.com/', 'https://example.com/a.jpg', 'https://example.com/logout', 'https://example.com/?action=delete', 'https://example.com/cart?add-to-cart=3']) assert.ok(!C.isCrawlable(u, 'example.com'), u);
});

test('the crawl follows links and the sitemap, and respects robots.txt', async () => {
  const log = [];
  const r = await crawl(SITE, {}, log);
  assert.deepEqual(r.pages.map((p) => new URL(p.url).pathname).sort(), ['/', '/a', '/about', '/b', '/lonely', '/missing']);
  assert.deepEqual(r.blocked, ['https://example.com/secret/x']);
  assert.equal(r.aliases['https://example.com/old'], 'https://example.com/a');
  assert.ok(r.robots.found && r.sitemap.found && !r.stopped);
  assert.ok(!log.some((u) => /secret|logout|\.pdf|other\.org|sub\.example|evil\.test/.test(u)), log.join(' '));
});

test('the page limit holds, and stopping returns what was read', async () => {
  assert.equal((await crawl(SITE, { limit: 3 })).pages.length, 3);
  const ctl = new AbortController();
  const r = await crawl(SITE, { signal: ctl.signal, onProgress: (p) => { if (p.done === 1) ctl.abort(); } });
  assert.ok(r.stopped);
  assert.equal(r.pages.length, 1);
});

test('a site that cannot be read gives a clear error', async () => {
  await assert.rejects(C.crawlSite('nowhere.test', { fetchImpl: site(SITE), DOMParserImpl: DOMParser }), /Could not open/);
  await assert.rejects(crawl({ '/': { status: 403 } }), /HTTP 403/);
  await assert.rejects(crawl({ '/': { type: 'application/pdf', body: 'x' } }), /not a readable/);
});

test('the report: scores, links, broken and orphan pages, duplicates, outgoing domains', async () => {
  const r = R.buildReport(await crawl());
  assert.equal(r.counts.pages, 5);
  assert.equal(r.counts.broken, 1);
  assert.deepEqual(r.broken[0].from, ['https://example.com/']);
  for (const k of ['score', 'pageScore', 'siteScore', 'riskScore']) assert.ok(r[k] >= 0 && r[k] <= 100, k);
  assert.equal(r.score, Math.round(r.pageScore * 0.6 + r.siteScore * 0.4));
  assert.equal(r.pages[0].url, 'https://example.com/', 'the most linked page comes first');
  assert.equal(r.pages[0].linkScore, 100);
  assert.equal(r.pages.find((p) => p.url.endsWith('/a')).inlinks, 1, 'the link and the redirect from the same page count once');
  const issue = (id) => r.issues.find((i) => i.id === id);
  assert.equal(issue('dupTitle').urls.length, 2);
  assert.deepEqual(issue('orphan').urls.map((u) => u.url), ['https://example.com/lonely']);
  assert.ok(issue('broken') && issue('content') && issue('alt') && issue('h1'));
  assert.equal(r.issues[0].level, 'bad');
  assert.deepEqual(r.domains.map((d) => [d.domain, d.pages, d.links, d.nofollow]), [['other.org', 2, 2, 1], ['sub.example.com', 1, 1, 0]]);
  assert.ok(r.keywords.found > 0);
  assert.ok(JSON.stringify(r).length < 60000, 'compact enough to store');
});

test('orphans are not claimed when the page limit cut the scan short', async () => {
  const r = R.buildReport(await crawl(SITE, { limit: 3 }));
  assert.ok(!r.issues.some((i) => i.id === 'orphan'));
  assert.ok(r.notes.some((n) => /3-page limit/.test(n)));
});

test('risk signals appear for spam-like pages and stay away from a normal site', async () => {
  const spam = await crawl({ '/': html({ body: `<p>${words(300, 'casino casino win now bonus')}</p><div style="display: none">${'<a href="https://x.test/">x</a>'.repeat(8)}</div>` }) });
  const bad = R.buildReport(spam);
  const labels = bad.signals.map((s) => s.label).join();
  assert.match(labels, /Keyword stuffing/); assert.match(labels, /Hidden links/); assert.match(labels, /No contact/);
  assert.ok(bad.riskScore >= 30);
  const good = R.buildReport(await crawl({ '/': html({ body: `<h1>Hi</h1><p>${Array.from({ length: 260 }, (_, i) => `term${i}`).join(' ')}</p><a href="/about">About</a>` }), '/about': html({ title: 'About the people behind this website', body: `<h1>About</h1><p>${Array.from({ length: 220 }, (_, i) => `word${i}`).join(' ')}</p>` }) }));
  assert.equal(good.riskScore, 0, JSON.stringify(good.signals));
});

test('PageRank adds up to one and favours linked pages', () => {
  const r = R.pageRank([[1], [0], [0], []]);
  assert.ok(Math.abs(r.reduce((a, b) => a + b, 0) - 1) < 1e-9);
  assert.ok(r[0] > r[1] && r[1] > r[2]);
  assert.deepEqual(R.pageRank([]), []);
});

test('keywords: phrases are found, filler words are not', () => {
  const t = K.pageTerms({ title: 'Mobile app development', headings: [{ level: 1, text: 'Mobile app development company' }], body: 'We do mobile app development. Our mobile app development is for you and the team.' });
  const k = K.siteKeywords([{ terms: t }]);
  assert.equal(k.top[0].term, 'mobile app development');
  assert.equal(k.top[0].score, 100);
  assert.ok(!k.top.some((x) => ['the', 'and', 'our', 'you'].includes(x.term)));
});

test('changes compare full scans with the same limit only', () => {
  const s = (at, pages, domains, extra = {}) => ({ at, limit: 50, stopped: false, score: 50 + at, pages, domains, ...extra });
  const c = R.changes([s(1, ['a', 'b'], ['x']), s(2, ['a'], ['x'], { stopped: true }), s(3, ['z'], [], { limit: 25 }), s(4, ['a', 'c'], ['y'])]);
  assert.equal(c.length, 1);
  assert.deepEqual([c[0].since, c[0].newPages, c[0].lostPages, c[0].newDomains, c[0].lostDomains, c[0].gained, c[0].lost, c[0].score], [1, ['c'], ['b'], ['y'], ['x'], 2, 2, 3]);
});

test('exports: Markdown report, and CSV that spreadsheets cannot run as a formula', async () => {
  const r = R.buildReport(await crawl({ '/': html({ title: '=HYPERLINK("x")' }) }));
  assert.match(R.reportMarkdown(r), /# Site report: example\.com/);
  assert.match(R.pagesCsv(r), /"'=HYPERLINK\(""x""\)"/);
  assert.equal(niceStep(29), 5); assert.equal(niceStep(2), 1);
});
