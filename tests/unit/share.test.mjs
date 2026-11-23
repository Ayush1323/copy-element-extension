import { test } from 'node:test';
import assert from 'node:assert/strict';

const S = await import('../../src/shared/share.js');
const W = await import('../../server/share-worker/worker.js');
const worker = W.default;

function fakeBucket() {
  const m = new Map();
  return {
    m,
    async put(k, body, o) { m.set(k, { value: body, metadata: o.metadata, ttl: o.expirationTtl }); },
    async getWithMetadata(k) { const v = m.get(k); return v ? { value: v.value, metadata: v.metadata } : { value: null, metadata: null }; },
    async delete(k) { m.delete(k); },
  };
}
const PNG = [137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3];
const JPG = [0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4];
const up = (env, init = {}) => worker.fetch(new Request('https://s.test/upload', { method: 'POST', body: new Uint8Array(init.bytes || PNG), headers: { 'Content-Type': 'image/png', ...init.headers } }), env);
const limiter = (n) => { let left = n; return { async limit() { return { success: left-- > 0 }; } }; };

test('the upload address is fixed at build time; unconfigured builds say so', () => {
  assert.equal(S.shareBase(), '', 'placeholder means "not deployed"');
  assert.equal(S.shareBase('https://linklens-share.me.workers.dev/'), 'https://linklens-share.me.workers.dev');
  assert.equal(S.shareBase('http://example.com'), '');
  assert.equal(S.shareBase('https://x.invalid'), '');
  assert.equal(S.normalizeEndpoint('http://localhost:8787'), 'http://localhost:8787');
  assert.equal(S.normalizeEndpoint('https://u:p@x.test'), '');
});

test('the link the server sends must stay on the server\'s own origin', () => {
  assert.equal(S.sameOriginLink('https://s.test/i/a.png', 'https://s.test'), 'https://s.test/i/a.png');
  assert.equal(S.sameOriginLink('https://evil.test/i/a.png', 'https://s.test'), '');
  assert.equal(S.sameOriginLink('javascript:alert(1)', 'https://s.test'), '');
  assert.equal(S.sameOriginLink(undefined, 'https://s.test'), '');
});

test('expiry text', () => {
  const now = 1e12;
  assert.equal(S.expiryText(now + 30 * 86400000, now), '30 days');
  assert.equal(S.expiryText(now + 86400000, now), '1 day');
  assert.equal(S.expiryText(now + 3600000, now), 'less than a day');
  assert.equal(S.expiryText(null, now), '');
});

test('upload stores the image and returns an unguessable same-origin link that expires in 30 days by default', async () => {
  const env = { SHOTS: fakeBucket() };
  const r = await up(env);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('access-control-allow-origin'), '*');
  const j = await r.json();
  assert.match(j.url, /^https:\/\/s\.test\/i\/[A-Za-z0-9_-]{16}\.png$/);
  assert.ok(Math.abs(j.expiresAt - (Date.now() + 30 * 86400000)) < 5000);
  const g = await worker.fetch(new Request(j.url), env);
  assert.equal(g.status, 200);
  assert.equal(g.headers.get('content-type'), 'image/png');
  assert.equal(g.headers.get('x-content-type-options'), 'nosniff');
  assert.match(g.headers.get('content-security-policy'), /sandbox/);
});

test('expiry is decided by the server and is easy to change (EXPIRY_DAYS); a client header cannot change it', async () => {
  const a = await (await up({ SHOTS: fakeBucket(), EXPIRY_DAYS: '2' })).json();
  assert.ok(Math.abs(a.expiresAt - (Date.now() + 2 * 86400000)) < 5000);
  const b = await (await up({ SHOTS: fakeBucket() }, { headers: { 'X-Expires-Days': '365' } })).json();
  assert.ok(Math.abs(b.expiresAt - (Date.now() + 30 * 86400000)) < 5000, 'client cannot extend');
  assert.equal((await (await up({ SHOTS: fakeBucket(), EXPIRY_DAYS: '0' })).json()).expiresAt, null);
});

test('ids are different every time; JPEG is accepted too', async () => {
  const env = { SHOTS: fakeBucket() };
  const a = await (await up(env)).json(), b = await (await up(env)).json();
  assert.notEqual(a.url, b.url);
  const j = await (await up(env, { bytes: JPG, headers: { 'Content-Type': 'image/jpeg' } })).json();
  assert.match(j.url, /\.jpg$/);
});

test('an expired link is inaccessible, and its file is deleted', async () => {
  const env = { SHOTS: fakeBucket() };
  const j = await (await up(env)).json();
  const key = [...env.SHOTS.m.keys()][0];
  env.SHOTS.m.get(key).metadata.expiresAt = Date.now() - 1000;
  assert.equal((await worker.fetch(new Request(j.url), env)).status, 404);
  assert.equal((await worker.fetch(new Request(j.url, { method: 'HEAD' }), env)).status, 404);
  assert.equal(env.SHOTS.m.size, 0);
});

test('a deleted file is inaccessible', async () => {
  const env = { SHOTS: fakeBucket() };
  const j = await (await up(env)).json();
  await env.SHOTS.delete([...env.SHOTS.m.keys()][0]);
  assert.equal((await worker.fetch(new Request(j.url), env)).status, 404);
});

test('KV is told to delete the file itself when it expires (no cron, no card needed); "never" sets no expiry', async () => {
  const env = { SHOTS: fakeBucket() };
  await up(env);
  assert.equal([...env.SHOTS.m.values()][0].ttl, 30 * 86400);
  const e0 = { SHOTS: fakeBucket(), EXPIRY_DAYS: '0' };
  await up(e0);
  assert.equal([...e0.SHOTS.m.values()][0].ttl, undefined);
});

test('rate limiting: the 429 comes with Retry-After and nothing is stored', async () => {
  const env = { SHOTS: fakeBucket(), RATE_LIMITER: limiter(2) };
  assert.equal((await up(env)).status, 200);
  assert.equal((await up(env)).status, 200);
  const r = await up(env);
  assert.equal(r.status, 429);
  assert.equal(r.headers.get('retry-after'), '60');
  assert.equal(env.SHOTS.m.size, 2);
});

test('only real PNG/JPEG: wrong type header, fake signature, empty and oversized uploads are refused', async () => {
  const env = { SHOTS: fakeBucket(), MAX_BYTES: '20' };
  const post = (body, type) => worker.fetch(new Request('https://s.test/upload', { method: 'POST', body, headers: { 'Content-Type': type } }), env);
  assert.equal((await post('<script>', 'text/html')).status, 415);
  assert.equal((await post(new Uint8Array([...'<script>alert(1)</script>'].map((c) => c.charCodeAt(0))), 'image/png')).status, 413, 'too large first');
  assert.equal((await post(new Uint8Array([60, 104, 49, 62, 1, 1, 1, 1, 1, 1]), 'image/png')).status, 415, 'html pretending to be a png');
  assert.equal((await post(new Uint8Array(PNG), 'image/jpeg')).status, 415, 'png sent as jpeg');
  assert.equal((await post(new Uint8Array(0), 'image/png')).status, 400);
  assert.equal(env.SHOTS.m.size, 0, 'nothing stored by any refused upload');
  assert.equal(W.sniffType(new Uint8Array(PNG)), 'image/png');
  assert.equal(W.sniffType(new Uint8Array(JPG)), 'image/jpeg');
});

test('CORS preflight is answered; unknown paths and GET /upload are refused; bad ids 404', async () => {
  const env = { SHOTS: fakeBucket() };
  const o = await worker.fetch(new Request('https://s.test/upload', { method: 'OPTIONS' }), env);
  assert.equal(o.status, 204);
  assert.match(o.headers.get('access-control-allow-headers'), /Content-Type/);
  assert.equal((await worker.fetch(new Request('https://s.test/upload'), env)).status, 405);
  assert.equal((await worker.fetch(new Request('https://s.test/i/../../etc.png'), env)).status, 404);
  assert.equal((await worker.fetch(new Request('https://s.test/i/AAAAAAAAAAAAAAAAAAAAAA.png'), env)).status, 404);
});

test('no secrets in the extension: neither the worker\'s credentials nor any token appear in the sources the extension ships', async () => {
  const { readFileSync, readdirSync, statSync } = await import('node:fs');
  const { join } = await import('node:path');
  const walk = (d) => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
  const files = walk(new URL('../../src', import.meta.url).pathname).filter((f) => /\.(js|html|css)$/.test(f));
  for (const f of files) {
    const t = readFileSync(f, 'utf8');
    assert.ok(!/UPLOAD_TOKEN|shareToken|Bearer |R2_(SECRET|ACCESS)|AWS_SECRET|api[_-]?key\s*[:=]/i.test(t), 'secret-like text in ' + f);
  }
});
