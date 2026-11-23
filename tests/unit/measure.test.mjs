import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadHtml } from './setup.mjs';

const M = await import('../../src/content/core/measure.js');
const R = (left, top, right, bottom) => ({ left, top, right, bottom, width: right - left, height: bottom - top });
const vals = (r) => r.segs.map((s) => `${s.dir}${M.fmt(s.value)}`).sort();

test('numbers are shown without noise', () => {
  assert.equal(M.fmt(12), '12');
  assert.equal(M.fmt(12.04), '12');
  assert.equal(M.fmt(12.5), '12.5');
  assert.equal(M.fmt(0), '0');
});

test('box layers nest margin ⊃ border ⊃ padding ⊃ content', () => {
  const box = { rect: R(100, 100, 300, 200), margin: { t: 10, r: 20, b: 10, l: 20 }, border: { t: 2, r: 2, b: 2, l: 2 }, padding: { t: 8, r: 8, b: 8, l: 8 } };
  const L = M.boxLayers(box);
  assert.deepEqual(L.margin, { left: 80, top: 90, right: 320, bottom: 210 });
  assert.deepEqual(L.border, { left: 100, top: 100, right: 300, bottom: 200 });
  assert.deepEqual(L.padding, { left: 102, top: 102, right: 298, bottom: 198 });
  assert.deepEqual(L.content, { left: 110, top: 110, right: 290, bottom: 190 });
  const neg = M.boxLayers({ ...box, margin: { t: -5, r: -5, b: -5, l: -5 } });
  assert.deepEqual(neg.margin, neg.border, 'negative margins are not drawn');
  const tiny = M.boxLayers({ rect: R(0, 0, 10, 10), margin: { t: 0, r: 0, b: 0, l: 0 }, border: { t: 0, r: 0, b: 0, l: 0 }, padding: { t: 20, r: 20, b: 20, l: 20 } });
  assert.ok(tiny.content.right >= tiny.content.left && tiny.content.bottom >= tiny.content.top, 'padding larger than the box never inverts it');
});

test('ringClip cuts the inner box out, and is empty when there is no ring', () => {
  const clip = M.ringClip({ left: 0, top: 0, right: 100, bottom: 50 }, { left: 10, top: 5, right: 90, bottom: 45 });
  assert.match(clip, /^polygon\(evenodd, 0px 0px, 100px 0px, 100px 50px, 0px 50px, 0px 0px, 10px 5px, 10px 45px, 90px 45px, 90px 5px, 10px 5px\)$/);
  assert.equal(M.ringClip({ left: 0, top: 0, right: 100, bottom: 50 }, { left: 0, top: 0, right: 100, bottom: 50 }), '');
});

test('gap strips: only neighbours that really are `gap` apart', () => {
  const row = [R(0, 0, 100, 50), R(124, 0, 224, 50), R(248, 0, 348, 50)];
  const s = M.gapStrips(row, 24, 0);
  assert.equal(s.length, 2);
  assert.deepEqual(s[0], { left: 100, right: 124, top: 0, bottom: 50, value: 24, axis: 'col' });
  assert.equal(M.gapStrips(row, 10, 0).length, 0, 'a different gap value finds nothing');
  const grid = [R(0, 0, 100, 50), R(132, 0, 232, 50), R(0, 66, 100, 116), R(132, 66, 232, 116)];
  const g = M.gapStrips(grid, 32, 16);
  assert.equal(g.filter((x) => x.axis === 'col').length, 2);
  assert.equal(g.filter((x) => x.axis === 'row').length, 2);
  assert.deepEqual(M.gapStrips([], 8, 8), []);
});

test('distance: one box inside another gives the four edge distances', () => {
  const r = M.measureBetween(R(0, 0, 300, 200), R(20, 30, 120, 90));
  assert.deepEqual(vals(r), ['h180', 'h20', 'v110', 'v30']);
  assert.deepEqual(vals(M.measureBetween(R(20, 30, 120, 90), R(0, 0, 300, 200))), ['h180', 'h20', 'v110', 'v30'], 'same either way round');
  const left = r.segs.find((s) => s.dir === 'h' && s.value === 20);
  assert.equal(left.y1, 60, 'drawn through the middle of the inner box');
});

test('distance: boxes above each other have one vertical gap, drawn where they overlap', () => {
  const r = M.measureBetween(R(660, 60, 820, 150), R(760, 260, 900, 330));
  assert.deepEqual(vals(r), ['v110']);
  assert.equal(r.segs[0].x1, 790, 'in the middle of the shared horizontal range');
  assert.equal(r.segs[0].y1, 150); assert.equal(r.segs[0].y2, 260);
});

test('distance: side by side has one horizontal gap', () => {
  assert.deepEqual(vals(M.measureBetween(R(0, 0, 100, 100), R(150, 20, 250, 80))), ['h50']);
  assert.deepEqual(vals(M.measureBetween(R(150, 20, 250, 80), R(0, 0, 100, 100))), ['h50']);
});

test('distance: diagonal boxes get both gaps and dashed guides to the boxes', () => {
  const r = M.measureBetween(R(0, 0, 100, 100), R(150, 160, 250, 260));
  assert.deepEqual(vals(r), ['h50', 'v60']);
  assert.ok(r.guides.length >= 1, 'guides connect the lines to the boxes');
});

test('distance: touching boxes have no gap, overlapping boxes show how far the edges are apart', () => {
  assert.deepEqual(M.measureBetween(R(0, 0, 100, 100), R(100, 0, 200, 100)).segs, []);
  assert.deepEqual(vals(M.measureBetween(R(0, 0, 100, 100), R(60, 40, 160, 140))), ['h60', 'h60', 'v40', 'v40']);
});

test('info card rows leave out zeros and read like CSS', () => {
  const box = {
    rect: R(0, 0, 148, 108), margin: { t: 10, r: 0, b: 10, l: 0 }, border: { t: 2, r: 2, b: 2, l: 2 }, padding: { t: 12, r: 12, b: 12, l: 12 },
    display: 'flex', flexDirection: 'column', position: 'relative', gapRow: 24, gapCol: 24,
  };
  const rows = M.cardRows(box);
  assert.deepEqual(rows.map((r) => [r.k, r.v]), [['Size', '148 × 108'], ['Margin', '10 0'], ['Border', '2'], ['Padding', '12'], ['Gap', '24'], ['Display', 'flex · column'], ['Position', 'relative']]);
  const plain = M.cardRows({ ...box, margin: { t: 0, r: 0, b: 0, l: 0 }, border: { t: 0, r: 0, b: 0, l: 0 }, padding: { t: 0, r: 0, b: 0, l: 0 }, gapRow: 0, gapCol: 0, display: 'block', flexDirection: '', position: 'static' });
  assert.deepEqual(plain.map((r) => r.k), ['Size', 'Display']);
  assert.equal(M.shorthand({ t: 1, r: 2, b: 3, l: 4 }), '1 2 3 4');
  assert.equal(M.shorthand({ t: 8, r: 16, b: 8, l: 16 }), '8 16');
  assert.equal(M.cardRows({ ...box, gapRow: 16, gapCol: 32 }).find((r) => r.k === 'Gap').v, '16 / 32');
});

test('CSS summary is paste-ready', () => {
  const css = M.cssSummary({ rect: R(0, 0, 148, 108), margin: { t: 10, r: 0, b: 10, l: 0 }, border: { t: 0, r: 0, b: 0, l: 0 }, padding: { t: 12, r: 12, b: 12, l: 12 }, gapRow: 24, gapCol: 12 }, 'div#b1');
  assert.equal(css, '/* div#b1 */\nwidth: 148px;\nheight: 108px;\nmargin: 10px 0px 10px 0px;\npadding: 12px 12px 12px 12px;\ngap: 24px 12px;');
});

test('readBox reads the computed box model, and gaps only for flex / grid', () => {
  const doc = loadHtml('<body><div id="f" style="display:flex;row-gap:8px;column-gap:20px;padding:5px 6px 7px 8px;margin:1px 2px 3px 4px;border:3px solid red;position:relative"><i>x</i></div><p id="p" style="padding:9px">t</p><div id="pc" style="display:flex;gap:10%">t</div></body>');
  const b = M.readBox(doc.getElementById('f'));
  assert.deepEqual(b.padding, { t: 5, r: 6, b: 7, l: 8 });
  assert.deepEqual(b.margin, { t: 1, r: 2, b: 3, l: 4 });
  assert.deepEqual(b.border, { t: 3, r: 3, b: 3, l: 3 });
  assert.equal(b.gapRow, 8); assert.equal(b.gapCol, 20);
  assert.equal(b.display, 'flex'); assert.equal(b.position, 'relative');
  const p = M.readBox(doc.getElementById('p'));
  assert.equal(p.gapRow, 0); assert.equal(p.gapCol, 0);
  assert.equal(M.readBox(doc.getElementById('pc')).gapRow, 0, 'percentage gaps are ignored, not misread');
});

test('short selectors', () => {
  const doc = loadHtml('<body><div id="a" class="x y"></div><p class="only"></p><span></span><b class="' + 'z'.repeat(60) + '"></b></body>');
  assert.equal(M.shortSelector(doc.getElementById('a')), 'div#a');
  assert.equal(M.shortSelector(doc.querySelector('p')), 'p.only');
  assert.equal(M.shortSelector(doc.querySelector('span')), 'span');
  assert.ok(M.shortSelector(doc.querySelector('b')).length <= 34);
});
