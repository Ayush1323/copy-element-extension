import { test } from 'node:test';
import assert from 'node:assert/strict';

const A = await import('../../src/shared/authority.js');
const NOW = Date.parse('2026-11-28T12:00:00Z');

test('domain input is normalised to the registrable domain (eTLD+1), like Moz DA', () => {
  const p = (s) => A.parseDomainInput(s);
  assert.equal(p('https://www.GitHub.com/features?x=1').domain, 'github.com');
  assert.equal(p('blog.example.co.uk').domain, 'example.co.uk');
  assert.equal(p('blog.example.co.uk').isSub, true);
  assert.equal(p('www.example.com').isSub, false);
  assert.equal(p('shop.example.com.au:8080/path').domain, 'example.com.au');
  assert.equal(p('docs.python.org').domain, 'python.org');
  assert.equal(p('münchen.de').domain, 'xn--mnchen-3ya.de');
  // shared hosting: the customer site is its own domain
  const gh = p('octocat.github.io');
  assert.equal(gh.domain, 'octocat.github.io');
  assert.equal(gh.shared, true);
  assert.equal(gh.platform, 'github.io');
  assert.equal(p('github.io').domain, 'github.io');
  for (const bad of ['', '   ', 'localhost', '192.168.1.1', 'foo', 'my.test', 'a..b.com', 'http://-bad-.com']) assert.equal(p(bad).ok, false, bad);
});

test('the rank curve is monotonic and hits its calibration anchors', () => {
  assert.equal(Math.round(A.rankScore(1)), 100);
  assert.equal(Math.round(A.rankScore(1000)), 92);
  assert.equal(Math.round(A.rankScore(1e6)), 40);
  let prev = 101;
  for (const r of [1, 2, 5, 10, 50, 100, 500, 1e3, 5e3, 1e4, 5e4, 1e5, 3e5, 5e5, 1e6]) { const s = A.rankScore(r); assert.ok(s < prev, `rank ${r}`); prev = s; }
  assert.equal(A.oprScore(0), 0);
  assert.equal(A.oprScore(10), 100);
  assert.ok(A.oprScore(5.5) > A.oprScore(5) && A.oprScore(5.5) < A.oprScore(6));
  assert.equal(A.ageScore(0), 0);
  assert.equal(Math.round(A.ageScore(20)), 100);
  assert.equal(A.ageScore(40), 100);
  assert.ok(A.ageScore(1) < A.ageScore(5) && A.ageScore(5) < A.ageScore(10));
});

test('Tranco ranks: median, best/worst, trend over the last 30 lists', () => {
  const ranks = Array.from({ length: 30 }, (_, i) => ({ date: `2026-11-${String(i + 1).padStart(2, '0')}`, rank: 100 - i }));
  const t = A.parseTranco({ ranks });
  assert.equal(t.ranked, true);
  assert.equal(t.latest, 71);
  assert.equal(t.best, 71);
  assert.equal(t.worst, 100);
  assert.equal(t.days, 30);
  assert.ok(t.trend > 0, 'climbing');
  assert.equal(t.history[0].rank, 100); // oldest first for the chart
  assert.deepEqual(A.parseTranco({ ranks: [] }), { ranked: false, days: 0, history: [] });
});

test('RDAP: dates, registrar, locks, DNSSEC and holds', () => {
  const r = A.parseRdap({
    objectClassName: 'domain', ldhName: 'EXAMPLE.COM',
    events: [{ eventAction: 'registration', eventDate: '2007-10-09T18:20:50Z' }, { eventAction: 'expiration', eventDate: '2028-10-09T18:20:50Z' }, { eventAction: 'last changed', eventDate: '2024-09-07T09:50:21Z' }],
    status: ['client transfer prohibited', 'server delete prohibited'],
    entities: [{ roles: ['registrar'], vcardArray: ['vcard', [['version', {}, 'text', '4.0'], ['fn', {}, 'text', 'MarkMonitor Inc.']]], publicIds: [{ type: 'IANA Registrar ID', identifier: '292' }] }],
    nameservers: [{ ldhName: 'NS1.EXAMPLE.COM' }, { ldhName: 'NS2.EXAMPLE.COM' }],
    secureDNS: { delegationSigned: true },
  });
  assert.equal(r.found, true);
  assert.equal(r.registrar, 'MarkMonitor Inc.');
  assert.equal(r.registrarIana, '292');
  assert.equal(r.clientLock, true);
  assert.equal(r.serverLock, true);
  assert.equal(r.hold, false);
  assert.equal(r.dnssec, true);
  assert.equal(r.registered.slice(0, 10), '2007-10-09');
  assert.deepEqual(r.nameservers, ['ns1.example.com', 'ns2.example.com']);
  assert.equal(A.parseRdap({ errorCode: 404 }).found, false);
  assert.equal(A.parseRdap({ objectClassName: 'domain', status: ['client hold'] }).hold, true);
});

test('Wayback sparkline: complete months only, opt-outs are recognised', () => {
  const years = { 2025: [5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5], 2026: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 0, 99] };
  const s = A.parseSparkline({ years, first_ts: '20100517130106', last_ts: '20261128000000' }, new Date(NOW));
  assert.equal(s.found, true);
  // last 12 complete months before Nov 2026: Nov 2025 … Oct 2026 = 2×5 + 10×10
  assert.equal(s.last12, 110);
  assert.equal(s.activeMonths24, 22); // Nov and Dec 2024 are not in the data
  assert.equal(s.series.length, 24);
  assert.equal(s.firstSeen.slice(0, 10), '2010-05-17');
  assert.deepEqual(A.parseSparkline({ years: {}, error: { type: 'blocked' } }), { found: false, blocked: true });
  assert.equal(A.parseWaybackFirst({ archived_snapshots: { closest: { available: true, timestamp: '20080514210148' } } }).firstSeen.slice(0, 10), '2008-05-14');
});

test('DNS: MX, SPF strictness, DMARC policy, CAA, DNSSEC, NXDOMAIN', () => {
  const d = A.parseDns({
    A: { Status: 0, AD: true, Answer: [{ type: 1, data: '1.2.3.4' }] },
    MX: { Answer: [{ type: 15, data: '10 mx.example.com.' }] },
    TXT: { Answer: [{ type: 16, data: '"v=spf1 include:_spf.google.com -all"' }, { type: 16, data: '"google-site-verification=x"' }] },
    DMARC: { Answer: [{ type: 16, data: '"v=DMARC1; p=reject; rua=mailto:x@example.com"' }] },
    CAA: { Answer: [{ type: 257, data: '0 issue "letsencrypt.org"' }] },
    NS: { Answer: [{ type: 2, data: 'a.ns.' }, { type: 2, data: 'b.ns.' }] },
  });
  assert.equal(d.resolves, true);
  assert.deepEqual(d.mx, ['mx.example.com']);
  assert.equal(d.spfStrict, true);
  assert.equal(d.dmarcPolicy, 'reject');
  assert.equal(d.caa.length, 1);
  assert.equal(d.dnssec, true);
  assert.equal(A.parseDns({ A: { Status: 3 } }).nxdomain, true);
});

const dnsGood = { resolves: true, nxdomain: false, a: ['1.1.1.1'], aaaa: [], mx: ['mx.x'], spf: 'v=spf1 -all', spfStrict: true, dmarc: 'v=DMARC1; p=reject', dmarcPolicy: 'reject', caa: ['x'], ns: ['a', 'b'], dnssec: false };
const rdapOld = { found: true, registered: '2000-01-01T00:00:00Z', expires: '2030-01-01T00:00:00Z', clientLock: true, serverLock: true, hold: false, status: [], nameservers: [], dnssec: true, registrar: 'X' };
const archiveBig = { found: true, total: 100000, perMonth: 3000, last12: 36000, activeMonths24: 24, firstSeen: '2001-01-01T00:00:00Z', lastSeen: '2026-11-01T00:00:00Z', series: [] };
const trancoAt = (rank) => ({ ranked: true, latest: rank, median: rank, best: rank, worst: rank, days: 30, trend: 0, history: [] });

test('a top site scores in the 90s with high confidence; the parts and weights add up', () => {
  const r = A.scoreAuthority({ tranco: trancoAt(30), rdap: rdapOld, archive: archiveBig, dns: dnsGood }, { now: NOW });
  assert.ok(r.score >= 94 && r.score <= 100, String(r.score));
  assert.equal(r.confidence, 'High');
  assert.equal(r.tier.name, 'Exceptional');
  assert.equal(r.parts.reduce((a, p) => a + p.weight, 0), 100);
  assert.ok(r.low <= r.score && r.high >= r.score);
});

test('scores fall with rank, and backlink data (Open PageRank) moves the score', () => {
  const at = (rank) => A.scoreAuthority({ tranco: trancoAt(rank), rdap: rdapOld, archive: archiveBig, dns: dnsGood }, { now: NOW }).score;
  assert.ok(at(100) > at(10000) && at(10000) > at(500000));
  const base = { tranco: trancoAt(200000), rdap: rdapOld, archive: archiveBig, dns: dnsGood };
  const plain = A.scoreAuthority(base, { now: NOW }).score;
  const linky = A.scoreAuthority({ ...base, opr: { found: true, pr: 7.5 } }, { now: NOW }).score;
  const weak = A.scoreAuthority({ ...base, opr: { found: true, pr: 2 } }, { now: NOW }).score;
  assert.ok(linky > plain && plain > weak, `${weak} < ${plain} < ${linky}`);
});

test('unranked, new and broken domains stay low and are flagged', () => {
  const fresh = A.scoreAuthority({
    tranco: { ranked: false, days: 0, history: [] },
    rdap: { ...rdapOld, registered: '2026-09-01T00:00:00Z', serverLock: false, clientLock: false },
    archive: { found: false },
    dns: { ...dnsGood, mx: [], spf: '', spfStrict: false, dmarc: '', dmarcPolicy: '', caa: [] },
  }, { now: NOW });
  assert.ok(fresh.score <= 12, String(fresh.score));
  assert.ok(fresh.risks.some((x) => x.title === 'Brand-new domain' && x.level === 'bad'));
  assert.ok(fresh.risks.some((x) => x.title === 'Never archived'));

  const gone = A.scoreAuthority({ tranco: { ranked: false, days: 0, history: [] }, rdap: { found: false, unsupported: true }, archive: { found: false }, dns: { ...dnsGood, resolves: false, nxdomain: true } }, { now: NOW });
  assert.ok(gone.score <= 5);
  assert.equal(gone.risks[0].title, 'Domain does not exist');

  // an established site outside the top 1M can reach the 30s-40s, not more, without link data
  const niche = A.scoreAuthority({ tranco: { ranked: false, days: 0, history: [] }, rdap: rdapOld, archive: { ...archiveBig, perMonth: 30 }, dns: dnsGood }, { now: NOW });
  assert.ok(niche.score >= 25 && niche.score <= 50, String(niche.score));
});

test('missing sources are left out (not counted as zero) and lower the confidence', () => {
  const full = A.scoreAuthority({ tranco: trancoAt(5000), rdap: rdapOld, archive: archiveBig, dns: dnsGood }, { now: NOW });
  const partial = A.scoreAuthority({ tranco: trancoAt(5000), rdap: { error: 'x' }, archive: { error: 'x' }, dns: { error: 'x' } }, { now: NOW });
  assert.ok(Math.abs(full.score - partial.score) <= 8, `${full.score} vs ${partial.score}`);
  assert.ok(partial.confidenceValue < full.confidenceValue);
  assert.ok(partial.margin > full.margin);
  assert.equal(partial.parts.find((p) => p.id === 'core').weight, 100);
  // an archive opt-out is not a warning sign
  const blocked = A.scoreAuthority({ tranco: trancoAt(5000), rdap: rdapOld, archive: { found: false, blocked: true }, dns: dnsGood }, { now: NOW });
  assert.ok(!blocked.risks.some((x) => x.title === 'Never archived'));
  assert.ok(blocked.risks.some((x) => x.title === 'Excluded from the Web Archive'));
});

test('the copied report carries the score, the breakdown and the sources', () => {
  const src = { tranco: trancoAt(1234), rdap: rdapOld, archive: archiveBig, dns: dnsGood };
  const r = A.scoreAuthority(src, { now: NOW });
  const t = A.reportText('example.com', r, src);
  assert.match(t, /^# Domain Authority — example\.com/);
  assert.match(t, new RegExp(`Score: ${r.score}/100`));
  assert.match(t, /Tranco rank: #1,234/);
  assert.match(t, /DMARC reject/);
});

test('top pages: ranked by distinct days; assets, noise and menu pages dropped; other domains ignored', () => {
  const lines = [
    '20250101000000 https://www.example.com/', '20250102000000 http://example.com/', '20250103000000 https://www.example.com/index.html', '20250104000000 https://www.example.com/?utm=1',
    // a burst of captures on one day counts once
    '20250105000000 https://www.example.com/blog/burst', '20250105010000 https://www.example.com/blog/burst', '20250105020000 https://www.example.com/blog/burst',
    '20250106000000 https://www.example.com/blog/post-a', '20250107000000 https://www.example.com/blog/post-a/',
    '20250108000000 https://blog.example.com/x', '20250109000000 https://www.example.com/style.css', '20250110000000 https://www.example.com/wp-json/v2/posts',
    '20250111000000 https://evil.com/blog/post-a', '20250112000000 https://www.example.com/feed/',
    '20250113000000 https://www.example.com/contact-us', '20250114000000 https://www.example.com/contact-us', '20250115000000 https://www.example.com/blog/videos',
  ].join('\n');
  const r = A.parseTopPages(lines, 'example.com');
  assert.equal(r.found, true);
  assert.equal(r.pages[0].path, '/');
  assert.equal(r.pages[0].days, 4);
  assert.equal(r.pages[0].url, 'https://www.example.com/', 'shown on the host the site really uses');
  assert.equal(r.pages[1].path, '/blog/post-a');
  assert.equal(r.pages[1].days, 2);
  const burst = r.pages.find((x) => x.path === '/blog/burst');
  assert.equal(burst.days, 1);
  assert.equal(burst.captures, 3);
  assert.ok(r.pages.some((x) => x.host === 'blog.example.com'));
  assert.ok(!r.pages.some((x) => /css|wp-json|feed|contact|videos/.test(x.path)));
  assert.equal(r.utility, 3);
  assert.equal(A.parseTopPages('', 'example.com').found, false);
});

test('spam score: a healthy established domain is ~1 %, a fresh throwaway domain is high', () => {
  const good = A.scoreAuthority({ tranco: trancoAt(5000), rdap: rdapOld, archive: archiveBig, dns: dnsGood }, { now: NOW, domain: 'example.com' });
  assert.equal(good.spam.percent, 1);
  assert.equal(good.spam.level, 'low');
  assert.equal(good.spam.hits, 0);
  const bad = A.scoreAuthority({
    tranco: { ranked: false, days: 0, history: [] },
    rdap: { ...rdapOld, registered: '2026-10-01T00:00:00Z', expires: '2027-10-01T00:00:00Z', clientLock: false, serverLock: false },
    archive: { found: false },
    dns: { ...dnsGood, mx: [], spf: '', dmarc: '', dmarcPolicy: '' },
  }, { now: NOW, domain: 'best-cheap-pills-4u2day.xyz' });
  assert.ok(bad.spam.percent >= 61, String(bad.spam.percent));
  assert.equal(bad.spam.level, 'high');
  // a source that failed is not counted as a warning
  const unknown = A.scoreAuthority({ tranco: trancoAt(5000), rdap: rdapOld, archive: { error: 'x' }, dns: dnsGood }, { now: NOW, domain: 'example.com' });
  assert.ok(!unknown.spam.flags.find((x) => x.id === 'archived').hit);
});

test('yearly archive history is listed oldest first', () => {
  const s = A.parseSparkline({ years: { 2024: [1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 2023: [5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] }, first_ts: '20230101000000' }, new Date(NOW));
  assert.deepEqual(s.yearly, [{ year: 2023, count: 5 }, { year: 2024, count: 2 }]);
});

test('link and keyword estimates reproduce the measured Moz calibration point and stay ordered', () => {
  // mindinventory.com, measured by Moz: DA 48, 5.6k linking root domains, 7.2k ranking keywords; Tranco #484k; 1,321 archived pages
  const lrd = A.estimateLinkingDomains({ score: 48 });
  assert.ok(lrd.mid >= 5000 && lrd.mid <= 6200, String(lrd.mid));
  assert.ok(lrd.low < 5600 && lrd.high > 5600);
  const kw = A.estimateKeywords({ score: 48, pages: { found: true, distinct: 1321, truncated: false }, tranco: { ranked: true, median: 484436 } });
  assert.ok(kw.mid >= 6500 && kw.mid <= 8000, String(kw.mid));
  assert.match(kw.basis, /pages/);
  assert.match(kw.basis, /rank/);
  // more authority → more linking domains; truncated page samples are not trusted
  let prev = 0;
  for (const s of [0, 10, 20, 35, 50, 65, 80, 90, 96, 100]) { const v = A.estimateLinkingDomains({ score: s }).mid; assert.ok(v > prev, `DA ${s}`); prev = v; }
  assert.equal(A.estimateKeywords({ score: 60, pages: { found: true, distinct: 9000, truncated: true } }).basis, 'authority only');
  // the full result carries both
  const r = A.scoreAuthority({ tranco: trancoAt(5000), rdap: rdapOld, archive: archiveBig, dns: dnsGood }, { now: NOW, domain: 'example.com' });
  assert.ok(r.links.mid > 10000 && r.keywords.mid > 10000);
});
