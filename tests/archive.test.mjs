import test from 'node:test';
import assert from 'node:assert/strict';
import { File } from 'node:buffer';
import { archiveLimits, crc32, readArchiveDirectory, extractArchive } from '../src/archive.js';
import { zipFixture } from './zip-fixture.mjs';

globalThis.File ??= File;
const bufferOf = bytes => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const zipFile = bytes => new File([bytes], '테스트.cbz', { type: 'application/zip' });

test('stored and deflated archives retain image contents and sort folder filenames numerically', async () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926, 'ZIP CRC must match the standard check vector');
  const entries = [
    { name: '만화/10.png', content: 'tenth-image' }, { name: '만화/2.jpg', content: 'second-image' }, { name: '만화/1.png', content: 'first-image' },
    { name: 'ComicInfo.xml', content: '<xml />' }, { name: '__MACOSX/._1.png', content: 'ignored' }
  ];
  for (const method of [0, 8]) {
    const files = await extractArchive(zipFile(zipFixture(entries, { method, descriptor: method === 8 })));
    assert.deepEqual(files.map(file => file.name), ['만화/1.png', '만화/2.jpg', '만화/10.png']);
    assert.deepEqual(await Promise.all(files.map(file => file.text())), ['first-image', 'second-image', 'tenth-image']);
    assert.equal(files[1].type, 'image/jpeg');
  }
});

test('corrupt compressed data or a wrong CRC is rejected rather than saved as a page', async () => {
  for (const method of [0, 8]) {
    const bytes = zipFixture([{ name: '1.png', content: 'a-comic-page' }], { method });
    const [entry] = readArchiveDirectory(bufferOf(bytes)); bytes[entry.start] ^= 0xff;
    await assert.rejects(extractArchive(zipFile(bytes)), /손상/);
  }
});

test('encrypted, unsupported, duplicate, incomplete and oversized archives fail safely', () => {
  const entries = [{ name: '1.png', content: 'page' }];
  assert.throws(() => readArchiveDirectory(bufferOf(zipFixture(entries, { flags: 0x801 }))), /암호화/);
  assert.throws(() => readArchiveDirectory(bufferOf(zipFixture(entries, { method: 9 }))), /압축 방식/);
  assert.throws(() => readArchiveDirectory(bufferOf(zipFixture([...entries, ...entries]))), /같은 이름/);
  assert.throws(() => readArchiveDirectory(bufferOf(zipFixture(entries).subarray(0, 40))), /손상/);
  assert.throws(() => readArchiveDirectory(bufferOf(zipFixture(entries)), { ...archiveLimits, expanded: 2 }), /전체 512/);
  assert.throws(() => readArchiveDirectory(bufferOf(zipFixture(entries)), { ...archiveLimits, pages: 0 }), /3,000/);
  assert.throws(() => readArchiveDirectory(bufferOf(zipFixture([{ name: '/1.png', content: 'page' }]))), /손상/);
  assert.throws(() => readArchiveDirectory(bufferOf(zipFixture([{ name: 'notes.txt', content: 'not an image' }]))), /이미지가 없습니다/);
});
