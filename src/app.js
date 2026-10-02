import { BookReader } from './book-reader.js';
import { BookStore } from './book-store.js';
import { requireAccess, lockLibrary } from './access.js';
import { extractArchive } from './archive.js';
import { cleanMode, pageFromBook, seriesFields, orderedVolumes } from './reading-state.js';
import { normalizeTags, collectionTags, matchesCollection } from './collection-filter.js';

await requireAccess();

const byId = id => document.getElementById(id);
const ui = {
  tabs: Array.from(document.querySelectorAll('[role="tab"]')), notice: byId('notice'),
  grid: byId('collection-grid'), summary: byId('library-summary'), count: byId('collection-count'),
  search: byId('collection-search'), sort: byId('collection-sort'), trash: byId('toggle-trash'),
  seriesFilter: byId('series-filter'), seriesNames: byId('series-names'),
  tagFilters: byId('tag-filters'), tagFilterEmpty: byId('tag-filter-empty'), clearTagFilters: byId('clear-tag-filters'),
  collectionEmpty: byId('collection-empty'), emptyTitle: byId('collection-empty-title'),
  emptyText: byId('collection-empty-text'), emptyAction: byId('collection-empty-action'),
  form: byId('book-form'), fields: byId('upload-fields'), input: byId('file-input'),
  title: byId('book-title'), bookDirection: byId('book-direction'), save: byId('save-book'),
  bookSeries: byId('book-series'), bookVolume: byId('book-volume'), bookTags: byId('book-tags'),
  choose: byId('choose-images'), draft: byId('draft-pages'), draftCount: byId('draft-count'),
  draftSize: byId('draft-size'), saveCount: byId('save-page-count'), clearDraft: byId('clear-draft'),
  sortPages: byId('sort-pages'), overlay: byId('drop-overlay'), readerTitle: byId('reader-title'),
  readerSubtitle: byId('reader-subtitle'), readerEmpty: byId('reader-empty'),
  readerContent: byId('reader-content'), canvas: byId('book-canvas'), stage: byId('book-stage'),
  direction: byId('direction'), meta: byId('book-meta'), previous: byId('previous'), next: byId('next'),
  status: byId('page-status'), readingSave: byId('reading-save'), zoom: byId('zoom'),
  fullscreen: byId('fullscreen'), zoomDialog: byId('zoom-dialog'), zoomPages: byId('zoom-pages'),
  flat: byId('page-viewer'), viewMode: byId('view-mode'), tip: byId('reading-tip'), exitFocus: byId('exit-reading-focus'),
  volumeNav: byId('volume-navigation'), volumeLabel: byId('volume-label'), previousVolume: byId('previous-volume'), nextVolume: byId('next-volume'),
  closeZoom: byId('close-zoom'), renameDialog: byId('rename-dialog'), renameForm: byId('rename-form'),
  renameInput: byId('rename-input'), editSeries: byId('edit-series'), editVolume: byId('edit-volume'), editTags: byId('edit-tags'), editError: byId('edit-error'), cancelRename: byId('cancel-rename'), saveRename: byId('save-rename')
};
const store = new BookStore();
byId('lock-library').addEventListener('click', () => lockLibrary().catch(error => showNotice(error.message, 'error')));
const collator = new Intl.Collator('ko', { numeric: true, sensitivity: 'base' });
const currentBookKey = 'paperflip-current-book-v1';
let books = [], draft = [], readerPages = [], coverUrls = [], selectedBook = null;
let currentTab = 'collection', showTrash = false, ready = false, importing = false, saving = false;
let opening = false, loadGeneration = 0, dragDepth = 0, renameId = null;
let progressWrite = Promise.resolve(), progressRevision = 0, viewer;
let draftArchive = false, focusActive = false;
const selectedTags = new Set();

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function actionButton(text, action, className = 'button') {
  const button = element('button', className, text);
  button.type = 'button'; button.dataset.action = action;
  return button;
}
function showNotice(text, tone = '') {
  ui.notice.textContent = text; ui.notice.dataset.tone = tone; ui.notice.hidden = !text;
  if (currentTab === 'viewer') requestAnimationFrame(() => viewer?.resize());
}
function errorText(error) {
  return error?.name === 'QuotaExceededError'
    ? '저장 공간이 부족해 만화를 저장하지 못했습니다. 이미지 수나 크기를 줄여 다시 시도해 주세요.'
    : error?.message || '작업을 완료하지 못했습니다. 다시 시도해 주세요.';
}
function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return Math.max(1, Math.round(bytes / 1024)) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}
function rememberBook(id) {
  try { if (id) localStorage.setItem(currentBookKey, id); else localStorage.removeItem(currentBookKey); } catch (_) {}
}
function rememberedBook() { try { return localStorage.getItem(currentBookKey); } catch (_) { return null; } }

function switchTab(name) {
  if (!['viewer', 'collection', 'upload'].includes(name)) return;
  if (ui.zoomDialog.open) ui.zoomDialog.close();
  if (name !== 'viewer' && focusActive) exitReadingFocus();
  currentTab = name; document.body.dataset.tab = name; showNotice('');
  ui.tabs.forEach(tab => {
    const active = tab.dataset.tab === name;
    tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1;
    byId('panel-' + tab.dataset.tab).hidden = !active;
  });
  if (!focusActive) window.scrollTo({ top: 0, behavior: 'instant' });
  if (name === 'collection') {
    progressWrite.then(refreshLibrary).catch(error => showNotice(errorText(error), 'error'));
  }
  if (name === 'viewer') {
    if (!selectedBook && ready) {
      const last = books.find(book => book.id === rememberedBook() && !book.deletedAt);
      if (last) { openBook(last.id); return; }
    }
    requestAnimationFrame(() => viewer.resize());
  }
}
ui.tabs.forEach((tab, index) => {
  tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  tab.addEventListener('keydown', event => {
    let target;
    if (event.key === 'ArrowRight') target = (index + 1) % ui.tabs.length;
    if (event.key === 'ArrowLeft') target = (index + ui.tabs.length - 1) % ui.tabs.length;
    if (event.key === 'Home') target = 0;
    if (event.key === 'End') target = ui.tabs.length - 1;
    if (target === undefined) return;
    event.preventDefault(); ui.tabs[target].focus(); switchTab(ui.tabs[target].dataset.tab);
  });
});
document.querySelectorAll('[data-go]').forEach(button => button.addEventListener('click', () => switchTab(button.dataset.go)));

async function refreshLibrary() {
  const loaded = await store.listBooks();
  books = loaded; ready = true;
  renderCollection(); renderDraft();
}
function renderTagFilters(source) {
  const options = collectionTags(source), available = new Set(options.map(option => option.key));
  for (const key of selectedTags) if (!available.has(key)) selectedTags.delete(key);
  // Keep the controls when only the query changes, so keyboard focus stays on the checkbox.
  const signature = JSON.stringify(options);
  if (ui.tagFilters.dataset.options !== signature) {
    const labels = options.map(({ key, name, count }) => {
      const label = element('label', 'tag-filter-option'), checkbox = element('input');
      checkbox.type = 'checkbox'; checkbox.value = key; checkbox.setAttribute('aria-label', name);
      const countLabel = element('span', 'tag-filter-count', count); countLabel.setAttribute('aria-hidden', 'true');
      label.append(checkbox, element('span', 'tag-filter-name', name), countLabel); return label;
    });
    ui.tagFilters.replaceChildren(...labels); ui.tagFilters.dataset.options = signature;
  }
  for (const checkbox of ui.tagFilters.querySelectorAll('input')) {
    checkbox.checked = selectedTags.has(checkbox.value);
    checkbox.closest('label').classList.toggle('is-selected', checkbox.checked);
  }
  ui.tagFilterEmpty.hidden = Boolean(options.length);
  ui.clearTagFilters.hidden = !selectedTags.size;
}
function renderCollection() {
  const activeBooks = books.filter(book => !book.deletedAt);
  const deletedBooks = books.filter(book => book.deletedAt);
  const query = ui.search.value.trim().toLocaleLowerCase('ko');
  const source = showTrash ? deletedBooks : activeBooks;
  renderTagFilters(source);
  const seriesCounts = new Map();
  for (const book of source) if (book.series) seriesCounts.set(book.series, (seriesCounts.get(book.series) || 0) + 1);
  const selectedSeries = ui.seriesFilter.value;
  ui.seriesFilter.replaceChildren(element('option', '', '전체 시리즈'), element('option', '', '단권 모아 보기'));
  ui.seriesFilter.options[0].value = 'all'; ui.seriesFilter.options[1].value = 'standalone';
  for (const [name, count] of [...seriesCounts].sort((a, b) => collator.compare(a[0], b[0]))) {
    const option = element('option', '', name + ' · ' + count + '권'); option.value = 'series:' + name; ui.seriesFilter.append(option);
  }
  ui.seriesFilter.value = [...ui.seriesFilter.options].some(option => option.value === selectedSeries) ? selectedSeries : 'all';
  const filter = ui.seriesFilter.value;
  const filtering = Boolean(query) || filter !== 'all' || Boolean(selectedTags.size);
  let visible = source.filter(book => matchesCollection(book, { query, series: filter, tags: [...selectedTags] }));
  ui.seriesNames.replaceChildren(...[...new Set(activeBooks.map(book => book.series).filter(Boolean))].sort(collator.compare).map(name => {
    const option = element('option'); option.value = name; return option;
  }));
  const order = ui.sort.value;
  visible.sort((a, b) => {
    const difference = order === 'title' ? 0 : order === 'read'
      ? (b.lastReadAt || 0) - (a.lastReadAt || 0) : b.createdAt - a.createdAt;
    return difference || collator.compare(a.title, b.title);
  });
  ui.count.textContent = activeBooks.length;
  ui.summary.textContent = (showTrash ? '휴지통 · ' : '') + (filtering ? visible.length + ' / ' + source.length + '권 표시'
    : source.length + '권 · ' + source.reduce((sum, book) => sum + book.pageCount, 0) + '쪽');
  ui.trash.textContent = showTrash ? '컬렉션으로 돌아가기' : '휴지통' + (deletedBooks.length ? ' (' + deletedBooks.length + ')' : '');
  ui.trash.setAttribute('aria-pressed', String(showTrash));
  const newUrls = [], fragment = document.createDocumentFragment(), groups = new Map();
  for (const book of visible) {
    const name = book.series || '';
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(book);
  }
  for (const [series, items] of groups) {
    if (series) items.sort((a, b) => (a.volume ?? Infinity) - (b.volume ?? Infinity) || collator.compare(a.title, b.title));
    const group = element('section', 'series-group'), heading = element('div', 'series-heading'), shelf = element('div', 'series-books');
    heading.append(element('h2', '', series || '단권 모음'), element('span', '', items.length + '권'));
    group.dataset.series = series; group.append(heading, shelf); fragment.append(group);
    for (const book of items) {
    const card = element('article', 'book-card'); card.dataset.bookId = book.id;
    const cover = actionButton('', showTrash ? 'restore' : 'read', 'book-cover');
    cover.setAttribute('aria-label', book.title + (showTrash ? ' 복원' : ' 읽기'));
    if (book.cover instanceof Blob) {
      const image = element('img'); const url = URL.createObjectURL(book.cover); newUrls.push(url);
      image.src = url; image.alt = book.title + ' 표지'; image.loading = 'lazy'; image.decoding = 'async';
      cover.append(image);
    } else cover.append(element('span', 'cover-placeholder', 'P'));
    card.append(cover);
    if (book.series) card.append(element('p', 'series-badge', book.series + (book.volume ? ' · ' + book.volume + '권' : ' · 권 번호 미지정')));
    card.append(element('h3', '', book.title), element('p', 'card-meta',
      book.pageCount + '쪽 · ' + (book.direction === 'rtl' ? '오른쪽부터 읽기' : '왼쪽부터 읽기')));
    const tags = normalizeTags(book.tags ?? []);
    if (tags.length) {
      const list = element('ul', 'book-tags'); list.setAttribute('aria-label', '태그');
      list.append(...tags.map(tag => element('li', 'tag-chip', tag))); card.append(list);
    }
    const readPage = book.lastReadAt ? pageFromBook(book) + 1 : 0;
    const progress = element('div', 'card-progress', showTrash ? '복원하면 다시 읽을 수 있어요'
      : readPage ? readPage + '쪽까지 읽음' : '아직 펼치지 않은 이야기');
    const bar = element('progress'); bar.max = book.pageCount; bar.value = readPage;
    bar.setAttribute('aria-label', book.title + ' 읽은 페이지'); progress.append(bar); card.append(progress);
    const actions = element('div', 'card-actions');
    if (showTrash) actions.append(actionButton('컬렉션으로 복원', 'restore', 'button button-primary'));
    else {
      actions.append(actionButton(book.lastReadAt ? '이어 읽기' : '읽기', 'read', 'button button-primary'),
        actionButton('정보·태그 편집', 'rename', 'text-button'), actionButton('휴지통', 'trash', 'text-button'));
      actions.lastChild.setAttribute('aria-label', book.title + ' 휴지통으로 이동');
    }
    card.append(actions); shelf.append(card);
    }
  }
  ui.grid.replaceChildren(fragment);
  coverUrls.forEach(url => URL.revokeObjectURL(url)); coverUrls = newUrls;
  ui.collectionEmpty.hidden = Boolean(visible.length);
  ui.emptyAction.hidden = showTrash || filtering;
  ui.emptyTitle.textContent = filtering ? '찾는 만화가 없어요' : showTrash ? '휴지통이 비어 있어요' : '나만의 첫 번째 만화책';
  ui.emptyText.textContent = filtering ? '검색어, 시리즈 또는 체크한 태그를 바꿔 보세요.' : showTrash ? '휴지통으로 옮긴 만화는 여기에서 복원할 수 있습니다.'
    : '파일추가에서 이미지나 ZIP·CBZ를 한 권으로 저장해 보세요.';
  refreshVolumeNavigation();
}
ui.search.addEventListener('input', renderCollection);
ui.sort.addEventListener('change', renderCollection);
ui.seriesFilter.addEventListener('change', renderCollection);
ui.tagFilters.addEventListener('change', event => {
  const checkbox = event.target.closest('input[type="checkbox"]');
  if (!checkbox) return;
  if (checkbox.checked) selectedTags.add(checkbox.value); else selectedTags.delete(checkbox.value);
  renderCollection();
});
ui.clearTagFilters.addEventListener('click', () => { selectedTags.clear(); renderCollection(); });
ui.trash.addEventListener('click', () => { showTrash = !showTrash; ui.search.value = ''; selectedTags.clear(); renderCollection(); });

ui.grid.addEventListener('click', async event => {
  const button = event.target.closest('button[data-action]'), card = button?.closest('[data-book-id]');
  if (!card || opening) return;
  const book = books.find(item => item.id === card.dataset.bookId);
  if (!book) return;
  if (button.dataset.action === 'read') { openBook(book.id); return; }
  if (button.dataset.action === 'rename') {
    renameId = book.id; ui.renameInput.value = book.title; ui.editSeries.value = book.series || ''; ui.editVolume.value = book.volume ?? '';
    ui.editTags.value = normalizeTags(book.tags ?? []).join(', ');
    ui.editError.hidden = true; ui.renameDialog.showModal(); ui.renameInput.focus(); return;
  }
  button.disabled = true;
  try {
    const restoring = button.dataset.action === 'restore';
    await store.updateBook(book.id, { deletedAt: restoring ? null : Date.now() });
    if (!restoring && selectedBook?.id === book.id) clearReader();
    await refreshLibrary();
    showNotice(restoring ? '「' + book.title + '」을 컬렉션으로 복원했습니다.'
      : '「' + book.title + '」을 휴지통으로 옮겼습니다. 휴지통에서 다시 복원할 수 있어요.');
  } catch (error) { button.disabled = false; showNotice(errorText(error), 'error'); }
});
ui.cancelRename.addEventListener('click', () => ui.renameDialog.close());
ui.renameForm.addEventListener('submit', async event => {
  event.preventDefault();
  const title = ui.renameInput.value.trim();
  if (!title) { ui.renameInput.setCustomValidity('만화 제목을 입력해 주세요.'); ui.renameInput.reportValidity(); return; }
  ui.saveRename.disabled = true;
  try {
    const changes = { title, ...seriesFields(ui.editSeries.value, ui.editVolume.value), tags: normalizeTags(ui.editTags.value) };
    await store.updateBook(renameId, changes);
    if (selectedBook?.id === renameId) { Object.assign(selectedBook, changes); ui.readerTitle.textContent = title; }
    ui.renameDialog.close(); await refreshLibrary(); showNotice('만화 정보와 태그를 저장했습니다.');
  } catch (error) { ui.editError.textContent = errorText(error); ui.editError.hidden = false; }
  finally { ui.saveRename.disabled = false; }
});
ui.renameInput.addEventListener('input', () => ui.renameInput.setCustomValidity(''));

async function imageFromBlob(blob) {
  const url = URL.createObjectURL(blob), image = new Image(); image.decoding = 'async';
  try {
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error('이미지를 읽지 못했습니다.')); image.src = url; });
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('이미지 크기를 읽지 못했습니다.');
    return { image, url };
  } catch (error) { URL.revokeObjectURL(url); throw error; }
}
function releasePage(page) { page.image.src = ''; URL.revokeObjectURL(page.url); }
async function prepareDraftPage(file) {
  const decoded = await imageFromBlob(file);
  try {
    const width = decoded.image.naturalWidth, height = decoded.image.naturalHeight;
    const scale = Math.min(1, 224 / width, 300 / height);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale)); canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fffefa'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(decoded.image, 0, 0, canvas.width, canvas.height);
    const thumbnail = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', .85));
    if (!thumbnail) throw new Error('미리보기를 만들지 못했습니다.');
    return { id: crypto.randomUUID(), file, name: file.name, width, height, thumbnail, preview: URL.createObjectURL(thumbnail) };
  } finally { releasePage(decoded); }
}
function isImage(file) { return /^image\//i.test(file.type) || /\.(jpe?g|png|webp|gif|avif|bmp)$/i.test(file.name); }

async function addFiles(fileList) {
  if (importing || saving) { showNotice('진행 중인 작업이 끝난 뒤 파일을 추가해 주세요.'); return; }
  const all = Array.from(fileList), archives = all.filter(file => /\.(zip|cbz)$/i.test(file.name));
  if (archives.length && (archives.length !== 1 || all.length !== 1)) { showNotice('ZIP·CBZ는 한 번에 한 권씩 추가해 주세요. 이미지와 압축 파일은 따로 선택해 주세요.', 'error'); return; }
  if (archives.length && draft.length || !archives.length && draftArchive) {
    showNotice('압축 파일 한 개를 한 권으로 저장합니다. 현재 준비 목록을 저장하거나 비운 뒤 다음 파일을 추가해 주세요.', 'error'); return;
  }
  let files = all.filter(isImage).sort((a, b) => collator.compare(a.name, b.name));
  if (!files.length && !archives.length) { showNotice('이미지 또는 ZIP·CBZ 파일을 추가해 주세요.', 'error'); return; }
  switchTab('upload'); importing = true; renderDraft(); showNotice('');
  const loaded = [], failed = [];
  try {
    if (archives.length) files = await extractArchive(archives[0], (current, total) => {
      ui.draftCount.textContent = '압축 해제 ' + current + ' / ' + total + '쪽…';
    });
    for (let i = 0; i < files.length; i += 4) {
      ui.draftCount.textContent = '이미지 ' + i + ' / ' + files.length + '개 확인 중…';
      const results = await Promise.allSettled(files.slice(i, i + 4).map(prepareDraftPage));
      results.forEach((result, index) => result.status === 'fulfilled' ? loaded.push(result.value) : failed.push(files[i + index].name));
    }
    const combined = new Map(draft.map(page => [page.name, page]));
    for (const page of loaded) {
      const replaced = combined.get(page.name);
      if (replaced) URL.revokeObjectURL(replaced.preview);
      combined.set(page.name, page);
    }
    draft = Array.from(combined.values()).sort((a, b) => collator.compare(a.name, b.name));
    if (archives.length && loaded.length) {
      draftArchive = true;
      if (!ui.title.value.trim()) ui.title.value = archives[0].name.replace(/\.(zip|cbz)$/i, '').slice(0, 100);
      showNotice('압축 파일에서 ' + loaded.length + '쪽을 불러왔습니다. 제목과 시리즈를 확인하고 컬렉션에 저장해 주세요.');
    }
    if (failed.length || !archives.length && all.length !== files.length) {
      showNotice((failed.length ? failed.length + '개 이미지를 읽지 못해 제외했습니다: ' + failed.slice(0, 3).join(', ') + '. ' : '')
        + (!archives.length && all.length !== files.length ? '이미지가 아닌 파일은 제외했습니다.' : ''), 'error');
    }
  } catch (error) {
    loaded.forEach(page => URL.revokeObjectURL(page.preview)); showNotice(errorText(error), 'error');
  } finally { importing = false; renderDraft(); }
}
function renderDraft() {
  ui.fields.disabled = importing || saving;
  ui.save.disabled = !ready || !draft.length || !ui.title.value.trim() || importing || saving;
  ui.save.textContent = saving ? '컬렉션에 저장 중…' : '컬렉션에 저장';
  ui.clearDraft.disabled = !draft.length; ui.sortPages.disabled = draft.length < 2;
  ui.draftCount.textContent = '추가한 이미지 ' + draft.length + '개';
  ui.draftSize.textContent = draft.length ? formatBytes(draft.reduce((sum, page) => sum + page.file.size, 0)) + ' · 첫 번째 이미지가 표지'
    : '첫 번째 이미지가 표지가 됩니다.';
  ui.saveCount.textContent = draft.length + '쪽';
  const fragment = document.createDocumentFragment();
  draft.forEach((page, index) => {
    const item = element('li', 'draft-page'); item.dataset.pageId = page.id;
    const image = element('img'); image.src = page.preview; image.alt = page.name + ' 미리보기'; image.loading = 'lazy';
    const info = element('div', 'draft-page-info');
    info.append(element('strong', '', page.name), element('span', '', page.width + ' × ' + page.height + ' · ' + formatBytes(page.file.size)));
    const actions = element('div', 'page-actions');
    for (const [label, action, name, disabled] of [
      ['↑', 'up', ' 앞쪽으로 이동', index === 0], ['↓', 'down', ' 뒤쪽으로 이동', index === draft.length - 1], ['×', 'remove', ' 제외', false]
    ]) {
      const button = actionButton(label, action, '');
      button.setAttribute('aria-label', page.name + name); button.disabled = disabled; actions.append(button);
    }
    item.append(element('span', 'page-order', index + 1), image, info, actions); fragment.append(item);
  });
  ui.draft.replaceChildren(fragment);
}
ui.choose.addEventListener('click', () => ui.input.click());
ui.input.addEventListener('change', () => { if (ui.input.files.length) addFiles(ui.input.files); ui.input.value = ''; });
ui.title.addEventListener('input', () => {
  ui.title.setCustomValidity('');
  ui.save.disabled = !ready || !draft.length || !ui.title.value.trim() || importing || saving;
});
ui.sortPages.addEventListener('click', () => { draft.sort((a, b) => collator.compare(a.name, b.name)); renderDraft(); });
function clearDraft() {
  draft.forEach(page => URL.revokeObjectURL(page.preview)); draft = []; draftArchive = false;
  ui.title.value = ''; ui.bookDirection.value = 'ltr'; ui.bookSeries.value = ''; ui.bookVolume.value = ''; ui.bookTags.value = ''; renderDraft();
}
ui.clearDraft.addEventListener('click', clearDraft);
ui.draft.addEventListener('click', event => {
  const button = event.target.closest('button[data-action]'), item = button?.closest('[data-page-id]');
  if (!item || importing || saving) return;
  const index = draft.findIndex(page => page.id === item.dataset.pageId);
  if (index < 0) return;
  if (button.dataset.action === 'remove') { URL.revokeObjectURL(draft[index].preview); draft.splice(index, 1); }
  else {
    const target = index + (button.dataset.action === 'up' ? -1 : 1);
    if (target < 0 || target >= draft.length) return;
    [draft[index], draft[target]] = [draft[target], draft[index]];
  }
  if (!draft.length) draftArchive = false;
  renderDraft();
});
ui.form.addEventListener('submit', async event => {
  event.preventDefault();
  if (saving || importing || !ready || !draft.length) return;
  const title = ui.title.value.trim();
  if (!title) { ui.title.setCustomValidity('만화 제목을 입력해 주세요.'); ui.title.reportValidity(); return; }
  saving = true; renderDraft(); showNotice('');
  try {
    await store.createBook({ title, direction: ui.bookDirection.value, ...seriesFields(ui.bookSeries.value, ui.bookVolume.value), tags: normalizeTags(ui.bookTags.value), pages: draft });
    clearDraft(); showTrash = false; ui.search.value = ''; ui.seriesFilter.value = 'all'; selectedTags.clear();
    await refreshLibrary(); switchTab('collection');
    showNotice('「' + title + '」을 저장했습니다. 컬렉션에서 선택해 읽어 보세요.');
  } catch (error) { showNotice(errorText(error), 'error'); }
  finally { saving = false; renderDraft(); }
});

function updateReader(state) {
  ui.status.textContent = state.visibleIndices.length ? state.visibleIndices.map(index => index + 1).join('–') + ' / ' + state.count + '쪽' : '이미지 없음';
  ui.previous.disabled = opening || state.busy || state.turning || !state.canPrevious;
  ui.next.disabled = opening || state.busy || state.turning || !state.canNext;
  ui.direction.disabled = opening || state.busy || state.turning;
  ui.viewMode.disabled = opening || state.busy || state.turning;
  ui.zoom.disabled = opening || state.busy || state.turning || !state.count;
  ui.fullscreen.disabled = opening || state.busy || !state.count;
  refreshVolumeNavigation();
  if (!opening && selectedBook && state.count && !state.busy && !state.turning) saveReadingState(state);
}
function saveReadingState(state) {
  if (pageFromBook(selectedBook) === state.pageIndex && selectedBook.direction === state.direction && cleanMode(selectedBook.viewMode) === state.mode && selectedBook.lastReadAt) return;
  const id = selectedBook.id, snapshot = { spread: state.spread, pageIndex: state.pageIndex, viewMode: state.mode, direction: state.direction, lastReadAt: Date.now() };
  Object.assign(selectedBook, snapshot);
  const listed = books.find(book => book.id === id);
  if (listed) Object.assign(listed, snapshot);
  const revision = ++progressRevision; ui.readingSave.textContent = '읽던 위치 저장 중…';
  progressWrite = progressWrite.catch(() => {}).then(() => store.updateBook(id, snapshot)).then(() => {
    if (selectedBook?.id === id && revision === progressRevision) ui.readingSave.textContent = '읽던 위치 저장됨';
  }).catch(error => {
    if (selectedBook?.id === id && revision === progressRevision) ui.readingSave.textContent = '읽던 위치 저장 실패';
    showNotice(errorText(error), 'error');
  });
}
viewer = new BookReader(ui.canvas, ui.flat, {
  onChange: updateReader,
  getAvailableHeight: () => {
    const documentTop = ui.stage.getBoundingClientRect().top + window.scrollY;
    return focusActive ? window.innerHeight - 64 : window.innerHeight - documentTop - 145;
  }
});
function clearReader() {
  if (focusActive) exitReadingFocus();
  ++loadGeneration; selectedBook = null; rememberBook(null);
  viewer.setPages([]); readerPages.forEach(releasePage); readerPages = [];
  ui.readerContent.hidden = true; ui.readerEmpty.hidden = false;
  ui.readerTitle.textContent = '읽을 만화를 골라 주세요';
  ui.readerSubtitle.textContent = '컬렉션에 저장한 책을 여기에서 펼쳐 읽습니다.';
  document.body.classList.remove('has-book');
  refreshVolumeNavigation();
}
async function openBook(id) {
  if (opening) return;
  const book = selectedBook?.id === id ? selectedBook : books.find(item => item.id === id && !item.deletedAt);
  if (!book) return;
  opening = true; const generation = ++loadGeneration, loaded = [];
  viewer.setBusy(true); showNotice('「' + book.title + '」을 펼치는 중…');
  try {
    const pages = await store.getPages(id);
    if (pages.length !== book.pageCount) throw new Error('저장한 페이지를 모두 불러오지 못했습니다.');
    for (let index = 0; index < pages.length; index += 4) {
      const results = await Promise.allSettled(pages.slice(index, index + 4).map(async page => ({ ...page, ...await imageFromBlob(page.file) })));
      let failure;
      for (const result of results) {
        if (result.status === 'fulfilled') loaded.push(result.value); else failure = result.reason;
      }
      if (failure) throw failure;
      if (generation !== loadGeneration) { loaded.forEach(releasePage); return; }
    }
    if (ui.zoomDialog.open) ui.zoomDialog.close();
    const oldPages = readerPages; readerPages = loaded; selectedBook = { ...book };
    oldPages.forEach(releasePage);
    ui.readerContent.hidden = false; ui.readerEmpty.hidden = true;
    ui.readerTitle.textContent = book.title; ui.readerSubtitle.textContent = '';
    ui.meta.textContent = book.pageCount + '쪽'; ui.direction.value = book.direction;
    ui.viewMode.value = cleanMode(book.viewMode); updateReadingTip();
    ui.readingSave.textContent = '읽던 위치 저장됨';
    document.body.classList.add('has-book');
    viewer.setDirection(book.direction); viewer.setPages(readerPages, pageFromBook(book), cleanMode(book.viewMode));
    rememberBook(id); switchTab('viewer');
  } catch (error) { loaded.forEach(releasePage); showNotice(errorText(error), 'error'); }
  finally { opening = false; viewer.setBusy(false); }
}
ui.previous.addEventListener('click', () => viewer.turnPage(-1));
ui.next.addEventListener('click', () => viewer.turnPage(1));
ui.direction.addEventListener('change', () => viewer.setDirection(ui.direction.value));
ui.viewMode.addEventListener('change', () => { viewer.setMode(ui.viewMode.value); updateReadingTip(); });

function updateReadingTip() {
  ui.tip.textContent = ui.viewMode.value === 'flip'
    ? '바깥 모서리를 잡아 반대편으로 당겨 보세요. ← → 방향키로도 넘길 수 있습니다.'
    : ui.viewMode.value === 'scroll' ? '아래로 스크롤해 읽으세요. 방향키로 이전·다음 페이지에 이동합니다.'
      : '이전·다음 버튼 또는 ← → 방향키로 페이지를 넘기세요.';
}
function refreshVolumeNavigation() {
  const volumes = orderedVolumes(books, selectedBook?.series), index = volumes.findIndex(book => book.id === selectedBook?.id);
  ui.volumeNav.hidden = !selectedBook?.series || index < 0;
  ui.volumeLabel.textContent = selectedBook?.series ? selectedBook.series + (selectedBook.volume ? ' · ' + selectedBook.volume + '권' : '') + ' · 총 ' + volumes.length + '권' : '';
  ui.previousVolume.disabled = opening || index <= 0; ui.nextVolume.disabled = opening || index < 0 || index >= volumes.length - 1;
}
function openAdjacentVolume(delta) {
  const volumes = orderedVolumes(books, selectedBook?.series), index = volumes.findIndex(book => book.id === selectedBook?.id);
  if (index >= 0 && volumes[index + delta]) openBook(volumes[index + delta].id);
}
ui.previousVolume.addEventListener('click', () => openAdjacentVolume(-1));
ui.nextVolume.addEventListener('click', () => openAdjacentVolume(1));

function openZoom() {
  if (!selectedBook || opening || viewer.turn || focusActive) return;
  ui.zoomPages.replaceChildren();
  for (const index of viewer.visibleIndices) {
    const page = readerPages[index], figure = element('figure'), image = element('img');
    image.src = page.url; image.alt = index + 1 + '쪽, ' + page.name;
    image.width = page.image.naturalWidth; image.height = page.image.naturalHeight;
    figure.append(element('figcaption', '', index + 1 + '쪽 · ' + page.name), image); ui.zoomPages.append(figure);
  }
  ui.zoomDialog.showModal(); ui.zoomDialog.scrollTop = 0;
}
ui.zoom.addEventListener('click', openZoom);
ui.stage.addEventListener('book:zoom', openZoom);
ui.closeZoom.addEventListener('click', () => ui.zoomDialog.close());
ui.zoomDialog.addEventListener('close', () => ui.zoomPages.replaceChildren());
function setReadingFocus(active) {
  focusActive = active; ui.stage.classList.toggle('reading-focus', active); document.body.classList.toggle('reader-focus', active);
  ui.fullscreen.textContent = active ? '전체화면 종료' : '책만 전체화면';
  viewer.resize();
}
async function exitReadingFocus() {
  setReadingFocus(false);
  if (document.fullscreenElement === ui.stage) await document.exitFullscreen().catch(() => {});
  viewer.resize(); ui.fullscreen.focus({ preventScroll: true });
}
ui.fullscreen.addEventListener('click', async () => {
  if (!selectedBook || opening) return;
  if (focusActive) { exitReadingFocus(); return; }
  setReadingFocus(true);
  // Embedded browsers may disallow native fullscreen. The same book-only layout
  // still fills their viewport and can always be closed with the button or Esc.
  if (document.fullscreenEnabled && ui.stage.requestFullscreen) {
    try { await ui.stage.requestFullscreen(); } catch (_) {}
  }
  viewer.resize(); (viewer.mode === 'flip' ? ui.canvas : ui.flat).focus({ preventScroll: true });
});
ui.exitFocus.addEventListener('click', exitReadingFocus);
document.addEventListener('fullscreenchange', () => {
  if (document.fullscreenElement === ui.stage) setReadingFocus(true);
  else if (focusActive) setReadingFocus(false);
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && focusActive) { event.preventDefault(); exitReadingFocus(); return; }
  if (currentTab !== 'viewer' || ui.zoomDialog.open || ui.renameDialog.open || opening ||
    event.target.closest?.('[role="tab"]') || ['INPUT', 'SELECT', 'TEXTAREA'].includes(event.target.tagName) || event.target.isContentEditable ||
    event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    viewer.turnPage((event.key === 'ArrowRight' ? 1 : -1) * (viewer.direction === 'ltr' ? 1 : -1)); event.preventDefault();
  }
  if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown'].includes(event.key)) {
    viewer.turnPage(['ArrowDown', 'PageDown'].includes(event.key) ? 1 : -1); event.preventDefault();
  }
  if (event.key === 'Escape' && viewer.turn?.pointerId != null) viewer.cancelTurn();
});
const fileDrag = event => Array.from(event.dataTransfer?.types || []).includes('Files');
window.addEventListener('dragenter', event => { if (fileDrag(event)) { event.preventDefault(); dragDepth++; ui.overlay.hidden = false; } });
window.addEventListener('dragover', event => { if (fileDrag(event)) event.preventDefault(); });
window.addEventListener('dragleave', event => { if (fileDrag(event)) { event.preventDefault(); dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) ui.overlay.hidden = true; } });
window.addEventListener('drop', event => {
  if (!fileDrag(event)) return;
  event.preventDefault(); dragDepth = 0; ui.overlay.hidden = true;
  if (event.dataTransfer.files.length) addFiles(event.dataTransfer.files);
});
window.addEventListener('blur', () => { dragDepth = 0; ui.overlay.hidden = true; });

document.body.dataset.tab = currentTab;
refreshLibrary().catch(error => {
  showNotice('컬렉션을 열지 못했습니다. ' + errorText(error), 'error');
  ui.summary.textContent = '컬렉션을 불러오지 못했습니다.';
});
renderDraft(); updateReader(viewer.state);
