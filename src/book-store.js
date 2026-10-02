import { maxSpreadForCount } from './geometry.js';
import { cleanMode, cleanPage, seriesFields } from './reading-state.js';
import { normalizeTags } from './collection-filter.js';

export const databaseName = 'paperflip-library-v1';

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error || new Error('저장을 완료하지 못했습니다.'));
    transaction.onerror = () => {}; // The abort event reports the final transaction result.
  });
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export class BookStore {
  constructor(factory = globalThis.indexedDB) { this.factory = factory; this.connection = null; }

  open() {
    if (this.connection) return this.connection;
    this.connection = new Promise((resolve, reject) => {
      if (!this.factory) { reject(new Error('이 브라우저에서는 컬렉션을 저장할 수 없습니다.')); return; }
      const request = this.factory.open(databaseName, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore('books', { keyPath: 'id' });
        const pages = db.createObjectStore('pages', { keyPath: ['bookId', 'order'] });
        pages.createIndex('bookId', 'bookId');
      };
      request.onblocked = () => reject(new Error('다른 Paperflip 창을 닫고 다시 시도해 주세요.'));
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => { db.close(); this.connection = null; };
        resolve(db);
      };
    }).catch(error => { this.connection = null; throw error; });
    return this.connection;
  }

  async listBooks() {
    const db = await this.open(), transaction = db.transaction('books', 'readonly');
    return requestResult(transaction.objectStore('books').getAll());
  }

  async getPages(bookId) {
    const db = await this.open(), transaction = db.transaction('pages', 'readonly');
    const pages = await requestResult(transaction.objectStore('pages').index('bookId').getAll(bookId));
    return pages.sort((a, b) => a.order - b.order);
  }

  async createBook({ title, direction = 'ltr', series = '', volume = null, tags = [], pages }) {
    const cleanTitle = title.trim();
    if (!cleanTitle || cleanTitle.length > 100 || !pages.length) throw new Error('제목과 이미지를 확인해 주세요.');
    if (pages.some(page => !(page.file instanceof Blob))) throw new Error('이미지 파일을 다시 추가해 주세요.');
    const id = crypto.randomUUID(), now = Date.now();
    const book = {
      id, title: cleanTitle, direction: direction === 'rtl' ? 'rtl' : 'ltr',
      ...seriesFields(series, volume), tags: normalizeTags(tags), viewMode: 'flip', pageIndex: 0,
      pageCount: pages.length, byteSize: pages.reduce((total, page) => total + page.file.size, 0),
      cover: pages[0].thumbnail, spread: 0, createdAt: now, updatedAt: now, lastReadAt: null, deletedAt: null
    };
    const db = await this.open(), transaction = db.transaction(['books', 'pages'], 'readwrite');
    const completion = transactionDone(transaction);
    transaction.objectStore('books').add(book);
    pages.forEach((page, order) => transaction.objectStore('pages').add({
      bookId: id, order, name: page.name, type: page.file.type, size: page.file.size,
      modified: page.file.lastModified || 0, width: page.width, height: page.height, file: page.file
    }));
    await completion;
    return book;
  }

  async updateBook(id, changes) {
    const tags = 'tags' in changes ? normalizeTags(changes.tags) : undefined;
    const db = await this.open(), transaction = db.transaction('books', 'readwrite');
    const completion = transactionDone(transaction), store = transaction.objectStore('books');
    let updated;
    const request = store.get(id);
    request.onsuccess = () => {
      const book = request.result;
      if (!book) { transaction.abort(); return; }
      updated = { ...book, updatedAt: Date.now() };
      if (typeof changes.title === 'string') {
        const title = changes.title.trim();
        if (!title || title.length > 100) { transaction.abort(); return; }
        updated.title = title;
      }
      if (changes.direction === 'ltr' || changes.direction === 'rtl') updated.direction = changes.direction;
      if (tags !== undefined) updated.tags = tags;
      if ('series' in changes || 'volume' in changes) {
        try { Object.assign(updated, seriesFields(changes.series ?? book.series ?? '', 'volume' in changes ? changes.volume : book.volume)); }
        catch (_) { transaction.abort(); return; }
      }
      if ('viewMode' in changes) updated.viewMode = cleanMode(changes.viewMode);
      if (Number.isInteger(changes.pageIndex)) updated.pageIndex = cleanPage(changes.pageIndex, book.pageCount);
      if (Number.isInteger(changes.spread)) updated.spread = Math.min(maxSpreadForCount(book.pageCount), Math.max(0, changes.spread));
      if ('lastReadAt' in changes) updated.lastReadAt = changes.lastReadAt;
      if ('deletedAt' in changes) updated.deletedAt = changes.deletedAt;
      store.put(updated);
    };
    await completion;
    return updated;
  }
}
