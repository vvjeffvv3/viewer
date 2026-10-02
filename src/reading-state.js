export const viewModes = ['flip', 'single', 'double', 'scroll'];
export const cleanMode = mode => viewModes.includes(mode) ? mode : 'flip';
export const cleanPage = (index, count) => Math.min(Math.max(0, count - 1), Math.max(0, Math.floor(Number(index) || 0)));
export const spreadForPage = index => index > 0 ? Math.ceil(index / 2) : 0;
export const pageFromBook = book => cleanPage(Number.isInteger(book.pageIndex) ? book.pageIndex : Math.max(0, (book.spread || 0) * 2 - 1), book.pageCount);

export function visiblePages(mode, index, count, direction = 'ltr') {
  if (!count) return [];
  const current = cleanPage(index, count);
  if (mode === 'flip') {
    const spread = spreadForPage(current);
    const pair = [spread * 2 - 1, spread * 2].filter(page => page >= 0 && page < count);
    return direction === 'rtl' ? pair.reverse() : pair;
  }
  if (mode === 'double') {
    const start = Math.floor(current / 2) * 2;
    const pair = [start, start + 1].filter(page => page < count);
    return direction === 'rtl' ? pair.reverse() : pair;
  }
  return [current];
}

export function steppedPage(mode, index, count, delta) {
  if (!count) return 0;
  if (mode === 'flip') {
    const spread = Math.min(Math.floor(count / 2), Math.max(0, spreadForPage(index) + delta));
    return Math.max(0, spread * 2 - 1);
  }
  if (mode === 'double') return Math.min(Math.floor((count - 1) / 2) * 2, Math.max(0, Math.floor(index / 2) * 2 + delta * 2));
  return cleanPage(index + delta, count);
}

export function seriesFields(series = '', volume = null) {
  const name = String(series).trim();
  if (name.length > 100) throw new Error('시리즈명은 100자 이하로 입력해 주세요.');
  const number = volume === '' || volume == null ? null : Number(volume);
  if (number !== null && (!Number.isInteger(number) || number < 1 || number > 9999)) throw new Error('권 번호는 1~9999 사이의 정수로 입력해 주세요.');
  if (number !== null && !name) throw new Error('권 번호와 함께 시리즈명을 입력해 주세요.');
  return { series: name, volume: number };
}

export function orderedVolumes(books, series) {
  return books.filter(book => !book.deletedAt && series && book.series === series).sort((a, b) =>
    (a.volume ?? Infinity) - (b.volume ?? Infinity) || a.title.localeCompare(b.title, 'ko', { numeric: true }) || a.createdAt - b.createdAt);
}
