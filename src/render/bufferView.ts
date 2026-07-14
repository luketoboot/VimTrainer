// Draws a Vim buffer (text + cursor + selection + optional highlights) onto the
// terminal grid. Shared by every mode so the buffer always looks the same.

import type { TerminalRenderer } from "./terminal.ts";
import type { Pos, VimStateView } from "../engine/types.ts";
import { cmpPos } from "../engine/buffer.ts";

export interface BufferViewOptions {
  topRow?: number; // first buffer row shown (vertical scroll)
  leftCol?: number; // first buffer column shown at grid col 0
  screenRow?: number; // grid row where the buffer starts
  highlights?: { pos: Pos; fg?: string; bg?: string; ch?: string }[];
  cursorColor?: string;
  showCursor?: boolean;
  dimText?: boolean;
}

export function drawBuffer(
  term: TerminalRenderer,
  view: VimStateView,
  opts: BufferViewOptions = {},
): void {
  const topRow = opts.topRow ?? 0;
  const leftCol = opts.leftCol ?? 0;
  const screenRow = opts.screenRow ?? 0;
  const theme = term.theme;
  const textFg = opts.dimText ? theme.dim : theme.fg;

  const visibleRows = term.rows - 1 - screenRow; // leave the statusline row
  const sel = selectionRange(view);

  for (let sr = 0; sr < visibleRows; sr++) {
    const bufRow = topRow + sr;
    if (bufRow >= view.lines.length) break;
    const line = view.lines[bufRow]!;
    for (let sc = 0; sc < term.cols; sc++) {
      const bufCol = leftCol + sc;
      const ch = line[bufCol] ?? " ";
      const inSel = sel ? posInSelection({ row: bufRow, col: bufCol }, sel, line.length) : false;
      if (inSel) {
        term.drawCell(screenRow + sr, sc, ch, { fg: theme.cursorFg, bg: theme.accentAlt });
      } else if (ch !== " ") {
        term.drawCell(screenRow + sr, sc, ch, { fg: textFg });
      }
    }
  }

  // Highlights (targets) draw over text but under the cursor.
  for (const h of opts.highlights ?? []) {
    const sr = h.pos.row - topRow;
    const sc = h.pos.col - leftCol;
    if (sr < 0 || sr >= visibleRows || sc < 0 || sc >= term.cols) continue;
    const under = view.lines[h.pos.row]?.[h.pos.col] ?? " ";
    term.drawCell(screenRow + sr, sc, h.ch ?? under, {
      fg: h.fg ?? theme.cursorFg,
      bg: h.bg ?? theme.accent,
      bold: true,
    });
  }

  if (opts.showCursor !== false) {
    const csr = view.cursor.row - topRow;
    const csc = view.cursor.col - leftCol;
    if (csr >= 0 && csr < visibleRows && csc >= 0 && csc < term.cols) {
      const ch = view.lines[view.cursor.row]?.[view.cursor.col] ?? " ";
      const bar = view.mode === "insert";
      term.drawCursor(screenRow + csr, csc, ch, { bar, color: opts.cursorColor });
    }
  }
}

interface Sel {
  start: Pos;
  end: Pos;
  mode: "visual" | "visual-line" | "visual-block";
}

function selectionRange(view: VimStateView): Sel | null {
  if (!view.visualAnchor) return null;
  if (view.mode === "visual-block") {
    const a = view.visualAnchor;
    const b = view.cursor;
    return {
      start: { row: Math.min(a.row, b.row), col: Math.min(a.col, b.col) },
      end: { row: Math.max(a.row, b.row), col: Math.max(a.col, b.col) },
      mode: "visual-block",
    };
  }
  let a = view.visualAnchor;
  let b = view.cursor;
  if (cmpPos(a, b) > 0) [a, b] = [b, a];
  return { start: a, end: b, mode: view.mode === "visual-line" ? "visual-line" : "visual" };
}

function posInSelection(p: Pos, sel: Sel, lineLen: number): boolean {
  if (sel.mode === "visual-block") {
    return p.row >= sel.start.row && p.row <= sel.end.row && p.col >= sel.start.col && p.col <= sel.end.col && p.col < lineLen;
  }
  if (sel.mode === "visual-line") return p.row >= sel.start.row && p.row <= sel.end.row && p.col < Math.max(1, lineLen);
  if (p.row < sel.start.row || p.row > sel.end.row) return false;
  if (p.row === sel.start.row && p.col < sel.start.col) return false;
  if (p.row === sel.end.row && p.col > sel.end.col) return false;
  return p.col < lineLen || p.row < sel.end.row; // include newline cell on wrapped rows
}
