const collator = new Intl.Collator('ko', { numeric: true, sensitivity: 'base' });
const normalizeText = text => text.normalize('NFC').trim().replace(/\s+/gu, ' ');

export function tagKey(tag) { return normalizeText(tag).toLocaleLowerCase('ko'); }

export function normalizeTags(value = []) {
  const values = typeof value === 'string' ? value.split(/[,，\r\n]+/u) : value;
  if (!Array.isArray(values)) throw new Error('태그는 쉼표로 구분해 입력해 주세요.');
  const tags = [], seen = new Set();
  for (const value of values) {
    if (typeof value !== 'string') throw new Error('태그는 글자로 입력해 주세요.');
    const tag = normalizeText(value);
    if (!tag) continue;
    if (tag.length > 40) throw new Error('태그 하나는 40자 이하로 입력해 주세요.');
    const key = tagKey(tag);
    if (!seen.has(key)) { seen.add(key); tags.push(tag); }
  }
  if (tags.length > 20) throw new Error('한 만화에 태그를 최대 20개까지 붙일 수 있습니다.');
  return tags;
}

export function collectionTags(books) {
  const options = new Map();
  for (const book of books) {
    for (const name of normalizeTags(book.tags ?? [])) {
      const key = tagKey(name), option = options.get(key);
      if (option) option.count++;
      else options.set(key, { key, name, count: 1 });
    }
  }
  return [...options.values()].sort((a, b) => collator.compare(a.name, b.name));
}

export function matchesCollection(book, { query = '', series = 'all', tags = [] } = {}) {
  const search = normalizeText(query).toLocaleLowerCase('ko');
  const searchable = normalizeText([book.title, book.series || '', book.volume ? book.volume + '권' : ''].join(' ')).toLocaleLowerCase('ko');
  if (!searchable.includes(search)) return false;
  if (series !== 'all' && !(series === 'standalone' ? !book.series : series === 'series:' + book.series)) return false;
  if (!tags.length) return true;
  const selected = new Set(tags.map(tagKey));
  return normalizeTags(book.tags ?? []).some(tag => selected.has(tagKey(tag)));
}
