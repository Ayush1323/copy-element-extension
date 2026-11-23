import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadHtml } from './setup.mjs';

const T = await import('../../src/content/core/text-info.js');
const { placeBeside } = await import('../../src/content/ui/placement.js');

test('parseColor reads every form getComputedStyle can return', () => {
  assert.deepEqual(T.parseColor('rgb(17, 24, 39)'), { r: 17, g: 24, b: 39, a: 1 });
  assert.deepEqual(T.parseColor('rgba(17, 24, 39, 0.5)'), { r: 17, g: 24, b: 39, a: 0.5 });
  assert.deepEqual(T.parseColor('rgb(17 24 39 / 25%)'), { r: 17, g: 24, b: 39, a: 0.25 });
  assert.deepEqual(T.parseColor('color(srgb 1 0 0.5)'), { r: 255, g: 0, b: 128, a: 1 });
  assert.deepEqual(T.parseColor('#2563EB'), { r: 37, g: 99, b: 235, a: 1 });
  assert.deepEqual(T.parseColor('#fff'), { r: 255, g: 255, b: 255, a: 1 });
  assert.deepEqual(T.parseColor('transparent'), { r: 0, g: 0, b: 0, a: 0 });
  assert.equal(T.parseColor(''), null);
  assert.equal(T.parseColor(null), null);
});

test('colours are written as HEX, RGB and HSL', () => {
  const c = { r: 37, g: 99, b: 235, a: 1 };
  assert.equal(T.toHex(c), '#2563EB');
  assert.equal(T.toRgb(c), 'rgb(37, 99, 235)');
  assert.equal(T.toHsl(c), 'hsl(221, 83%, 53%)');
  const a = { r: 17, g: 24, b: 39, a: 0.5 };
  assert.equal(T.toHex(a), '#11182780');
  assert.equal(T.toRgb(a), 'rgba(17, 24, 39, 0.5)');
  assert.match(T.toHsl(a), /^hsla\(\d+, \d+%, \d+%, 0\.5\)$/);
  assert.equal(T.toHsl({ r: 0, g: 0, b: 0, a: 1 }), 'hsl(0, 0%, 0%)');
  assert.equal(T.toHsl({ r: 255, g: 255, b: 255, a: 1 }), 'hsl(0, 0%, 100%)');
  assert.equal(T.toHex({ r: 0, g: 0, b: 0, a: 1 }), '#000000');
});

test('hex written by toHex parses back to the same colour', () => {
  for (const c of [{ r: 1, g: 2, b: 3, a: 1 }, { r: 255, g: 128, b: 0, a: 1 }, { r: 10, g: 200, b: 99, a: 1 }]) {
    assert.deepEqual(T.parseColor(T.toHex(c)), c);
    assert.deepEqual(T.parseColor(T.toRgb(c)), c);
  }
});

test('contrast follows WCAG 2', () => {
  const black = { r: 0, g: 0, b: 0, a: 1 }, white = { r: 255, g: 255, b: 255, a: 1 };
  assert.equal(Math.round(T.contrastRatio(black, white)), 21);
  assert.equal(T.contrastRatio(white, white), 1);
  const grey = { r: 119, g: 119, b: 119, a: 1 }; // #777 on white = 4.48:1, the classic just-below-AA
  assert.ok(Math.abs(T.contrastRatio(grey, white) - 4.48) < 0.02);
  assert.equal(T.contrastLevel(21, 16, 400), 'AAA');
  assert.equal(T.contrastLevel(4.48, 16, 400), 'Fail');
  assert.equal(T.contrastLevel(4.48, 16, 400) === 'Fail' && T.contrastLevel(4.48, 24, 400), 'AA'); // large text only needs 3:1 (AA) / 4.5:1 (AAA)
  assert.equal(T.contrastLevel(4.6, 16, 400), 'AA');
  assert.deepEqual(T.compositeOver({ r: 0, g: 0, b: 0, a: 0.5 }, white), { r: 127.5, g: 127.5, b: 127.5, a: 1 });
});

test('font stacks split on commas outside quotes; weights have their usual names', () => {
  assert.deepEqual(T.parseFamilies('"Helvetica Neue", Arial, \'Segoe UI\', sans-serif'), ['Helvetica Neue', 'Arial', 'Segoe UI', 'sans-serif']);
  assert.deepEqual(T.parseFamilies('"Name, with comma", serif'), ['Name, with comma', 'serif']);
  assert.deepEqual(T.parseFamilies(''), []);
  assert.equal(T.weightName(400), 'Regular');
  assert.equal(T.weightName(700), 'Bold');
  assert.equal(T.weightName(650), '');
});

const doc = loadHtml(`<body>
<div id="page" style="background-color: rgb(250, 250, 250)">
  <div id="card" style="background-color: rgba(0, 0, 0, 0.1)">
    <h2 id="h" style="font-family: 'Inter', Arial, sans-serif; font-size: 24px; font-weight: 700; font-style: italic; color: rgb(17, 24, 39); letter-spacing: 0.5px; line-height: 32px; text-transform: uppercase; text-align: center">Big heading</h2>
  </div>
</div>
<div id="img" style="background-image: url(x.png)"><p id="onimg" style="color: rgb(255, 255, 255)">Over an image</p></div>
<p id="plain" style="color: rgb(119, 119, 119)">Plain text</p></body>`);

test('readTextInfo reports the computed typography', () => {
  const h = doc.getElementById('h');
  const i = T.readTextInfo(h, h.firstChild);
  assert.equal(i.tag, 'h2');
  assert.equal(i.sample, 'Big heading');
  assert.equal(i.family, 'Inter');
  assert.deepEqual(i.families, ['Inter', 'Arial', 'sans-serif']);
  assert.equal(i.sizeText, '24px');
  assert.equal(i.weight, 700);
  assert.equal(i.weightName, 'Bold');
  assert.equal(i.style, 'italic');
  assert.equal(i.lineHeightText, '32px');
  assert.equal(i.lineHeightRatio, '1.33');
  assert.equal(i.letterSpacingText, '0.5px');
  assert.equal(i.transform, 'uppercase');
  assert.equal(i.align, 'center');
  assert.equal(T.toHex(i.color), '#111827');
});

test('the background is the blend of the translucent layers behind the text, and contrast uses it', () => {
  const h = doc.getElementById('h');
  const i = T.readTextInfo(h, h.firstChild);
  assert.equal(i.bg.image, false);
  // 10% black over rgb(250,250,250) = 225
  assert.equal(T.toHex(i.bg.color), '#E1E1E1');
  assert.ok(i.contrast && i.contrast.ratio > 10, 'dark text on a light grey is high contrast');
  assert.equal(i.contrast.level, 'AAA');
});

test('text over an image/gradient has no single background colour, so no contrast figure', () => {
  const p = doc.getElementById('onimg');
  const i = T.readTextInfo(p, p.firstChild);
  assert.equal(i.bg.image, true);
  assert.equal(i.bg.color, null);
  assert.equal(i.contrast, null);
});

test('text with no background of its own sits on the white page', () => {
  const p = doc.getElementById('plain');
  const i = T.readTextInfo(p, p.firstChild);
  assert.equal(T.toHex(i.bg.color), '#FFFFFF');
  assert.equal(i.contrast.level, 'Fail'); // #777 on white
  assert.equal(i.lineHeightText, 'normal');
  assert.equal(i.letterSpacingText, 'normal');
});

test('textInfoSignature changes when anything shown changes, and only then', () => {
  const p = doc.getElementById('plain');
  const a = T.textInfoSignature(T.readTextInfo(p, p.firstChild));
  assert.equal(T.textInfoSignature(T.readTextInfo(p, p.firstChild)), a);
  p.style.fontWeight = '600';
  assert.notEqual(T.textInfoSignature(T.readTextInfo(p, p.firstChild)), a);
  p.style.fontWeight = '';
});

test('cssBlock is paste-ready CSS', () => {
  const h = doc.getElementById('h');
  const css = T.cssBlock(T.readTextInfo(h, h.firstChild));
  assert.match(css, /^font-family: .*Inter.*;$/m);
  assert.match(css, /^font-size: 24px;$/m);
  assert.match(css, /^font-weight: 700;$/m);
  assert.match(css, /^font-style: italic;$/m);
  assert.match(css, /^line-height: 32px;$/m);
  assert.match(css, /^letter-spacing: 0\.5px;$/m);
  assert.match(css, /^color: #111827;$/m);
  assert.match(css, /^text-transform: uppercase;$/m);
});

test('placeBeside keeps the panel next to its anchor, off the pointer, and inside the screen', () => {
  const r = { left: 100, right: 200, top: 100, bottom: 120 };
  const below = placeBeside(r, { x: 150, y: 110 }, 320, 200, 1000, 800);
  assert.equal(below.edge, 'top');
  assert.equal(below.top, 120);
  const near = { left: 100, right: 200, top: 700, bottom: 720 };
  const above = placeBeside(near, { x: 150, y: 710 }, 320, 200, 1000, 800);
  assert.equal(above.edge, 'bottom');
  assert.ok(above.top + 200 <= 700);
  const edge = placeBeside({ left: 900, right: 990, top: 100, bottom: 120 }, null, 320, 200, 1000, 800);
  assert.ok(edge.left + 320 <= 1000 - 6, 'clamped inside the right edge');
});

test('gradients are split from other background layers and their colour stops are listed', () => {
  const css = 'linear-gradient(90deg, rgb(37, 99, 235) 0%, rgba(147, 51, 234, 0.5) 100%), url("a,b.png")';
  assert.deepEqual(T.splitLayers(css), ['linear-gradient(90deg, rgb(37, 99, 235) 0%, rgba(147, 51, 234, 0.5) 100%)', 'url("a,b.png")']);
  assert.equal(T.gradientOf(css), 'linear-gradient(90deg, rgb(37, 99, 235) 0%, rgba(147, 51, 234, 0.5) 100%)');
  assert.equal(T.gradientOf('url(x.png)'), '');
  assert.equal(T.gradientOf('none'), '');
  assert.equal(T.gradientOf('radial-gradient(circle, rgb(0, 0, 0), rgb(255, 255, 255))'), 'radial-gradient(circle, rgb(0, 0, 0), rgb(255, 255, 255))');
  const stops = T.gradientStops('linear-gradient(90deg, rgb(37, 99, 235), rgb(147, 51, 234), rgb(37, 99, 235))');
  assert.deepEqual(stops.map((s) => s.hex), ['#2563EB', '#9333EA'], 'distinct, in order');
  assert.equal(T.gradientStops('linear-gradient(#fff, #000)').length, 2);
  assert.deepEqual(T.gradientStops(''), []);
});
