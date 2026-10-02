import test from 'node:test';
import assert from 'node:assert/strict';
import { pairForSpread, maxSpreadForCount, constrainCorner, foldGeometry } from '../src/geometry.js';

function area(polygon) {
  return Math.abs(polygon.reduce((sum, p, i) => {
    const next = polygon[(i + 1) % polygon.length];
    return sum + p.x * next.y - next.x * p.y;
  }, 0)) / 2;
}

test('each image appears exactly once across the cover, spreads, and last page', () => {
  for (let count = 1; count <= 25; count++) {
    for (const direction of ['ltr', 'rtl']) {
      const shown = [];
      for (let spread = 0; spread <= maxSpreadForCount(count); spread++) shown.push(...pairForSpread(spread, direction).filter(i => i >= 0 && i < count));
      assert.deepEqual(shown.sort((a, b) => a - b), Array.from({ length: count }, (_, i) => i));
    }
  }
});

test('grabbed corners cannot stretch either attachment to the book spine', () => {
  const width = 300, height = 420;
  for (const cornerY of [0, height]) {
    for (let x = -600; x <= 600; x += 100) {
      for (let y = -400; y <= 800; y += 100) {
        const point = constrainCorner({ x, y }, cornerY, width, height);
        assert.ok(Math.hypot(point.x, point.y - cornerY) <= width + 1e-7);
        assert.ok(Math.hypot(point.x, point.y - (height - cornerY)) <= Math.hypot(width, height) + 1e-7);
      }
    }
  }
});

test('paper area is conserved before and after diagonal folds', () => {
  const width = 300, height = 420;
  for (const cornerY of [0, height]) {
    for (const point of [{x:290,y:30},{x:170,y:160},{x:0,y:280},{x:-210,y:310}]) {
      const fold = foldGeometry(point, cornerY, width, height);
      assert.ok(fold);
      assert.ok(Math.abs(area(fold.front) + area(fold.folded) - width * height) < 1e-6);
      assert.ok(Math.abs(area(fold.folded) - area(fold.reflected)) < 1e-6);
      const reflectedCorner = {
        x: width - 2 * fold.nx * (fold.nx * width + fold.ny * cornerY - fold.k),
        y: cornerY - 2 * fold.ny * (fold.nx * width + fold.ny * cornerY - fold.k)
      };
      const constrained = constrainCorner(point, cornerY, width, height);
      assert.ok(Math.hypot(reflectedCorner.x - constrained.x, reflectedCorner.y - constrained.y) < 1e-7);
    }
  }
});
