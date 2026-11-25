/**
 * 汎用インタラクティブ手書き・作図・計算メモキャンバス
 * - 漢字書き取りマス（十字点線ガイド付き）
 * - 図形・理科作図キャンバス（背景SVG＋フリーハンド＆直線定規ツール＋模範解答SVGオーバーレイ比較）
 * - 算数計算メモオーバーレイ
 */

export class DrawingCanvas {
  constructor(canvasEl, options = {}) {
    this.canvas = canvasEl;
    this.ctx = canvasEl.getContext('2d');
    this.mode = options.mode || 'free'; // 'free' | 'line' | 'eraser'
    this.color = options.color || '#1e293b';
    this.lineWidth = options.lineWidth || 3.5;
    this.strokes = [];
    this.currentStroke = null;
    this.drawing = false;
    this.onChange = options.onChange || null;

    this._bindEvents();
    this.resize();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(rect.width * dpr);
    this.canvas.height = Math.round(rect.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.redraw();
  }

  setMode(mode) {
    this.mode = mode;
  }

  setColor(color) {
    this.color = color;
    if (this.mode === 'eraser') this.mode = 'free';
  }

  setLineWidth(width) {
    this.lineWidth = width;
  }

  undo() {
    if (this.strokes.length > 0) {
      this.strokes.pop();
      this.redraw();
      this.onChange?.(this.strokes.length);
    }
  }

  clear() {
    this.strokes = [];
    this.currentStroke = null;
    this.redraw();
    this.onChange?.(0);
  }

  hasInk() {
    return this.strokes.length > 0;
  }

  _getPoint(e) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
    };
  }

  _bindEvents() {
    this.canvas.style.touchAction = 'none';

    this.canvas.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.canvas.setPointerCapture(e.pointerId);
      this.drawing = true;
      const pt = this._getPoint(e);
      this.currentStroke = {
        mode: this.mode,
        color: this.color,
        width: this.mode === 'eraser' ? this.lineWidth * 4 : this.lineWidth,
        points: [pt],
      };
      this.redraw();
    });

    this.canvas.addEventListener('pointermove', (e) => {
      if (!this.drawing || !this.currentStroke) return;
      e.preventDefault();
      const pt = this._getPoint(e);
      if (this.currentStroke.mode === 'line') {
        if (this.currentStroke.points.length === 1) {
          this.currentStroke.points.push(pt);
        } else {
          this.currentStroke.points[1] = pt;
        }
      } else {
        this.currentStroke.points.push(pt);
      }
      this.redraw();
    });

    const finish = (e) => {
      if (!this.drawing || !this.currentStroke) return;
      this.drawing = false;
      try {
        this.canvas.releasePointerCapture(e.pointerId);
      } catch (_) {}
      this.strokes.push(this.currentStroke);
      this.currentStroke = null;
      this.redraw();
      this.onChange?.(this.strokes.length);
    };

    this.canvas.addEventListener('pointerup', finish);
    this.canvas.addEventListener('pointercancel', finish);
  }

  redraw() {
    const rect = this.canvas.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, w, h);

    const all = this.currentStroke ? [...this.strokes, this.currentStroke] : this.strokes;
    for (const s of all) {
      if (!s.points.length) continue;
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = s.width;
      if (s.mode === 'eraser') {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.strokeStyle = 'rgba(0,0,0,1)';
      } else {
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = s.color;
      }

      ctx.beginPath();
      const p0 = s.points[0];
      ctx.moveTo(p0.x * w, p0.y * h);
      if (s.points.length === 1) {
        ctx.lineTo(p0.x * w + 0.1, p0.y * h + 0.1);
      } else {
        for (let i = 1; i < s.points.length; i++) {
          ctx.lineTo(s.points[i].x * w, s.points[i].y * h);
        }
      }
      ctx.stroke();
      ctx.restore();
    }
  }
}
