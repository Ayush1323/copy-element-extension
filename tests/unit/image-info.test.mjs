import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadHtml } from './setup.mjs';

const { ratio, formatBytes, middleTruncate, backgroundUrl, readImageInfo, infoRows, getFileSize } = await import('../../src/content/core/image-info.js');

test('ratios are reduced like DevTools', () => {
  assert.equal(ratio(296, 166), '148:83');
  assert.equal(ratio(767, 278), '767:278');
  assert.equal(ratio(100, 100), '1:1');
  assert.equal(ratio(0, 10), '—');
});

test('byte formatting uses decimal units', () => {
  assert.equal(formatBytes(null), 'Unavailable');
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(22300), '22.3 kB');
  assert.equal(formatBytes(2_500_000), '2.50 MB');
});

test('middleTruncate keeps both ends', () => {
  const s = 'https://example.com/' + 'a'.repeat(80) + '/banner.webp';
  const t = middleTruncate(s, 40);
  assert.equal(t.length, 40);
  assert.ok(t.startsWith('https://') && t.endsWith('banner.webp') && t.includes('…'));
});

test('backgroundUrl extracts the first url() and ignores gradients / none', () => {
  assert.equal(backgroundUrl('none'), null);
  assert.equal(backgroundUrl('linear-gradient(red, blue)'), null);
  assert.equal(backgroundUrl('url("https://x.test/a.jpg")'), 'https://x.test/a.jpg');
  assert.equal(backgroundUrl('linear-gradient(rgba(0,0,0,.4), rgba(0,0,0,.4)), url("/img/hero.webp")'), '/img/hero.webp');
  assert.equal(backgroundUrl("url('data:image/svg+xml;utf8,<svg/>')"), 'data:image/svg+xml;utf8,<svg/>');
});

test('rows follow the DevTools order for <img> and background targets', () => {
  const doc = loadHtml('<body><img id="b" src="https://x.test/b.png"><div id="d"></div></body>');
  const img = { el: doc.getElementById('b'), kind: 'img', url: 'https://x.test/b.png' };
  const rows = infoRows(readImageInfo(img), '1.0 kB');
  assert.deepEqual(rows.map((r) => r[0]), ['Rendered size', 'Rendered aspect ratio', 'Intrinsic size', 'Intrinsic aspect ratio', 'File size', 'Current source']);
  assert.equal(rows[2][1], 'Not loaded'); // jsdom does not load images
  assert.equal(rows[5][1], 'https://x.test/b.png');
  const bg = readImageInfo({ el: doc.getElementById('d'), kind: 'bg', url: 'https://x.test/hero.jpg' });
  assert.equal(infoRows(bg, '—')[2][1], 'Loading…'); // background intrinsic size is probed asynchronously
});

test('data: URL file size is computed exactly', async () => {
  const svg = "<svg xmlns='http://www.w3.org/2000/svg'/>";
  assert.equal(await getFileSize('data:image/svg+xml;utf8,' + encodeURIComponent(svg)), svg.length);
  assert.equal(await getFileSize('data:image/gif;base64,R0lGODlhAQABAAAAACw='), 14);
});
