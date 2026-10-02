import test from 'node:test';
import assert from 'node:assert/strict';
import { visiblePages, steppedPage, pageFromBook, spreadForPage, seriesFields, orderedVolumes } from '../src/reading-state.js';

test('every page is reachable in each mode, including a final unpaired page', () => {
  for (const count of [1, 2, 5, 6]) for (const mode of ['flip', 'single', 'double', 'scroll']) {
    const reached = [];
    let page = 0;
    for (let steps = 0; steps < count + 1; steps++) {
      reached.push(...visiblePages(mode, page, count));
      const next = steppedPage(mode, page, count, 1);
      if (next === page) break;
      page = next;
    }
    assert.deepEqual(reached.sort((a, b) => a - b), Array.from({ length: count }, (_, index) => index), `${mode} must include every page once`);
    assert.equal(steppedPage(mode, 0, count, -1), 0);
  }
});

test('mode transitions retain the current page and old spread-only books still resume correctly', () => {
  assert.equal(pageFromBook({ pageCount: 8, spread: 2 }), 3);
  assert.equal(pageFromBook({ pageCount: 8, spread: 2, pageIndex: 4 }), 4);
  assert.equal(pageFromBook({ pageCount: 5, pageIndex: 100 }), 4);
  for (let page = 0; page < 8; page++) {
    assert.ok(visiblePages('flip', page, 8).includes(page));
    assert.ok(visiblePages('double', page, 8).includes(page));
    assert.equal(spreadForPage(page), page > 0 ? Math.ceil(page / 2) : 0);
  }
  assert.deepEqual(visiblePages('double', 2, 5, 'rtl'), [3, 2]);
  assert.deepEqual(visiblePages('flip', 1, 5, 'rtl'), [2, 1]);
});

test('series metadata is optional and volumes sort numerically without including trash', () => {
  assert.deepEqual(seriesFields('  작은 우주  ', '2'), { series: '작은 우주', volume: 2 });
  assert.deepEqual(seriesFields('', ''), { series: '', volume: null });
  assert.throws(() => seriesFields('', 1), /시리즈명/);
  assert.throws(() => seriesFields('작은 우주', 1.5), /정수/);
  const books = [{ id: '10', series: '우주', volume: 10 }, { id: '2', series: '우주', volume: 2 }, { id: '1', series: '우주', volume: 1 }, { id: 'trash', series: '우주', volume: 3, deletedAt: 1 }, { id: 'other', series: '다른 책', volume: 1 }];
  assert.deepEqual(orderedVolumes(books, '우주').map(book => book.id), ['1', '2', '10']);
});
