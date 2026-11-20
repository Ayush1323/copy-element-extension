import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  hitTest, pick, bounds, getHandles, handleAt, applyHandle, translate, snap45, nextNumber, rectOf, clone, strokeWidth,
} from '../../src/content/screenshot/annotations.js';
import { defaultFilename, sanitizeFilename } from '../../src/content/screenshot/export-service.js';

const rect = (o = {}) => ({ id: 'r', type: 'rect', x: 10, y: 10, w: 100, h: 50, color: '#f00', width: 4, ...o });

test('rect hit-testing: border yes, empty interior no', () => {
  const r = rect();
  assert.equal(hitTest(r, 10, 30), true, 'left border');
  assert.equal(hitTest(r, 60, 60), true, 'bottom border');
  assert.equal(hitTest(r, 60, 35), false, 'interior');
  assert.equal(hitTest(r, 300, 300), false, 'outside');
});

test('rect with negative size (dragged up/left) is normalised', () => {
  const r = rect({ x: 110, y: 60, w: -100, h: -50 });
  assert.deepEqual(rectOf(r), { x: 10, y: 10, w: 100, h: 50 });
  assert.equal(hitTest(r, 10, 30), true);
});

test('ellipse hit-testing follows the outline', () => {
  const e = { id: 'e', type: 'ellipse', x: 0, y: 0, w: 100, h: 60, color: '#000', width: 3 };
  assert.equal(hitTest(e, 50, 0), true, 'top of the outline');
  assert.equal(hitTest(e, 100, 30), true, 'right of the outline');
  assert.equal(hitTest(e, 50, 30), false, 'centre');
  assert.equal(hitTest(e, 2, 2), false, 'bounding-box corner is outside the ellipse');
});

test('lines, arrows and freehand strokes hit within their thickness', () => {
  const l = { id: 'l', type: 'line', x1: 0, y1: 0, x2: 100, y2: 0, color: '#000', width: 6 };
  assert.equal(hitTest(l, 50, 3), true);
  assert.equal(hitTest(l, 50, 20), false);
  const p = { id: 'p', type: 'pencil', points: [[0, 0], [50, 50], [100, 0]], color: '#000', width: 4 };
  assert.equal(hitTest(p, 25, 25), true);
  assert.equal(hitTest(p, 50, 0), false);
  const dot = { id: 'd', type: 'pencil', points: [[20, 20]], color: '#000', width: 6 };
  assert.equal(hitTest(dot, 22, 20), true);
  const hl = { id: 'h', type: 'highlighter', points: [[0, 0], [100, 0]], color: '#ff0', width: 5 };
  assert.ok(strokeWidth(hl) >= 14, 'highlighter is always a thick marker');
  assert.equal(hitTest(hl, 50, 6), true);
});

test('pick returns the topmost annotation', () => {
  const a = rect({ id: 'a' }), b = rect({ id: 'b' });
  assert.equal(pick([a, b], 10, 30).id, 'b');
  assert.equal(pick([a, b], 500, 500), null);
});

test('text and number annotations are hit by their bounds; numbering continues after the highest', () => {
  const t = { id: 't', type: 'text', x: 50, y: 50, text: 'Hello', color: '#000', size: 20, bg: '' };
  const b = bounds(t);
  assert.ok(b.w > 20 && b.h >= 20);
  assert.equal(hitTest(t, 55, 60), true);
  assert.equal(hitTest(t, 5, 5), false);
  const list = [{ type: 'number', n: 1 }, { type: 'rect' }, { type: 'number', n: 4 }];
  assert.equal(nextNumber(list), 5);
  assert.equal(nextNumber([]), 1);
});

test('handles: 8 on shapes, 2 on lines, none on freehand; handleAt finds them', () => {
  assert.equal(getHandles(rect()).length, 8);
  assert.equal(getHandles({ type: 'arrow', x1: 0, y1: 0, x2: 10, y2: 10 }).length, 2);
  assert.equal(getHandles({ type: 'pencil', points: [[0, 0]] }).length, 0);
  assert.equal(handleAt(rect(), 110, 60, 6), 'se');
  assert.equal(handleAt(rect(), 60, 10, 6), 'n');
  assert.equal(handleAt(rect(), 300, 300, 6), null);
});

test('resizing by a handle keeps the opposite corner fixed and supports flipping', () => {
  const orig = rect();
  const a = clone(orig);
  applyHandle(a, 'se', 160, 110, orig);
  assert.deepEqual(rectOf(a), { x: 10, y: 10, w: 150, h: 100 });
  const b = clone(orig);
  applyHandle(b, 'w', 130, 0, orig); // dragged past the right edge → flips
  assert.deepEqual(rectOf(b), { x: 110, y: 10, w: 20, h: 50 });
  const c = clone(orig);
  applyHandle(c, 'e', 60, 0, orig); // only one axis changes
  assert.deepEqual(rectOf(c), { x: 10, y: 10, w: 50, h: 50 });
  const arrow = { id: 'a', type: 'arrow', x1: 0, y1: 0, x2: 50, y2: 50, color: '#000', width: 4 };
  applyHandle(arrow, 'p2', 80, 20, clone(arrow));
  assert.equal(arrow.x2, 80); assert.equal(arrow.y2, 20); assert.equal(arrow.x1, 0);
});

test('shift snaps lines to 0° / 45° / 90°', () => {
  const s = snap45(0, 0, 100, 8);
  assert.ok(Math.abs(s.y) < 1e-9 && Math.abs(s.x - Math.hypot(100, 8)) < 1e-9);
  const d = snap45(0, 0, 50, 46);
  assert.ok(Math.abs(d.x - d.y) < 1e-9);
});

test('translate moves every annotation type', () => {
  const r = translate(rect(), 5, -5);
  assert.deepEqual([r.x, r.y], [15, 5]);
  const l = translate({ type: 'line', x1: 0, y1: 0, x2: 10, y2: 10 }, 3, 4);
  assert.deepEqual([l.x1, l.y1, l.x2, l.y2], [3, 4, 13, 14]);
  const p = translate({ type: 'pencil', points: [[0, 0], [1, 1]] }, 2, 2);
  assert.deepEqual(p.points, [[2, 2], [3, 3]]);
});

test('file names: dated default, sanitised user names, extension forced', () => {
  assert.equal(defaultFilename('png', new Date(2026, 10, 21, 9, 5, 7)), 'LinkLens-2026-11-21_09-05-07.png');
  assert.equal(sanitizeFilename('my:shot/1?.PNG', 'png'), 'myshot1.png');
  assert.equal(sanitizeFilename('  ', 'jpg').endsWith('.jpg'), true);
  assert.equal(sanitizeFilename('report.jpeg', 'jpg'), 'report.jpg');
});
