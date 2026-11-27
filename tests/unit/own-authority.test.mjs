import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { Readable } from 'node:stream';

const L = await import('../../authority-server/lib.mjs');
const { buildIndex } = await import('../../authority-server/build-index.mjs');
const { createAuthorityServer } = await import('../../authority-server/server.mjs');

// real rows from cc-main-2026-sep-oct-nov
const FILE = ['#harmonicc_pos\t#harmonicc_val\t#pr_pos\t#pr_val\t#host_rev\t#n_hosts',
  '1\t3.0531024E7\t1\t0.0147\tcom.googleapis\t7757', '2\t3.0299988E7\t3\t0.0082\tcom.facebook\t3195',
  '371481\t1.5170826E7\t127866\t1.98E-7\tcom.mindinventory\t2'].join('\n');
const input = () => Readable.from([gzipSync(FILE)]);

test('the score is logarithmic, bounded and better for better ranks', () => {
  assert.equal(L.authorityScore(1, 1), 100);
  assert.equal(L.authorityScore(L.TOTAL_DOMAINS, L.TOTAL_DOMAINS), 0);
  assert.equal(L.authorityScore(371481, 127866), 35);
  assert.ok(L.authorityScore(10, 10) > L.authorityScore(1000, 1000));
});

test('names are read from the reversed form, and subdomains fall back to the registered domain', () => {
  assert.equal(L.parseLine('5\t1\t4\t1\tuk.co.example\t1').domain, 'example.co.uk');
  assert.equal(L.parseLine('#header'), null);
  assert.deepEqual(L.candidates('https://www.Blog.Example.com/x'), ['blog.example.com', 'example.com']);
  for (const bad of ['', 'localhost', '../etc/passwd', 'a b.com']) assert.deepEqual(L.candidates(bad), [], bad);
});

test('build, look up, and keep only the top domains when limited', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'll-authority-'));
  assert.equal((await buildIndex({ input: input(), dir })).indexed, 3);
  const hit = L.openIndex(dir).lookup('blog.mindinventory.com');
  assert.deepEqual([hit.found, hit.matched, hit.score, hit.harmonicRank, hit.pageRank], [true, 'mindinventory.com', 35, 371481, 127866]);
  assert.equal(L.openIndex(dir).lookup('unknown.com').found, false);
  const top = await buildIndex({ input: input(), dir, limit: 2 });
  assert.deepEqual([top.indexed, top.complete], [2, false]);
  assert.equal(L.openIndex(dir).lookup('mindinventory.com').found, false);
  await assert.rejects(buildIndex({ input: Readable.from([gzipSync('nonsense')]), dir }), /No domains/);
  assert.equal(L.openIndex(dir).meta.indexed, 2, 'a failed build keeps the previous index');
});

test('the server answers the extension and refuses other hosts', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'll-authority-'));
  const server = createAuthorityServer(dir);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/authority?domain=`;
  try {
    assert.equal((await fetch(`${base}a.com`)).status, 503);
    await buildIndex({ input: input(), dir });
    const ok = await fetch(`${base}facebook.com`, { headers: { origin: 'chrome-extension://abc' } });
    assert.equal(ok.headers.get('access-control-allow-origin'), 'chrome-extension://abc');
    assert.equal((await ok.json()).found, true);
    assert.equal((await fetch(`${base}facebook.com`, { headers: { origin: 'https://evil.test' } })).headers.get('access-control-allow-origin'), null);
    assert.equal((await fetch(`${base}nope`)).status, 400);
    const { request } = await import('node:http');
    const status = await new Promise((r) => request(`${base}a.com`, { headers: { host: 'evil.test' } }, (res) => { res.resume(); r(res.statusCode); }).end());
    assert.equal(status, 403);
  } finally { server.close(); }
});
