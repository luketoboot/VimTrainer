// Pure terminal renderer: a monospace character grid on a canvas.
// Exposes low-level primitives (drawCell, drawText, cursor block, statusline).
// Knows nothing about Vim or game rules — modes compose scenes from these.

import {
  DEFAULT_METRICS,
  GREEN_PHOSPHOR,
  type GridMetrics,
  type Theme,
} from "./theme.ts";

export interface CellStyle {
  fg?: string;
  bg?: string;
  bold?: boolean;
}

export class TerminalRenderer {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  theme: Theme;
  metrics: GridMetrics;
  cols = 0;
  rows = 0;
  private dpr = 1;
  // Camera offset in pixels — the juice layer nudges this for screen shake.
  offsetX = 0;
  offsetY = 0;

  constructor(
    canvas: HTMLCanvasElement,
    theme: Theme = GREEN_PHOSPHOR,
    metrics: GridMetrics = DEFAULT_METRICS,
  ) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas context unavailable");
    this.ctx = ctx;
    this.theme = theme;
    this.metrics = metrics;
  }

  /** Size the grid to fill a target CSS pixel area, accounting for DPR. */
  resize(cssWidth: number, cssHeight: number): void {
    this.dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    this.canvas.width = Math.floor(cssWidth * this.dpr);
    this.canvas.height = Math.floor(cssHeight * this.dpr);
    this.canvas.style.width = `${cssWidth}px`;
    this.canvas.style.height = `${cssHeight}px`;

    const { cellW, cellH, padding } = this.metrics;
    this.cols = Math.max(1, Math.floor((cssWidth - padding * 2) / cellW));
    this.rows = Math.max(1, Math.floor((cssHeight - padding * 2) / cellH));
  }

  clear(): void {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = this.theme.bg;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    // Apply camera shake offset for all subsequent grid draws this frame.
    ctx.setTransform(
      this.dpr,
      0,
      0,
      this.dpr,
      this.offsetX * this.dpr,
      this.offsetY * this.dpr,
    );
  }

  private cellX(col: number): number {
    return this.metrics.padding + col * this.metrics.cellW;
  }

  private cellY(row: number): number {
    return this.metrics.padding + row * this.metrics.cellH;
  }

  drawCell(row: number, col: number, ch: string, style: CellStyle = {}): void {
    const ctx = this.ctx;
    const x = this.cellX(col);
    const y = this.cellY(row);
    const { cellW, cellH, fontSize } = this.metrics;

    if (style.bg) {
      ctx.fillStyle = style.bg;
      ctx.fillRect(x, y, cellW, cellH);
    }
    if (ch && ch !== " ") {
      ctx.fillStyle = style.fg ?? this.theme.fg;
      ctx.font = `${style.bold ? "bold " : ""}${fontSize}px ${this.theme.fontFamily}`;
      ctx.textBaseline = "middle";
      ctx.textAlign = "left";
      // Center the glyph within the cell.
      const gx = x + (cellW - fontSize * 0.6) / 2;
      ctx.fillText(ch, gx, y + cellH / 2 + 1);
    }
  }

  drawText(row: number, col: number, text: string, style: CellStyle = {}): void {
    for (let i = 0; i < text.length; i++) {
      this.drawCell(row, col + i, text[i]!, style);
    }
  }

  /** Draw a solid block cursor. When `hollow`, draws an outline (INSERT bar look handled by caller). */
  drawCursor(
    row: number,
    col: number,
    ch: string,
    opts: { hollow?: boolean; bar?: boolean; color?: string } = {},
  ): void {
    const ctx = this.ctx;
    const x = this.cellX(col);
    const y = this.cellY(row);
    const { cellW, cellH } = this.metrics;
    const color = opts.color ?? this.theme.cursorBg;

    if (opts.bar) {
      ctx.fillStyle = color;
      ctx.fillRect(x, y, 2, cellH);
      this.drawCell(row, col, ch, { fg: this.theme.fg });
      return;
    }
    if (opts.hollow) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 1, y + 1, cellW - 2, cellH - 2);
      this.drawCell(row, col, ch, { fg: this.theme.fg });
      return;
    }
    this.drawCell(row, col, ch === "" ? " " : ch, {
      bg: color,
      fg: this.theme.cursorFg,
    });
  }

  /** Draw a glyph at a floating-point cell coordinate (for smooth-moving entities
   *  like projectiles). Shares the same camera transform as drawCell. */
  drawGlyphAtCell(xCell: number, yCell: number, ch: string, color: string, bold = false): void {
    const ctx = this.ctx;
    const { cellW, cellH, padding, fontSize } = this.metrics;
    const x = padding + xCell * cellW;
    const y = padding + yCell * cellH;
    ctx.fillStyle = color;
    ctx.font = `${bold ? "bold " : ""}${fontSize}px ${this.theme.fontFamily}`;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillText(ch, x + (cellW - fontSize * 0.6) / 2, y + cellH / 2 + 1);
  }

  /** Bottom statusline strip, Vim-style. */
  drawStatusLine(left: string, right = ""): void {
    const ctx = this.ctx;
    const y = this.cellY(this.rows);
    const { cellH, padding } = this.metrics;
    const w = this.cols * this.metrics.cellW;
    ctx.fillStyle = this.theme.statusBg;
    ctx.fillRect(padding, y, w, cellH);
    // The right side claims its columns first; the left is ellipsized to what
    // remains so the two never overwrite each other or run off the grid.
    const r = right.slice(0, this.cols);
    const startCol = Math.max(0, this.cols - r.length);
    const maxLeft = r ? startCol - 1 : this.cols;
    const l = left.length > maxLeft ? left.slice(0, Math.max(0, maxLeft - 1)) + "…" : left;
    this.drawText(this.rows, 0, l, { fg: this.theme.statusFg, bold: true });
    if (r) this.drawText(this.rows, startCol, r, { fg: this.theme.statusFg });
  }

  /** Subtle CRT scanlines + vignette drawn over everything, fixed to the screen
   *  (unaffected by camera shake). Called last in a frame when enabled. */
  drawScanlines(): void {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const w = this.canvas.width / this.dpr;
    const h = this.canvas.height / this.dpr;
    ctx.save();
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = "#000000";
    for (let y = 0; y < h; y += 3) ctx.fillRect(0, y, w, 1);
    ctx.restore();
    // Vignette.
    const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.7);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(0,0,0,0.45)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  // Offscreen snapshot buffer for the bloom pass, so both blur layers sample the
  // same un-bloomed frame instead of compounding.
  private bloomBuf: HTMLCanvasElement | null = null;

  /**
   * Vectrex-style phosphor bloom: re-composite a blurred copy of the frame
   * additively over itself so bright strokes glow. `amount` is the user dial,
   * 0 (off) .. 1 (full halation). Called after the scene, before scanlines,
   * so the glow blooms while the scanline mask stays crisp on top.
   */
  drawBloom(amount: number): void {
    if (amount <= 0.01) return;
    const w = this.canvas.width;
    const h = this.canvas.height;
    if (!this.bloomBuf) this.bloomBuf = document.createElement("canvas");
    if (this.bloomBuf.width !== w || this.bloomBuf.height !== h) {
      this.bloomBuf.width = w;
      this.bloomBuf.height = h;
    }
    const buf = this.bloomBuf.getContext("2d");
    if (!buf) return;
    buf.setTransform(1, 0, 0, 1, 0, 0);
    buf.clearRect(0, 0, w, h);
    buf.drawImage(this.canvas, 0, 0);

    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "lighter";
    // Hot phosphor core — tight, near-opaque, slightly oversaturated.
    ctx.filter = `blur(${(1 + 2 * amount) * this.dpr}px) saturate(135%)`;
    ctx.globalAlpha = 0.45 + 0.55 * amount;
    ctx.drawImage(this.bloomBuf, 0, 0);
    // Mid glow — the visible aura around every stroke.
    ctx.filter = `blur(${(5 + 9 * amount) * this.dpr}px) saturate(150%) brightness(${1 + 0.3 * amount})`;
    ctx.globalAlpha = 0.25 + 0.55 * amount;
    ctx.drawImage(this.bloomBuf, 0, 0);
    // Far halation — light spilling across the glass; only at higher settings.
    if (amount > 0.2) {
      ctx.filter = `blur(${(14 + 18 * amount) * this.dpr}px) brightness(${1 + 0.5 * amount})`;
      ctx.globalAlpha = 0.55 * amount;
      ctx.drawImage(this.bloomBuf, 0, 0);
    }
    ctx.restore();
    ctx.filter = "none";
  }

  /** Direct access for effects that draw outside the grid abstraction (particles). */
  get context(): CanvasRenderingContext2D {
    return this.ctx;
  }

  gridToPixel(row: number, col: number): { x: number; y: number } {
    return {
      x: this.cellX(col) + this.metrics.cellW / 2,
      y: this.cellY(row) + this.metrics.cellH / 2,
    };
  }
}
