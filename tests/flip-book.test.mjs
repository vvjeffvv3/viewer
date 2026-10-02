import test from 'node:test';
import assert from 'node:assert/strict';
import { FlipBook } from '../src/flip-book.js';

test('a repeated size observation preserves a live fold while a real resize cancels it', () => {
  const fold = { pointerId: 1 }, pageWidth = 400 / 1.4;
  const reader = {
    canvas: { parentElement: { clientWidth: 800 }, width: 800, height: 452, style: {} },
    context: { setTransform() {} }, ratio: 1.4, turn: fold,
    geometry: { width: 800, height: 452, pageWidth, pageHeight: 400, top: 20, center: 400 },
    getAvailableHeight: () => 400, draw() {}, changed() {},
    cancelTurn() { this.turn = null; }
  };
  FlipBook.prototype.resize.call(reader);
  assert.equal(reader.turn, fold, 'layout notifications must not interrupt the pointer gesture');
  reader.canvas.parentElement.clientWidth = 900;
  FlipBook.prototype.resize.call(reader);
  assert.equal(reader.turn, null, 'a new viewport cannot keep a fold calculated for the old dimensions');
  assert.equal(reader.geometry.width, 900);
});
