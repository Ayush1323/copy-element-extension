import { test } from 'node:test';
import assert from 'node:assert/strict';

// helpers.js / placeToolbar are pure; the module also imports DOM-free helpers only.
const { placeToolbar } = await import('../../src/content/ui/placement.js');

test('toolbar placement stays in the viewport in every direction', () => {
  const vw = 1000, vh = 700, w = 292, h = 120;
  const cases = [
    { left: 100, top: 300, right: 300, bottom: 340 }, // room above
    { left: 100, top: 10, right: 300, bottom: 40 }, // no room above → below
    { left: 900, top: 10, right: 990, bottom: 40 }, // right edge
    { left: -200, top: 100, right: 50, bottom: 140 }, // off the left edge
    { left: 0, top: 0, right: vw, bottom: vh }, // element fills the viewport → inside
    { left: 50, top: 650, right: 300, bottom: 690 }, // bottom edge, room above
  ];
  for (const r of cases) {
    const p = placeToolbar(r, w, h, vw, vh);
    assert.ok(p.left >= 0 && p.left + w <= vw, JSON.stringify([r, p]));
    assert.ok(p.top >= 0 && p.top + h <= vh, JSON.stringify([r, p]));
  }
  assert.equal(placeToolbar(cases[0], w, h, vw, vh).side, 'above');
  assert.equal(placeToolbar(cases[1], w, h, vw, vh).side, 'below');
  assert.equal(placeToolbar(cases[4], w, h, vw, vh).side, 'inside');
});
