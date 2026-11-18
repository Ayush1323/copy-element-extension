import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadHtml } from './setup.mjs';

const { readLinkInfo, findLink, linkSignature } = await import('../../src/content/core/link-info.js');
const { placeLinkPanel } = await import('../../src/content/ui/placement.js');

const doc = loadHtml(`<body>
<a id="m" href="/x?y=1" target="_blank" rel="nofollow  noopener sponsored" title="T" aria-label="A" download>Hello   <b id="b">world</b></a>
<a id="p" href="/p">Plain</a><a id="e" href="/e" rel="">E</a><a id="n">no href</a><div id="host"></div></body>`);

test('readLinkInfo preserves raw values and never invents missing attributes', () => {
  const i = readLinkInfo(doc.getElementById('m'));
  assert.equal(i.text, 'Hello world');
  assert.equal(i.hrefRaw, '/x?y=1');
  assert.equal(i.href, 'https://example.test/x?y=1');
  assert.equal(i.target, '_blank');
  assert.deepEqual(i.relTokens, ['nofollow', 'noopener', 'sponsored']);
  assert.equal(i.rel, 'nofollow  noopener sponsored');
  assert.equal(i.title, 'T');
  assert.equal(i.download, '');
  assert.equal(i.ariaLabel, 'A');
  const p = readLinkInfo(doc.getElementById('p'));
  for (const k of ['target', 'rel', 'title', 'download', 'ariaLabel']) assert.equal(p[k], null, k);
  assert.deepEqual(p.relTokens, []);
  assert.equal(readLinkInfo(doc.getElementById('e')).rel, '');
});

test('findLink supports nested elements, ignores anchors without href, crosses shadow roots', () => {
  assert.equal(findLink(doc.getElementById('b')), doc.getElementById('m'));
  assert.equal(findLink(doc.getElementById('n')), null);
  const sr = doc.getElementById('host').attachShadow({ mode: 'open' });
  sr.innerHTML = '<a href="/s"><span id="s">x</span></a>';
  assert.equal(findLink(sr.getElementById('s')), sr.querySelector('a'));
});

test('signature changes only when something visible changes', () => {
  const a = doc.getElementById('p');
  const s1 = linkSignature(readLinkInfo(a));
  assert.equal(linkSignature(readLinkInfo(a)), s1);
  a.setAttribute('rel', 'ugc');
  assert.notEqual(linkSignature(readLinkInfo(a)), s1);
});

test('link panel placement stays in the viewport', () => {
  const vw = 1000, vh = 700, w = 320, h = 230;
  const cases = [
    { left: 100, top: 100, right: 200, bottom: 120 }, // room below
    { left: 100, top: 600, right: 200, bottom: 620 }, // room only above
    { left: 900, top: 100, right: 990, bottom: 120 }, // right edge
    { left: -50, top: 100, right: 20, bottom: 120 }, // left edge
    { left: 100, top: 300, right: 200, bottom: 320 }, // tiny viewport squeeze handled below
  ];
  for (const r of cases) {
    const p = placeLinkPanel(r, w, h, vw, vh);
    assert.ok(p.left >= 0 && p.left + w <= vw, JSON.stringify([r, p]));
    assert.ok(p.top >= 0 && p.top + h <= vh, JSON.stringify([r, p]));
  }
  assert.equal(placeLinkPanel(cases[0], w, h, vw, vh).side, 'below');
  assert.equal(placeLinkPanel(cases[1], w, h, vw, vh).side, 'above');
});
