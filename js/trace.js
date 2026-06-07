const PIXELS_PER_MS = 6;      // vertical scale: px per ms of phase error
const SCROLL_PX_PER_SEC = 40; // horizontal scroll speed
const DOT_RADIUS = 2.5;
const TICK_COLOR = '#4a9eff';
const TOCK_COLOR = '#ff9f4a';
const GRID_COLOR = 'rgba(255,255,255,0.06)';
const ZERO_COLOR = 'rgba(255,255,255,0.18)';

export class Trace {
  constructor(canvas) {
    this._canvas = canvas;
    this._ctx = canvas.getContext('2d');
    this._points = []; // { x, y, isEven }
    this._startWallTime = null;
    this._startPhaseBaseline = null;
    this._frozen = false;
    this._rafId = null;
    this._resize();
    window.addEventListener('resize', () => this._resize());
  }

  _resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this._canvas.getBoundingClientRect();
    this._canvas.width = rect.width * dpr;
    this._canvas.height = rect.height * dpr;
    this._ctx.scale(dpr, dpr);
    this._w = rect.width;
    this._h = rect.height;
    this._draw();
  }

  reset() {
    this._points = [];
    this._startWallTime = null;
    this._startPhaseBaseline = null;
    this._frozen = false;
    this._draw();
  }

  freeze() {
    this._frozen = true;
  }

  addPoint(wallTime, phaseErrorMs, isEven) {
    if (this._startWallTime === null) {
      this._startWallTime = wallTime;
      this._startPhaseBaseline = phaseErrorMs;
    }
    const x = (wallTime - this._startWallTime) * SCROLL_PX_PER_SEC;
    const y = (phaseErrorMs - this._startPhaseBaseline) * PIXELS_PER_MS;
    this._points.push({ x, y, isEven });
    if (!this._frozen) this._draw();
  }

  _draw() {
    const ctx = this._ctx;
    const w = this._w;
    const h = this._h;
    ctx.clearRect(0, 0, w, h);

    // Background
    ctx.fillStyle = '#0d0d0d';
    ctx.fillRect(0, 0, w, h);

    // Scroll offset: keep latest point near right edge
    let offsetX = 0;
    if (this._points.length > 0) {
      const latestX = this._points[this._points.length - 1].x;
      offsetX = Math.max(0, latestX - w * 0.85);
    }

    const midY = h / 2;

    // Grid lines (horizontal)
    ctx.strokeStyle = GRID_COLOR;
    ctx.lineWidth = 1;
    for (let ms = -10; ms <= 10; ms += 2) {
      const y = midY - ms * PIXELS_PER_MS;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // Zero line
    ctx.strokeStyle = ZERO_COLOR;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, midY);
    ctx.lineTo(w, midY);
    ctx.stroke();

    // Ms labels on zero line
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.font = '10px monospace';
    ctx.textAlign = 'right';
    for (let ms = -8; ms <= 8; ms += 2) {
      if (ms === 0) continue;
      const y = midY - ms * PIXELS_PER_MS;
      ctx.fillText(`${ms > 0 ? '+' : ''}${ms}ms`, w - 4, y - 2);
    }

    // Dots
    for (const pt of this._points) {
      const sx = pt.x - offsetX;
      if (sx < -10 || sx > w + 10) continue;
      const sy = midY - pt.y;
      ctx.beginPath();
      ctx.arc(sx, sy, DOT_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = pt.isEven ? TICK_COLOR : TOCK_COLOR;
      ctx.fill();
    }

    // Legend
    ctx.textAlign = 'left';
    ctx.font = '11px monospace';
    this._dot(ctx, 14, h - 14, TICK_COLOR);
    ctx.fillStyle = TICK_COLOR;
    ctx.fillText('tick', 22, h - 10);
    this._dot(ctx, 58, h - 14, TOCK_COLOR);
    ctx.fillStyle = TOCK_COLOR;
    ctx.fillText('tock', 66, h - 10);
  }

  _dot(ctx, x, y, color) {
    ctx.beginPath();
    ctx.arc(x, y, DOT_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }

  // Returns a data URL of the current trace for the report
  snapshot() {
    return this._canvas.toDataURL('image/png');
  }
}
