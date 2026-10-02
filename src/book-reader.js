import { FlipBook } from './flip-book.js';
import { cleanMode, cleanPage, spreadForPage, steppedPage, visiblePages } from './reading-state.js';

export class BookReader {
  constructor(canvas, flat, { onChange = () => {}, getAvailableHeight } = {}) {
    this.canvas = canvas; this.flat = flat; this.onChange = onChange;
    this.pages = []; this.mode = 'flip'; this.direction = 'ltr'; this.pageIndex = 0;
    this.busy = false; this.suspended = true; this.scrollFrame = 0;
    this.getAvailableHeight = getAvailableHeight;
    this.flip = new FlipBook(canvas, {
      getAvailableHeight,
      getPageLimits: () => canvas.parentElement.classList.contains('reading-focus') ? { height: Infinity, width: Infinity, padding: 24 } : { height: 740, width: 560, padding: 48 },
      onChange: state => {
        if (this.mode !== 'flip' || this.suspended) return;
        this.pageIndex = state.visibleIndices[0] ?? 0; this.changed();
      }
    });
    this.suspended = false;
    flat.addEventListener('scroll', () => {
      if (this.mode !== 'scroll' || this.scrollFrame) return;
      this.scrollFrame = requestAnimationFrame(() => { this.scrollFrame = 0; this.readScrollPosition(); });
    });
    flat.addEventListener('dblclick', () => flat.dispatchEvent(new CustomEvent('book:zoom', { bubbles: true })));
    window.addEventListener('resize', () => this.resize());
  }

  get visibleIndices() { return visiblePages(this.mode, this.pageIndex, this.pages.length, this.direction).sort((a, b) => a - b); }
  get turn() { return this.mode === 'flip' ? this.flip.turn : null; }
  get state() {
    const count = this.pages.length;
    return {
      count, pageIndex: this.pageIndex, spread: spreadForPage(this.pageIndex), direction: this.direction, mode: this.mode,
      visibleIndices: this.visibleIndices, busy: this.busy, turning: Boolean(this.turn),
      canPrevious: count > 0 && steppedPage(this.mode, this.pageIndex, count, -1) !== this.pageIndex,
      canNext: count > 0 && steppedPage(this.mode, this.pageIndex, count, 1) !== this.pageIndex
    };
  }
  changed() { if (!this.suspended) this.onChange(this.state); }
  setBusy(busy) { this.busy = Boolean(busy); this.flip.setBusy(busy); this.changed(); }
  setPages(pages, pageIndex = 0, mode = this.mode) {
    this.suspended = true;
    this.pages = pages; this.mode = cleanMode(mode); this.pageIndex = cleanPage(pageIndex, pages.length);
    if (this.mode === 'double') this.pageIndex = Math.floor(this.pageIndex / 2) * 2;
    this.flip.setPages(pages, spreadForPage(this.pageIndex));
    this.render(); this.suspended = false; this.changed();
  }
  setMode(mode) {
    if (cleanMode(mode) === this.mode) return;
    this.flip.cancelTurn(); this.setPages(this.pages, this.pageIndex, mode);
  }
  setDirection(direction) {
    this.direction = direction === 'rtl' ? 'rtl' : 'ltr';
    this.suspended = true; this.flip.setDirection(this.direction);
    if (this.mode === 'double') this.render();
    this.suspended = false; this.changed();
  }
  makeFigure(index) {
    const page = this.pages[index], figure = document.createElement('figure'), image = document.createElement('img');
    figure.className = 'reader-page'; figure.dataset.pageIndex = index;
    image.src = page.url; image.alt = `${index + 1}쪽 · ${page.name}`; image.decoding = 'async';
    image.width = page.image.naturalWidth; image.height = page.image.naturalHeight;
    if (this.mode === 'scroll') image.loading = 'lazy';
    const caption = document.createElement('figcaption'); caption.textContent = `${index + 1} / ${this.pages.length}쪽`;
    figure.append(image, caption); return figure;
  }
  render() {
    cancelAnimationFrame(this.scrollFrame); this.scrollFrame = 0;
    this.canvas.hidden = this.mode !== 'flip'; this.flat.hidden = this.mode === 'flip'; this.flat.dataset.mode = this.mode;
    this.flat.replaceChildren(); this.figures = [];
    if (this.mode === 'flip') {
      this.flip.spread = spreadForPage(this.pageIndex); this.flip.resize();
      this.pageIndex = this.flip.visibleIndices[0] ?? 0;
    } else {
      const indices = this.mode === 'scroll' ? this.pages.map((_, index) => index) : visiblePages(this.mode, this.pageIndex, this.pages.length, this.direction);
      this.figures = indices.map(index => this.makeFigure(index)); this.flat.append(...this.figures);
      this.resize();
      if (this.mode === 'scroll') this.alignScroll();
    }
  }
  resize() {
    if (this.mode === 'flip') { this.flip.resize(); return; }
    this.flat.style.setProperty('--page-height', Math.max(140, this.getAvailableHeight() - 35) + 'px');
    if (this.mode === 'scroll') this.alignScroll();
  }
  alignScroll() {
    const figure = this.figures?.[this.pageIndex];
    if (figure) this.flat.scrollTo({ top: figure.offsetTop, behavior: 'instant' });
  }
  readScrollPosition() {
    if (this.mode !== 'scroll' || this.busy || !this.figures?.length || this.flat.hidden) return;
    const line = this.flat.scrollTop + Math.min(120, this.flat.clientHeight * .2);
    let low = 0, high = this.figures.length - 1;
    while (low < high) {
      const middle = (low + high) >> 1, figure = this.figures[middle];
      if (figure.offsetTop + figure.offsetHeight <= line) low = middle + 1; else high = middle;
    }
    if (this.pageIndex !== low) { this.pageIndex = low; this.changed(); }
  }
  turnPage(delta) {
    if (this.busy || this.turn || !this.pages.length) return;
    if (this.mode === 'flip') { this.flip.turnPage(delta); return; }
    const next = steppedPage(this.mode, this.pageIndex, this.pages.length, delta);
    if (next === this.pageIndex) return;
    this.pageIndex = next;
    if (this.mode === 'scroll') this.alignScroll(); else this.render();
    this.changed();
  }
  cancelTurn() { this.flip.cancelTurn(); this.flip.draw(); this.changed(); }
}
