import { clamp, pairForSpread, maxSpreadForCount, constrainCorner, foldGeometry } from './geometry.js';

const rgba = (rgb, opacity) => `rgba(${rgb.join(',')},${opacity})`;

export class FlipBook {
  constructor(canvas, { onChange = () => {}, getAvailableHeight = () => window.innerHeight - 290, getPageLimits = () => ({ height: 740, width: 560, padding: 48 }) } = {}) {
    this.canvas = canvas;
    this.context = canvas.getContext('2d');
    this.onChange = onChange;
    this.getAvailableHeight = getAvailableHeight;
    this.getPageLimits = getPageLimits;
    this.pages = [];
    this.direction = 'ltr';
    this.spread = 0;
    this.busy = false;
    this.turn = null;
    this.animation = 0;
    this.ratio = 1.4;
    this.geometry = { width: 0, height: 0, pageWidth: 0, pageHeight: 0, top: 20, center: 0 };
    this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    this.colors = { paper: '#fffefa', edge: '#dedbd1', shadow: [23, 36, 27] };
    this.attachEvents();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement);
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  get maximumSpread() { return maxSpreadForCount(this.pages.length); }
  get visibleIndices() {
    return pairForSpread(this.spread, this.direction).filter(i => i >= 0 && i < this.pages.length).sort((a, b) => a - b);
  }
  get state() {
    return { count: this.pages.length, spread: this.spread, direction: this.direction, turning: Boolean(this.turn), busy: this.busy, visibleIndices: this.visibleIndices };
  }
  canTurn(direction) {
    return this.pages.length > 0 && !this.busy && (direction > 0 ? this.spread < this.maximumSpread : this.spread > 0);
  }
  setBusy(busy) { this.busy = Boolean(busy); this.cancelTurn(); this.draw(); this.changed(); }
  setDirection(direction) {
    this.cancelTurn(); this.direction = direction === 'rtl' ? 'rtl' : 'ltr'; this.draw(); this.changed();
  }
  setPages(pages, spread = 0) {
    this.cancelTurn(); this.pages = pages;
    this.spread = clamp(spread, 0, this.maximumSpread);
    const ratios = pages.map(page => page.image.naturalHeight / page.image.naturalWidth).filter(Number.isFinite).sort((a, b) => a - b);
    this.ratio = ratios.length ? clamp(ratios[Math.floor(ratios.length / 2)], 1, 1.8) : 1.4;
    this.resize();
  }
  changed() {
    const visible = this.visibleIndices;
    const label = visible.length ? visible.map(i => i + 1).join('–') : '비어 있음';
    this.canvas.setAttribute('aria-label', `책 ${label}, 전체 ${this.pages.length}쪽. 바깥쪽 모서리를 드래그하거나 이전 장과 다음 장 버튼으로 넘기세요.`);
    this.onChange(this.state);
  }
  cancelTurn() {
    cancelAnimationFrame(this.animation); this.animation = 0;
    const pointerId = this.turn?.pointerId;
    this.turn = null;
    if (pointerId != null && this.canvas.hasPointerCapture(pointerId)) this.canvas.releasePointerCapture(pointerId);
    this.canvas.style.cursor = 'grab';
  }
  resize() {
    const width = Math.max(1, this.canvas.parentElement.clientWidth);
    const limits = this.getPageLimits?.() || { height: 740, width: 560, padding: 48 };
    const availableHeight = Math.max(140, Math.min(limits.height, this.getAvailableHeight()));
    const pageWidth = Math.max(1, Math.min((width - limits.padding) / 2, availableHeight / this.ratio, limits.width));
    const pageHeight = pageWidth * this.ratio;
    const height = pageHeight + 52, dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
    // Observing the stage also reports height changes caused by our own canvas.
    // Keep the current fold when that notification doesn't change its dimensions.
    const sameSize = Math.abs(this.geometry.width - width) < 1 && Math.abs(this.geometry.height - height) < 1
      && Math.abs(this.geometry.pageWidth - pageWidth) < .5 && this.canvas.width === Math.ceil(width * dpr);
    if (sameSize) { this.draw(); this.changed(); return; }
    this.cancelTurn();
    this.geometry = { width, height, pageWidth, pageHeight, top: 20, center: width / 2 };
    this.canvas.width = Math.ceil(width * dpr); this.canvas.height = Math.ceil(height * dpr);
    this.canvas.style.height = `${height}px`;
    this.context.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.draw(); this.changed();
  }
  drawPage(index, x, y, width, height) {
    const ctx = this.context;
    ctx.fillStyle = this.colors.paper; ctx.fillRect(x, y, width, height);
    const image = this.pages[index]?.image;
    if (!image || !image.naturalWidth || !image.naturalHeight) return;
    const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight);
    const w = image.naturalWidth * scale, h = image.naturalHeight * scale;
    ctx.drawImage(image, x + (width - w) / 2, y + (height - h) / 2, w, h);
  }
  trace(polygon) {
    const ctx = this.context;
    ctx.beginPath();
    if (!polygon.length) return;
    ctx.moveTo(polygon[0].x, polygon[0].y);
    polygon.slice(1).forEach(point => ctx.lineTo(point.x, point.y));
    ctx.closePath();
  }
  normalizedPage(index, flip) {
    const ctx = this.context, { pageWidth, pageHeight } = this.geometry;
    ctx.save();
    if (flip) { ctx.translate(pageWidth, 0); ctx.scale(-1, 1); }
    this.drawPage(index, 0, 0, pageWidth, pageHeight);
    ctx.restore();
  }
  drawFold() {
    const ctx = this.context, turn = this.turn;
    const { pageWidth: W, pageHeight: H, center, top } = this.geometry;
    const fold = foldGeometry(turn.point, turn.cornerY, W, H);
    if (!fold) return;
    const { nx, ny, mx, my, k, front, reflected } = fold;
    const now = pairForSpread(this.spread, this.direction), after = pairForSpread(this.spread + turn.direction, this.direction);
    const sourceSlot = turn.side === 1 ? 1 : 0, shadow = this.colors.shadow;
    ctx.save(); ctx.translate(center, top); ctx.scale(turn.side, 1);
    this.normalizedPage(after[sourceSlot], turn.side === -1);
    ctx.save(); this.trace(front); ctx.clip(); this.normalizedPage(now[sourceSlot], turn.side === -1);
    let shade = ctx.createLinearGradient(mx, my, mx - nx * 32, my - ny * 32);
    shade.addColorStop(0, rgba(shadow, .22)); shade.addColorStop(1, rgba(shadow, 0));
    ctx.fillStyle = shade; ctx.fillRect(0, 0, W, H); ctx.restore();
    if (reflected.length >= 3) {
      ctx.save(); this.trace(reflected); ctx.shadowColor = rgba(shadow, .28);
      ctx.shadowBlur = 18; ctx.shadowOffsetX = -turn.side * 5; ctx.shadowOffsetY = 7;
      ctx.fillStyle = this.colors.paper; ctx.fill(); ctx.restore();
      ctx.save(); this.trace(reflected); ctx.clip(); ctx.save();
      ctx.transform(1 - 2 * nx * nx, -2 * nx * ny, -2 * nx * ny, 1 - 2 * ny * ny, 2 * k * nx, 2 * k * ny);
      this.normalizedPage(after[1 - sourceSlot], turn.side === 1); ctx.restore();
      const band = Math.min(65, W * .24);
      shade = ctx.createLinearGradient(mx, my, mx - nx * band, my - ny * band);
      shade.addColorStop(0, rgba(shadow, .30)); shade.addColorStop(.22, 'rgba(255,254,250,.16)');
      shade.addColorStop(.58, rgba(shadow, .09)); shade.addColorStop(1, rgba(shadow, 0));
      ctx.fillStyle = shade; ctx.fillRect(-W - H, -H, 2 * (W + H), H * 3); ctx.restore();
      ctx.strokeStyle = rgba(shadow, .16); ctx.lineWidth = .7; this.trace(reflected); ctx.stroke();
    }
    ctx.restore();
  }
  draw() {
    const ctx = this.context;
    const { width, height, pageWidth: W, pageHeight: H, center, top } = this.geometry;
    if (!W) return;
    ctx.clearRect(0, 0, width, height);
    if (!this.pages.length) return;
    const pair = pairForSpread(this.spread, this.direction);
    ctx.save(); ctx.shadowColor = rgba(this.colors.shadow, .20); ctx.shadowBlur = 16; ctx.shadowOffsetY = 7;
    ctx.fillStyle = this.colors.paper; ctx.fillRect(center - W, top, W * 2, H); ctx.restore();
    for (let offset = 4; offset > 0; offset--) {
      ctx.fillStyle = offset % 2 ? this.colors.paper : this.colors.edge;
      ctx.fillRect(center - W - offset * .65, top + 2 + offset, W * 2 + offset * 1.3, H);
    }
    this.drawPage(pair[0], center - W, top, W, H); this.drawPage(pair[1], center, top, W, H);
    const band = Math.min(18, W * .06), gutter = ctx.createLinearGradient(center - band, 0, center + band, 0);
    gutter.addColorStop(0, rgba(this.colors.shadow, 0)); gutter.addColorStop(.48, rgba(this.colors.shadow, .20));
    gutter.addColorStop(.52, rgba(this.colors.shadow, .24)); gutter.addColorStop(1, rgba(this.colors.shadow, 0));
    ctx.fillStyle = gutter; ctx.fillRect(center - band, top, band * 2, H);
    if (this.turn) this.drawFold();
  }
  settle(commit) {
    if (!this.turn) return;
    const current = this.turn, start = { ...current.point };
    const finish = { x: commit ? -this.geometry.pageWidth + .05 : this.geometry.pageWidth - .05, y: current.cornerY };
    current.pointerId = null;
    const began = performance.now(), duration = this.reducedMotion.matches ? 0 : 390;
    const frame = time => {
      if (this.turn !== current) return;
      const t = duration ? clamp((time - began) / duration, 0, 1) : 1;
      const eased = 1 - Math.pow(1 - t, 3);
      current.point = { x: start.x + (finish.x - start.x) * eased, y: start.y + (finish.y - start.y) * eased };
      this.draw();
      if (t < 1) this.animation = requestAnimationFrame(frame);
      else {
        if (commit) this.spread = clamp(this.spread + current.direction, 0, this.maximumSpread);
        this.turn = null; this.animation = 0; this.canvas.style.cursor = 'grab'; this.draw(); this.changed();
      }
    };
    this.animation = requestAnimationFrame(frame);
  }
  turnPage(direction) {
    if (this.turn || !this.canTurn(direction)) return;
    const { pageWidth: W, pageHeight: H } = this.geometry;
    const side = direction * (this.direction === 'ltr' ? 1 : -1);
    this.turn = { direction, side, cornerY: H, point: { x: W - 1, y: H - 1 }, pointerId: null };
    this.changed(); this.settle(true);
  }
  pointerPosition(event) {
    const rect = this.canvas.getBoundingClientRect(), g = this.geometry;
    return { x: (event.clientX - rect.left) * g.width / rect.width, y: (event.clientY - rect.top) * g.height / rect.height - g.top };
  }
  attachEvents() {
    this.canvas.addEventListener('pointerdown', event => {
      if (this.turn || this.busy || (event.pointerType === 'mouse' && event.button !== 0)) return;
      const p = this.pointerPosition(event), g = this.geometry;
      const side = p.x >= g.center ? 1 : -1, u = side * (p.x - g.center);
      const direction = side * (this.direction === 'ltr' ? 1 : -1);
      if (u < g.pageWidth * .55 || u > g.pageWidth + 6 || p.y < -4 || p.y > g.pageHeight + 6 || !this.canTurn(direction)) return;
      const cornerY = p.y < g.pageHeight / 2 ? 0 : g.pageHeight;
      this.turn = { direction, side, cornerY, point: constrainCorner({ x: u, y: p.y }, cornerY, g.pageWidth, g.pageHeight), pointerId: event.pointerId, origin: p, moved: 0 };
      this.canvas.setPointerCapture(event.pointerId); this.canvas.style.cursor = 'grabbing';
      event.preventDefault(); this.draw(); this.changed();
    });
    this.canvas.addEventListener('pointermove', event => {
      if (!this.turn || this.turn.pointerId !== event.pointerId) return;
      const p = this.pointerPosition(event), g = this.geometry;
      this.turn.moved = Math.max(this.turn.moved, Math.hypot(p.x - this.turn.origin.x, p.y - this.turn.origin.y));
      this.turn.point = constrainCorner({ x: this.turn.side * (p.x - g.center), y: p.y }, this.turn.cornerY, g.pageWidth, g.pageHeight);
      event.preventDefault(); this.draw();
    });
    const end = (event, cancelled) => {
      if (!this.turn || this.turn.pointerId !== event.pointerId) return;
      const commit = !cancelled && (this.turn.point.x < 0 || this.turn.moved < 6);
      const id = this.turn.pointerId; this.turn.pointerId = null;
      if (this.canvas.hasPointerCapture(id)) this.canvas.releasePointerCapture(id);
      this.settle(commit);
    };
    this.canvas.addEventListener('pointerup', event => end(event, false));
    this.canvas.addEventListener('pointercancel', event => end(event, true));
    this.canvas.addEventListener('lostpointercapture', event => end(event, true));
    this.canvas.addEventListener('dblclick', () => this.canvas.dispatchEvent(new CustomEvent('book:zoom', { bubbles: true })));
  }
}
