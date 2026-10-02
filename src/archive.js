const MiB = 1024 * 1024;
export const archiveLimits = { file: 256 * MiB, expanded: 512 * MiB, page: 64 * MiB, pages: 3000 };
const imageTypes = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif', bmp: 'image/bmp' };
const fileOrder = new Intl.Collator('ko', { numeric: true, sensitivity: 'base' });
const damaged = () => new Error('압축 파일이 손상되었거나 올바른 ZIP·CBZ 형식이 아닙니다.');
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function entryName(bytes, flags, extra) {
  // Unicode Path extra fields take precedence over the legacy filename bytes.
  const fields = new DataView(extra.buffer, extra.byteOffset, extra.byteLength);
  for (let offset = 0; offset + 4 <= extra.length;) {
    const tag = fields.getUint16(offset, true), size = fields.getUint16(offset + 2, true);
    if (offset + 4 + size > extra.length) throw damaged();
    if (tag === 0x7075 && size >= 5 && extra[offset + 4] === 1 && fields.getUint32(offset + 5, true) === crc32(bytes)) {
      return new TextDecoder('utf-8', { fatal: true }).decode(extra.subarray(offset + 9, offset + 4 + size));
    }
    offset += 4 + size;
  }
  if (flags & 0x800) return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch (_) { return new TextDecoder('euc-kr').decode(bytes); }
}

export function readArchiveDirectory(buffer, limits = archiveLimits) {
  const bytes = new Uint8Array(buffer), data = new DataView(buffer);
  if (bytes.length > limits.file) throw new Error('압축 파일은 256 MB 이하로 추가해 주세요.');
  let end = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset--) {
    if (data.getUint32(offset, true) === 0x06054b50 && offset + 22 + data.getUint16(offset + 20, true) === bytes.length) { end = offset; break; }
  }
  if (end < 0) throw damaged();
  const count = data.getUint16(end + 10, true), directorySize = data.getUint32(end + 12, true), directory = data.getUint32(end + 16, true);
  if (data.getUint16(end + 4, true) || data.getUint16(end + 6, true) || data.getUint16(end + 8, true) !== count) throw new Error('여러 파일로 분할된 압축 파일은 지원하지 않습니다.');
  if (count === 0xffff || directory === 0xffffffff || directorySize === 0xffffffff) throw new Error('ZIP64 압축 파일은 지원하지 않습니다. 일반 ZIP 형식으로 저장해 주세요.');
  if (directory + directorySize > end) throw damaged();
  const entries = [], names = new Set();
  let offset = directory, expanded = 0;
  for (let entry = 0; entry < count; entry++) {
    if (offset + 46 > directory + directorySize || data.getUint32(offset, true) !== 0x02014b50) throw damaged();
    const flags = data.getUint16(offset + 8, true), method = data.getUint16(offset + 10, true);
    const crc = data.getUint32(offset + 16, true), compressed = data.getUint32(offset + 20, true), size = data.getUint32(offset + 24, true);
    const nameLength = data.getUint16(offset + 28, true), extraLength = data.getUint16(offset + 30, true), commentLength = data.getUint16(offset + 32, true);
    const disk = data.getUint16(offset + 34, true), local = data.getUint32(offset + 42, true), next = offset + 46 + nameLength + extraLength + commentLength;
    if (next > directory + directorySize || disk) throw damaged();
    const nameBytes = bytes.subarray(offset + 46, offset + 46 + nameLength);
    let name;
    try { name = entryName(nameBytes, flags, bytes.subarray(offset + 46 + nameLength, offset + 46 + nameLength + extraLength)).replaceAll('\\', '/'); }
    catch (_) { throw damaged(); }
    offset = next;
    const parts = name.split('/'), type = imageTypes[name.split('.').pop().toLowerCase()];
    if (!type || name.endsWith('/') || parts.some(part => part.startsWith('.')) || parts.includes('__MACOSX')) continue;
    if (name.startsWith('/') || /^[a-z]:/i.test(name) || name.includes('\0') || parts.some(part => !part || part === '..')) throw damaged();
    if (names.has(name)) throw new Error('압축 파일 안에 같은 이름의 이미지가 여러 개 있습니다.');
    names.add(name);
    if (flags & 0x41) throw new Error('비밀번호로 암호화된 ZIP·CBZ는 지원하지 않습니다.');
    if (![0, 8].includes(method)) throw new Error('이 압축 방식은 지원하지 않습니다. 일반 ZIP 압축으로 다시 저장해 주세요.');
    if (size === 0xffffffff || compressed === 0xffffffff || local === 0xffffffff) throw new Error('ZIP64 압축 파일은 지원하지 않습니다.');
    expanded += size;
    if (size > limits.page || expanded > limits.expanded || entries.length >= limits.pages) throw new Error('압축을 푼 이미지는 한 장 64 MB, 전체 512 MB, 3,000장 이하로 추가해 주세요.');
    if (local + 30 > directory || data.getUint32(local, true) !== 0x04034b50 || data.getUint16(local + 6, true) !== flags || data.getUint16(local + 8, true) !== method) throw damaged();
    const localNameLength = data.getUint16(local + 26, true), localExtraLength = data.getUint16(local + 28, true);
    const start = local + 30 + localNameLength + localExtraLength;
    if (start + compressed > directory || localNameLength !== nameLength || !nameBytes.every((byte, index) => byte === bytes[local + 30 + index])) throw damaged();
    if (!(flags & 8) && (data.getUint32(local + 14, true) !== crc || data.getUint32(local + 18, true) !== compressed || data.getUint32(local + 22, true) !== size)) throw damaged();
    entries.push({ name, type, method, crc, size, start, compressed });
  }
  if (offset !== directory + directorySize) throw damaged();
  if (!entries.length) throw new Error('압축 파일 안에 지원하는 만화 이미지가 없습니다.');
  return entries.sort((a, b) => fileOrder.compare(a.name, b.name));
}

async function inflate(bytes, expected) {
  let decompressor;
  try { decompressor = new DecompressionStream('deflate-raw'); }
  catch (_) { throw new Error('이 브라우저는 ZIP 압축 해제를 지원하지 않습니다. 최신 브라우저에서 열어 주세요.'); }
  const reader = new Blob([bytes]).stream().pipeThrough(decompressor).getReader(), chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > expected) { await reader.cancel(); throw damaged(); }
      chunks.push(value);
    }
  } catch (_) { await reader.cancel().catch(() => {}); throw damaged(); }
  if (size !== expected) throw damaged();
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}

export async function extractArchive(file, onProgress = () => {}) {
  if (file.size > archiveLimits.file) throw new Error('압축 파일은 256 MB 이하로 추가해 주세요.');
  const buffer = await file.arrayBuffer(), bytes = new Uint8Array(buffer), entries = readArchiveDirectory(buffer), files = [];
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index], compressed = bytes.subarray(entry.start, entry.start + entry.compressed);
    const content = entry.method === 0 ? compressed : await inflate(compressed, entry.size);
    if (content.length !== entry.size || crc32(content) !== entry.crc) throw damaged();
    files.push(new File([content], entry.name, { type: entry.type, lastModified: file.lastModified || 0 }));
    onProgress(index + 1, entries.length);
    // Yield between pages so progress and the rest of the site can repaint.
    if (index % 8 === 7) await new Promise(resolve => setTimeout(resolve, 0));
  }
  return files;
}
