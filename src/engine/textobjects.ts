// Text objects: iw/aw, i"/a", i(/a(, i{/a{, i[/a[, i</a<, ip/ap.
// Each returns an inclusive-end range for an operator to act on.

import type { TextBuffer } from "./buffer.ts";
import { cmpPos } from "./buffer.ts";
import type { Pos, TextObjectRange } from "./types.ts";

function isWordChar(ch: string, big: boolean): boolean {
  if (ch === "" || ch === " " || ch === "\t") return false;
  if (big) return true;
  return /[A-Za-z0-9_]/.test(ch);
}
function isBlank(ch: string): boolean {
  return ch === "" || ch === " " || ch === "\t";
}

export function wordObject(
  buf: TextBuffer,
  pos: Pos,
  around: boolean,
  big: boolean,
): TextObjectRange | null {
  const line = buf.line(pos.row);
  if (line.length === 0) return null;
  const col = Math.min(pos.col, line.length - 1);
  const cur = line[col]!;

  let start = col;
  let end = col;
  const sameClass = (a: string, b: string): boolean => {
    if (isBlank(a) && isBlank(b)) return true;
    if (isBlank(a) || isBlank(b)) return false;
    if (big) return true;
    const aw = /[A-Za-z0-9_]/.test(a);
    const bw = /[A-Za-z0-9_]/.test(b);
    return aw === bw;
  };
  while (start > 0 && sameClass(line[start - 1]!, cur)) start--;
  while (end < line.length - 1 && sameClass(line[end + 1]!, cur)) end++;

  if (around && !isBlank(cur)) {
    // aw: include trailing whitespace, else leading whitespace.
    let ate = false;
    while (end < line.length - 1 && isBlank(line[end + 1]!)) {
      end++;
      ate = true;
    }
    if (!ate) {
      while (start > 0 && isBlank(line[start - 1]!)) start--;
    }
  }
  void isWordChar;
  return {
    start: { row: pos.row, col: start },
    end: { row: pos.row, col: end },
    wise: "charwise",
  };
}

/** Quote text object on the current line. */
export function quoteObject(
  buf: TextBuffer,
  pos: Pos,
  q: string,
  around: boolean,
): TextObjectRange | null {
  const line = buf.line(pos.row);
  // Collect quote positions (ignoring escaped quotes).
  const quotes: number[] = [];
  for (let i = 0; i < line.length; i++) {
    if (line[i] === q && line[i - 1] !== "\\") quotes.push(i);
  }
  // Find the pair surrounding or following the cursor.
  for (let i = 0; i + 1 < quotes.length; i += 2) {
    const open = quotes[i]!;
    const close = quotes[i + 1]!;
    if (pos.col <= close) {
      if (around) {
        return {
          start: { row: pos.row, col: open },
          end: { row: pos.row, col: close },
          wise: "charwise",
        };
      }
      if (close - open <= 1) return null; // empty "" -> nothing inside
      return {
        start: { row: pos.row, col: open + 1 },
        end: { row: pos.row, col: close - 1 },
        wise: "charwise",
      };
    }
  }
  return null;
}

/** Bracket/paren/brace text object, possibly spanning lines. */
export function pairObject(
  buf: TextBuffer,
  pos: Pos,
  open: string,
  close: string,
  around: boolean,
): TextObjectRange | null {
  const openPos = scanBack(buf, pos, open, close);
  if (!openPos) return null;
  const closePos = scanForward(buf, openPos, open, close);
  if (!closePos) return null;
  // Cursor must be within the pair.
  if (cmpPos(pos, closePos) > 0) return null;

  if (around) {
    return { start: openPos, end: closePos, wise: "charwise" };
  }
  // Multi-line block whose braces sit alone on their lines -> linewise inner
  // (matches Vim: di{ removes whole inner lines, ci{ leaves a line to type on).
  if (closePos.row > openPos.row) {
    const afterOpenBlank = buf.line(openPos.row).slice(openPos.col + 1).trim() === "";
    const beforeCloseBlank = buf.line(closePos.row).slice(0, closePos.col).trim() === "";
    if (afterOpenBlank && beforeCloseBlank) {
      const top = openPos.row + 1;
      const bot = closePos.row - 1;
      if (top <= bot) {
        return {
          start: { row: top, col: 0 },
          end: { row: bot, col: Math.max(0, buf.lineLen(bot) - 1) },
          wise: "linewise",
        };
      }
    }
  }
  // Inner: exclude the brackets themselves.
  const start = nextPos(buf, openPos);
  const end = prevPos(buf, closePos);
  if (!start || !end || cmpPos(start, end) > 0) return null;
  return { start, end, wise: "charwise" };
}

function scanBack(
  buf: TextBuffer,
  from: Pos,
  open: string,
  close: string,
): Pos | null {
  let depth = 0;
  let p: Pos | null = { row: from.row, col: from.col };
  // If cursor is on the open bracket, use it.
  if (buf.charAt(p) === open) return p;
  while (p) {
    const ch = buf.charAt(p);
    if (ch === close && !(p.row === from.row && p.col === from.col)) depth++;
    else if (ch === open) {
      if (depth === 0) return p;
      depth--;
    }
    p = prevPos(buf, p);
  }
  return null;
}

function scanForward(
  buf: TextBuffer,
  fromOpen: Pos,
  open: string,
  close: string,
): Pos | null {
  let depth = 0;
  let p: Pos | null = { row: fromOpen.row, col: fromOpen.col };
  let first = true;
  while (p) {
    const ch = buf.charAt(p);
    if (ch === open) {
      if (!first) depth++;
    } else if (ch === close) {
      if (depth === 0) return p;
      depth--;
    }
    first = false;
    p = nextPos(buf, p);
  }
  return null;
}

export function paragraphObject(
  buf: TextBuffer,
  pos: Pos,
  around: boolean,
): TextObjectRange {
  let top = pos.row;
  let bot = pos.row;
  const blank = (r: number): boolean => buf.line(r).trim() === "";
  const onBlank = blank(pos.row);
  while (top > 0 && blank(top - 1) === onBlank) top--;
  while (bot < buf.lineCount - 1 && blank(bot + 1) === onBlank) bot++;
  if (around) {
    while (bot < buf.lineCount - 1 && blank(bot + 1)) bot++;
  }
  return {
    start: { row: top, col: 0 },
    end: { row: bot, col: Math.max(0, buf.lineLen(bot) - 1) },
    wise: "linewise",
  };
}

function nextPos(buf: TextBuffer, p: Pos): Pos | null {
  if (p.col < buf.lineLen(p.row) - 1) return { row: p.row, col: p.col + 1 };
  if (p.row < buf.lineCount - 1) return { row: p.row + 1, col: 0 };
  return null;
}

function prevPos(buf: TextBuffer, p: Pos): Pos | null {
  if (p.col > 0) return { row: p.row, col: p.col - 1 };
  if (p.row > 0) return { row: p.row - 1, col: Math.max(0, buf.lineLen(p.row - 1) - 1) };
  return null;
}
