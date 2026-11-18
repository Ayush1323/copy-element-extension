import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFixture } from './setup.mjs';

const text = await import('../../src/content/core/text-extractor.js');
const card = await import('../../src/content/core/card-extractor.js');
const section = await import('../../src/content/core/section-extractor.js');
const fmt = await import('../../src/content/clipboard/text-formatter.js');
const html = await import('../../src/content/clipboard/html-formatter.js');
const copy = await import('../../src/content/core/copy-service.js');

const SETTINGS = { headingStyle: 'plain', includeButtons: true, defaultFormat: 'plain' };

test('card: extracts heading, description, tags and outcomes in DOM order', () => {
  const doc = loadFixture('clickable-card.html');
  const el = card.findCard(doc.querySelector('#robo-p'));
  assert.equal(el.id, 'robo', 'card boundary is the repeated clickable anchor');
  const out = card.extractCard(el, SETTINGS);
  const expected = [
    'Asset Allocation Robo-Advisory App',
    'A tactical asset allocation robo-advising app with which the company strives to redefine the way individuals engage with their financial futures, fostering a new era of inclusive and informed investment practices.',
    'Technologies:\n- Cloud - Microservices\n- APEX Implementation\n- Admin Panel Implementation',
    'Outcomes:\n- 25% – Spike in ROI\n- 95% – Accuracy rate\n- 15% – Increase in revenues',
  ].join('\n\n');
  assert.equal(out.text, expected);
  assert.equal(out.title, 'Asset Allocation Robo-Advisory App');
});

test('card: ignores hidden, sr-only, script content and does not duplicate text', () => {
  const doc = loadFixture('clickable-card.html');
  const out = card.extractCard(doc.querySelector('#robo'), SETTINGS);
  for (const bad of ['HIDDEN DUPLICATE', 'SCRIPT TEXT', 'Read case study', 'decorative']) assert.ok(!out.text.includes(bad), bad);
  assert.equal(out.text.split('Spike in ROI').length - 1, 1);
});

test('card: hovering empty card space or any child resolves to the same card (never a bare child)', () => {
  const doc = loadFixture('clickable-card.html');
  const start = [doc.querySelector('.card'), doc.querySelector('h2'), doc.querySelector('.tags span'), doc.querySelector('.stat .num')];
  for (const s of start) assert.equal(card.findCard(s).id, 'robo');
  assert.equal(card.findCard(doc.querySelector('#other h2')).id, 'other');
});

test('card: HTML output keeps headings and lists, is sanitized', () => {
  const doc = loadFixture('clickable-card.html');
  const out = card.extractCard(doc.querySelector('#robo'), SETTINGS);
  assert.match(out.html, /<h2>Asset Allocation Robo-Advisory App<\/h2>/);
  assert.match(out.html, /<ul><li>Cloud - Microservices<\/li>/);
  assert.ok(!/<script|onclick|style=/.test(out.html));
});

test('element: single heading and paragraph copy exact text', () => {
  const doc = loadFixture('clickable-card.html');
  const h = copy.buildPayload('text', doc.querySelector('h2'), SETTINGS);
  assert.equal(h.text, 'Asset Allocation Robo-Advisory App');
  const p = copy.buildPayload('element', doc.querySelector('#robo-p'), { ...SETTINGS });
  assert.ok(p.text.startsWith('A tactical asset allocation'));
  assert.match(p.html, /^<p>A tactical/);
  const tag = copy.buildPayload('text', doc.querySelector('#robo-tags span'), SETTINGS);
  assert.equal(tag.text, 'Cloud - Microservices');
});

test('element: inline formatting survives in rich html, lists keep structure', () => {
  const doc = loadFixture('nested-links.html');
  const p = copy.buildPayload('element', doc.querySelector('#para'), SETTINGS);
  assert.equal(p.text, 'Read the official documentation and learn the basics before you start.');
  assert.equal(p.html, '<p>Read the <a href="https://example.test/docs" rel="noopener noreferrer">official documentation</a> and <strong>learn</strong> the <strong>basics</strong> before you start.</p>');
  const l = copy.buildPayload('element', doc.querySelector('#list'), SETTINGS);
  assert.equal(l.text, '- First item\n- Second item\n  - Nested item');
  assert.match(l.html, /<ul><li>First <em>item<\/em><\/li><li>Second item<ul><li>Nested item<\/li><\/ul><\/li><\/ul>/);
  const o = copy.buildPayload('element', doc.querySelector('#olist'), SETTINGS);
  assert.equal(o.text, '1. Step one\n2. Step two');
});

test('element: heading with inline emphasis, buttons and CTA links', () => {
  const doc = loadFixture('nested-links.html');
  assert.equal(copy.buildPayload('text', doc.querySelector('h1'), SETTINGS).text, 'Guide to Fast Design');
  const art = text.extractBlocks(doc.querySelector('#post'), { includeButtons: true });
  const buttons = art.filter((b) => b.type === 'button').map((b) => b.text);
  assert.deepEqual(buttons, ['Get started', 'Subscribe']);
  const none = text.extractBlocks(doc.querySelector('#post'), { includeButtons: false });
  assert.equal(none.filter((b) => b.type === 'button').length, 0);
});

test('sanitizer strips scripts, event handlers, styles and dangerous urls', () => {
  const doc = loadFixture('nested-links.html');
  const p = copy.buildPayload('element', doc.querySelector('#evil'), SETTINGS);
  assert.ok(!/javascript:|onclick|onmouseover|style=|<script/i.test(p.html), p.html);
  assert.ok(p.text.includes('Click here'));
});

test('section: complete section, heading hierarchy, nested cards, lists, no duplicates', () => {
  const doc = loadFixture('complex-section.html');
  const sec = section.findSection(doc.querySelector('.box h3'));
  assert.equal(sec.id, 'services');
  const out = section.extractSection(sec, { ...SETTINGS, headingStyle: 'markdown' });
  assert.ok(out.text.startsWith('## Our Services'), out.text);
  for (const s of ['Mobile Apps', 'Web Platforms', 'Cloud', '- 24/7 support', '[Talk to us]']) assert.ok(out.text.includes(s), s);
  assert.ok(!out.text.includes('Hidden promo'));
  assert.ok(!out.text.includes('FAQ'), 'does not leak into the next section');
  const count = (s) => out.text.split(s).length - 1;
  assert.equal(count('Mobile Apps'), 1);
  assert.equal(count('We build digital products'), 1);
});

test('section: footer & faq sections are detected', () => {
  const doc = loadFixture('complex-section.html');
  assert.equal(section.findSection(doc.querySelector('#ftr p')).id, 'ftr');
  const faq = section.findSection(doc.querySelector('summary'));
  assert.equal(faq.id, 'faq');
  assert.match(section.extractSection(faq, SETTINGS).text, /How long does a project take\?/);
});

test('plain formatter: markdown heading style and label pairing', () => {
  const blocks = [
    { type: 'heading', level: 3, text: 'Title' },
    { type: 'text', text: 'Body.' },
    { type: 'label', text: 'Tags:' },
    { type: 'group', items: [{ text: 'a' }, { text: 'b' }] },
  ];
  assert.equal(fmt.blocksToPlain(blocks, { headingStyle: 'markdown' }), '### Title\n\nBody.\n\nTags:\n- a\n- b');
  assert.equal(fmt.blocksToPlain(blocks), 'Title\n\nBody.\n\nTags:\n- a\n- b');
  assert.match(html.blocksToHtml(blocks), /^<h3>Title<\/h3><p>Body\.<\/p><p><strong>Tags:<\/strong><\/p><ul><li>a<\/li><li>b<\/li><\/ul>$/);
});

test('normalizeText collapses whitespace but keeps line breaks', () => {
  assert.equal(text.normalizeText('  a   b \n  c​  '), 'a b\nc');
});
