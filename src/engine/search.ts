// Literal substring search (wrap-around) and % match-pair jumping.
// Literal (not regex) keeps behaviour predictable for a trainer; it still teaches
// the /, ?, n, N, * and % muscle memory faithfully.

import type { TextBuffer } from "./buffer.ts";
import type { Pos } from "./types.ts";

export function searchForward(buf: TextBuffer, from: Pos, text: string): Pos | null {
  if (!text) return null;
  const n = buf.lineCount;
  for (let i = 0; i <= n; i++) {
    const row = (from.row + i) % n;
    const startCol = i === 0 ? from.col + 1 : 0;
    const idx = buf.line(row).indexOf(text, startCol);
    if (idx >= 0) return { row, col: idx };
  }
  return null;
}

export function searchBackward(buf: TextBuffer, from: Pos, text: string): Pos | null {
  if (!text) return null;
  const n = buf.lineCount;
  for (let i = 0; i <= n; i++) {
    const row = ((from.row - i) % n + n) % n;
    const line = buf.line(row);
    const fromCol = i === 0 ? from.col - 1 : line.length;
    if (fromCol < 0) continue;
    const idx = line.lastIndexOf(text, fromCol);
    if (idx >= 0) return { row, col: idx };
  }
  return null;
}

/** The keyword under (or after) the cursor — used by the * command. */
export function wordUnderCursor(buf: TextBuffer, from: Pos): string | null {
  const line = buf.line(from.row);
  const isKw = (c: string): boolean => /[A-Za-z0-9_]/.test(c);
  let col = from.col;
  if (!isKw(line[col] ?? "")) {
    // Skip forward to the next keyword char on the line.
    while (col < line.length && !isKw(line[col]!)) col++;
    if (col >= line.length) return null;
  }
  let start = col;
  let end = col;
  while (start > 0 && isKw(line[start - 1]!)) start--;
  while (end < line.length - 1 && isKw(line[end + 1]!)) end++;
  return line.slice(start, end + 1);
}

const OPEN = "([{";
const CLOSE = ")]}";

/** Jump to the bracket matching the one under (or next on the line after) the cursor. */
export function matchPair(buf: TextBuffer, from: Pos): Pos | null {
  const line = buf.line(from.row);
  let col = from.col;
  while (col < line.length && !OPEN.includes(line[col]!) && !CLOSE.includes(line[col]!)) col++;
  if (col >= line.length) return null;
  const ch = line[col]!;
  if (OPEN.includes(ch)) {
    const close = CLOSE[OPEN.indexOf(ch)]!;
    return scan(buf, { row: from.row, col }, ch, close, 1);
  }
  const open = OPEN[CLOSE.indexOf(ch)]!;
  return scan(buf, { row: from.row, col }, open, ch, -1);
}

function scan(buf: TextBuffer, start: Pos, open: string, close: string, dir: 1 | -1): Pos | null {
  let depth = 0;
  let row = start.row;
  let col = start.col;
  for (;;) {
    const ch = buf.line(row)[col] ?? "";
    if (ch === open) depth += dir === 1 ? 1 : -1;
    else if (ch === close) depth += dir === 1 ? -1 : 1;
    if (depth === 0 && (ch === open || ch === close) && !(row === start.row && col === start.col)) {
      return { row, col };
    }
    // advance
    if (dir === 1) {
      col++;
      if (col > buf.lineLen(row)) {
        row++;
        col = 0;
        if (row >= buf.lineCount) return null;
      }
    } else {
      col--;
      if (col < 0) {
        row--;
        if (row < 0) return null;
        col = Math.max(0, buf.lineLen(row) - 1);
      }
    }
    // Safety: the very first iteration handled start; keep going until matched or out.
    if (row === start.row && col === start.col) return null;
  }
}
