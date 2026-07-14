// Motion resolvers. Each returns where the cursor lands plus the metadata an
// operator needs (charwise/linewise, inclusive/exclusive of the target cell).
// Motions are pure functions of the buffer + a start position.

import type { TextBuffer } from "./buffer.ts";
import type { MotionResult, Pos } from "./types.ts";

export interface MotionCtx {
  buf: TextBuffer;
  from: Pos;
  count: number;
  /** Sticky column for j/k. */
  desiredCol: number;
  /** Argument char for f/F/t/T. */
  arg?: string;
  /** In operator-pending mode some motions behave inclusively (e.g. $). */
  forOperator?: boolean;
}

export type MotionFn = (ctx: MotionCtx) => MotionResult | null;

type CharClass = 0 | 1 | 2; // 0 blank, 1 keyword, 2 punctuation

function classOf(ch: string | undefined, big: boolean): CharClass {
  if (ch === undefined || ch === "" || ch === " " || ch === "\t") return 0;
  if (big) return 1; // WORD: any non-blank is the same class
  if (/[A-Za-z0-9_]/.test(ch)) return 1;
  return 2;
}

function clampNormal(buf: TextBuffer, pos: Pos): Pos {
  const row = Math.max(0, Math.min(buf.lineCount - 1, pos.row));
  const maxCol = Math.max(0, buf.lineLen(row) - 1);
  return { row, col: Math.max(0, Math.min(maxCol, pos.col)) };
}

// --- simple charwise motions ---

export const motionLeft: MotionFn = ({ from, count }) => ({
  pos: { row: from.row, col: Math.max(0, from.col - count) },
  wise: "charwise",
  inclusive: false,
});

export const motionRight: MotionFn = ({ buf, from, count }) => {
  const maxCol = Math.max(0, buf.lineLen(from.row) - 1);
  return {
    pos: { row: from.row, col: Math.min(maxCol, from.col + count) },
    wise: "charwise",
    inclusive: false,
  };
};

export const motionDown: MotionFn = ({ buf, from, count, desiredCol }) => {
  const row = Math.min(buf.lineCount - 1, from.row + count);
  if (row === from.row) return null;
  const col = Math.min(Math.max(0, buf.lineLen(row) - 1), desiredCol);
  return { pos: { row, col }, wise: "linewise", inclusive: true };
};

export const motionUp: MotionFn = ({ buf, from, count, desiredCol }) => {
  const row = Math.max(0, from.row - count);
  if (row === from.row) return null;
  const col = Math.min(Math.max(0, buf.lineLen(row) - 1), desiredCol);
  return { pos: { row, col }, wise: "linewise", inclusive: true };
};

export const motionLineStart: MotionFn = ({ from }) => ({
  pos: { row: from.row, col: 0 },
  wise: "charwise",
  inclusive: false,
});

export const motionFirstNonBlank: MotionFn = ({ buf, from }) => {
  const line = buf.line(from.row);
  const col = Math.max(0, line.search(/\S/));
  return {
    pos: { row: from.row, col: line.trim() === "" ? 0 : col },
    wise: "charwise",
    inclusive: false,
  };
};

export const motionLineEnd: MotionFn = ({ buf, from, count }) => {
  const row = Math.min(buf.lineCount - 1, from.row + (count - 1));
  const col = Math.max(0, buf.lineLen(row) - 1);
  return { pos: { row, col }, wise: "charwise", inclusive: true };
};

// --- file motions ---

export const motionFirstLine: MotionFn = ({ buf, from, count }) => {
  // gg with a count goes to that line (1-based); bare gg -> line 1.
  const row = Math.min(buf.lineCount - 1, Math.max(0, count - 1));
  void from;
  return {
    pos: firstNonBlank(buf, row),
    wise: "linewise",
    inclusive: true,
  };
};

export const motionLastLine: MotionFn = ({ buf, count }) => {
  // The engine passes count<=0 for a bare G (last line); a positive count -> that line.
  const row = count <= 0 ? buf.lineCount - 1 : Math.min(buf.lineCount - 1, count - 1);
  return { pos: firstNonBlank(buf, row), wise: "linewise", inclusive: true };
};

function firstNonBlank(buf: TextBuffer, row: number): Pos {
  const line = buf.line(row);
  const idx = line.search(/\S/);
  return { row, col: idx < 0 ? 0 : idx };
}

// --- word motions ---

function atEnd(buf: TextBuffer, row: number, col: number): boolean {
  return col >= buf.lineLen(row);
}

export function wordForward(buf: TextBuffer, from: Pos, big: boolean): Pos {
  let { row, col } = from;
  const lastRow = buf.lineCount - 1;
  const cls = (r: number, c: number): CharClass =>
    classOf(buf.line(r)[c], big);

  const startCls = atEnd(buf, row, col) ? 0 : cls(row, col);
  if (startCls !== 0) {
    while (!atEnd(buf, row, col) && cls(row, col) === startCls) col++;
  } else {
    col++;
  }
  // Skip whitespace across lines; an empty line is itself a target.
  for (;;) {
    if (atEnd(buf, row, col)) {
      if (row >= lastRow) {
        // Past-end column: movement clamps this to lineLen-1, but an operator
        // (dw/yw/cw) uses it to include the final character of the line.
        col = buf.lineLen(row);
        break;
      }
      row++;
      col = 0;
      if (buf.lineLen(row) === 0) break;
      continue;
    }
    if (cls(row, col) === 0) {
      col++;
      continue;
    }
    break;
  }
  return { row, col };
}

export function wordEnd(buf: TextBuffer, from: Pos, big: boolean): Pos {
  let { row, col } = from;
  const lastRow = buf.lineCount - 1;
  const cls = (r: number, c: number): CharClass =>
    classOf(buf.line(r)[c], big);

  // Always advance at least one position.
  const adv = (): boolean => {
    if (!atEnd(buf, row, col) && col < buf.lineLen(row) - 1) {
      col++;
      return true;
    }
    if (row < lastRow) {
      row++;
      col = 0;
      return true;
    }
    return false;
  };
  adv();
  // Skip whitespace.
  while (atEnd(buf, row, col) || cls(row, col) === 0) {
    if (!adv()) return clampNormal(buf, { row, col });
  }
  // Advance to last char of this class run.
  const c = cls(row, col);
  while (col < buf.lineLen(row) - 1 && cls(row, col + 1) === c) col++;
  return { row, col };
}

export function wordBackward(buf: TextBuffer, from: Pos, big: boolean): Pos {
  let { row, col } = from;
  const cls = (r: number, c: number): CharClass =>
    classOf(buf.line(r)[c], big);

  const retreat = (): boolean => {
    if (col > 0) {
      col--;
      return true;
    }
    if (row > 0) {
      row--;
      col = Math.max(0, buf.lineLen(row) - 1);
      if (buf.lineLen(row) === 0) col = 0;
      return true;
    }
    return false;
  };
  if (!retreat()) return { row: 0, col: 0 };
  // Skip whitespace backward.
  while (atEnd(buf, row, col) || cls(row, col) === 0) {
    if (buf.lineLen(row) === 0) break; // empty line is a target
    if (!retreat()) return { row: 0, col: 0 };
  }
  // Move to first char of this class run.
  const c = cls(row, col);
  while (col > 0 && cls(row, col - 1) === c) col--;
  return { row, col };
}

export const motionWord = (big: boolean): MotionFn => ({ buf, from, count }) => {
  let pos = from;
  for (let i = 0; i < count; i++) pos = wordForward(buf, pos, big);
  return { pos, wise: "charwise", inclusive: false };
};

export const motionWordEnd = (big: boolean): MotionFn => ({ buf, from, count }) => {
  let pos = from;
  for (let i = 0; i < count; i++) pos = wordEnd(buf, pos, big);
  return { pos, wise: "charwise", inclusive: true };
};

export const motionWordBack = (big: boolean): MotionFn => ({ buf, from, count }) => {
  let pos = from;
  for (let i = 0; i < count; i++) pos = wordBackward(buf, pos, big);
  return { pos, wise: "charwise", inclusive: false };
};

// --- find on line: f F t T ---

export function findChar(
  buf: TextBuffer,
  from: Pos,
  ch: string,
  forward: boolean,
  till: boolean,
  count: number,
): Pos | null {
  const line = buf.line(from.row);
  let col = from.col;
  let remaining = count;
  if (forward) {
    // When repeating a 't' we must step over the adjacent char.
    let start = col + 1;
    for (let c = start; c < line.length; c++) {
      if (line[c] === ch) {
        remaining--;
        if (remaining === 0) return { row: from.row, col: till ? c - 1 : c };
      }
    }
  } else {
    for (let c = col - 1; c >= 0; c--) {
      if (line[c] === ch) {
        remaining--;
        if (remaining === 0) return { row: from.row, col: till ? c + 1 : c };
      }
    }
  }
  return null;
}

export const motionFind =
  (forward: boolean, till: boolean): MotionFn =>
  ({ buf, from, count, arg }) => {
    if (!arg) return null;
    const pos = findChar(buf, from, arg, forward, till, count);
    if (!pos) return null;
    return { pos, wise: "charwise", inclusive: forward };
  };

// --- paragraph motions { } (blank-line separated) ---

export const motionParagraphForward: MotionFn = ({ buf, from, count }) => {
  let row = from.row;
  for (let i = 0; i < count; i++) {
    row++;
    while (row < buf.lineCount - 1 && buf.line(row).trim() !== "") row++;
    if (row >= buf.lineCount - 1) {
      row = buf.lineCount - 1;
      break;
    }
  }
  return { pos: { row, col: 0 }, wise: "charwise", inclusive: false };
};

export const motionParagraphBackward: MotionFn = ({ buf, from, count }) => {
  let row = from.row;
  for (let i = 0; i < count; i++) {
    row--;
    while (row > 0 && buf.line(row).trim() !== "") row--;
    if (row <= 0) {
      row = 0;
      break;
    }
  }
  return { pos: { row, col: 0 }, wise: "charwise", inclusive: false };
};

export { clampNormal, classOf, firstNonBlank };
