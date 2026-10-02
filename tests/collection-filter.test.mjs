import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTags, collectionTags, matchesCollection } from '../src/collection-filter.js';

test('tags normalize spacing, Unicode and case duplicates without losing display names', () => {
  assert.deepEqual(normalizeTags(' 액션,  완결 ， 액션, SF, sf\n일상   만화, , '), ['액션', '완결', 'SF', '일상 만화']);
  assert.deepEqual(normalizeTags(['만화', '만화', ' ']), ['만화']);
  assert.deepEqual(normalizeTags(''), []);
  assert.throws(() => normalizeTags('가'.repeat(41)), /40자/);
  assert.throws(() => normalizeTags(Array.from({ length: 21 }, (_, i) => '태그' + i)), /20개/);
  assert.throws(() => normalizeTags([null]), /글자/);
});

test('tag filters count each comic once and accept collections created before tags existed', () => {
  const options = collectionTags([
    { tags: ['액션', 'SF', 'sf', '태그10'] },
    { tags: ['액션', 'sf', '태그2'] },
    { title: '태그 없는 기존 만화' }
  ]);
  assert.deepEqual(new Map(options.map(({ name, count }) => [name, count])), new Map([['SF', 2], ['액션', 2], ['태그2', 1], ['태그10', 1]]));
  assert.ok(options.findIndex(option => option.name === '태그2') < options.findIndex(option => option.name === '태그10'));
  assert.deepEqual(collectionTags([]), []);
});

test('title search and series narrow results while checked tags match any selected tag', () => {
  const books = [
    { title: '우주 여행 1', series: '별빛', volume: 1, tags: ['액션', 'SF'] },
    { title: '우주 여행 2', series: '별빛', volume: 2, tags: ['완결'] },
    { title: '고요한 오후', tags: ['완결', '일상'] },
    { title: '우주 그림 모음' }
  ];
  const titles = options => books.filter(book => matchesCollection(book, options)).map(book => book.title);
  assert.deepEqual(titles({ tags: ['액션', '완결'] }), ['우주 여행 1', '우주 여행 2', '고요한 오후']);
  assert.deepEqual(titles({ query: ' 우주 ', tags: ['완결'] }), ['우주 여행 2']);
  assert.deepEqual(titles({ query: '여행', series: 'series:별빛', tags: ['sf'] }), ['우주 여행 1']);
  assert.deepEqual(titles({ series: 'standalone', tags: ['완결'] }), ['고요한 오후']);
  assert.deepEqual(titles({ query: '없는 제목', tags: ['완결'] }), []);
  assert.deepEqual(titles({ query: '우주' }), ['우주 여행 1', '우주 여행 2', '우주 그림 모음']);
  assert.deepEqual(titles({ query: '별빛' }), ['우주 여행 1', '우주 여행 2']);
  assert.deepEqual(titles({}), books.map(book => book.title));
  books[1].tags = [];
  assert.deepEqual(titles({ query: '우주', tags: ['완결'] }), []);
});
