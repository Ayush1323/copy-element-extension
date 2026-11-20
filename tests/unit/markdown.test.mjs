import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadHtml } from './setup.mjs';

loadHtml('<body></body>');
const { htmlToMarkdown } = await import('../../src/content/clipboard/markdown-formatter.js');

test('links become [text](url)', () => {
  assert.equal(
    htmlToMarkdown('<p>Out of <a href="https://x.test/dt">digital transformation</a>, it grew.</p>'),
    'Out of [digital transformation](https://x.test/dt), it grew.',
  );
});

test('urls with spaces/parentheses are made safe; brackets in labels are escaped', () => {
  assert.equal(htmlToMarkdown('<p><a href="/a b(1)">see [this]</a></p>'), '[see \\[this\\]](/a%20b%281%29)');
});

test('anchors without href keep only their text; empty labels fall back to the url', () => {
  assert.equal(htmlToMarkdown('<p>x <a>plain</a> y</p>'), 'x plain y');
  assert.equal(htmlToMarkdown('<p><a href="https://x.test"></a></p>'), '[https://x.test](https://x.test)');
});

test('headings, emphasis, lists (nested, ordered) and paragraphs', () => {
  const md = htmlToMarkdown('<h2>Title <a href="/t">link</a></h2><p>Some <strong>bold</strong> and <em>italic</em> text.</p><ul><li>one <a href="/1">first</a><ul><li>nested</li></ul></li><li>two</li></ul><ol><li>a</li><li>b</li></ol>');
  assert.equal(md, [
    '## Title [link](/t)',
    'Some **bold** and *italic* text.',
    '- one [first](/1)\n  - nested\n- two',
    '1. a\n2. b',
  ].join('\n\n'));
});

test('emphasis markers never swallow surrounding spaces', () => {
  assert.equal(htmlToMarkdown('<p>a<strong> b </strong>c</p>'), 'a **b** c');
});

test('empty input gives an empty string', () => {
  assert.equal(htmlToMarkdown(''), '');
});

test('wrapBlocksInLink wraps link-less blocks and leaves blocks with their own links alone', async () => {
  const { wrapBlocksInLink } = await import('../../src/content/clipboard/markdown-formatter.js');
  const html = wrapBlocksInLink('<h2>Title</h2><p>Has <a href="/own">own</a> link</p><ul><li>item<ul><li>sub</li></ul></li></ul>', 'https://x.test/card');
  assert.equal(htmlToMarkdown(html), [
    '## [Title](https://x.test/card)',
    'Has [own](/own) link',
    '- [item](https://x.test/card)\n  - [sub](https://x.test/card)',
  ].join('\n\n'));
  assert.equal(wrapBlocksInLink('<p>x</p>', ''), '<p>x</p>');
});
