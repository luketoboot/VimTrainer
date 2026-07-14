// The text buffer: an array of lines plus primitive edit operations.
// Positions are {row, col}. col == line.length is a valid "end" position
// (insert mode can sit past the last char); normal mode clamps to length-1.

import type { Pos } from "./types.ts";

export class TextBuffer {
  lines: string[];

  constructor(text: string | string[] = "") {
    this.lines = Array.isArray(text) ? [...text] : text.split("\n");
    if (this.lines.length === 0) this.lines = [""];
  }

  clone(): TextBuffer {
    return new TextBuffer([...this.lines]);
  }

  toString(): string {
    return this.lines.join("\n");
  }

  get lineCount(): number {
    return this.lines.length;
  }

  line(row: number): string {
    return this.lines[row] ?? "";
  }

  lineLen(row: number): number {
    return this.line(row).length;
  }

  charAt(pos: Pos): string {
    return this.line(pos.row)[pos.col] ?? "";
  }

  /** Insert a string at a position (may contain newlines). Returns end position. */
  insertAt(pos: Pos, text: string): Pos {
    const line = this.line(pos.row);
    const before = line.slice(0, pos.col);
    const after = line.slice(pos.col);
    const parts = text.split("\n");
    if (parts.length === 1) {
      this.lines[pos.row] = before + text + after;
      return { row: pos.row, col: pos.col + text.length };
    }
    const newLines = [
      before + parts[0],
      ...parts.slice(1, -1),
      parts[parts.length - 1] + after,
    ];
    this.lines.splice(pos.row, 1, ...newLines);
    const endRow = pos.row + parts.length - 1;
    return { row: endRow, col: parts[parts.length - 1]!.length };
  }

  /** Delete an inclusive-start, exclusive-end charwise range on possibly multiple lines.
   *  Returns the removed text. */
  deleteRange(start: Pos, end: Pos): string {
    // Normalize so start <= end.
    if (cmpPos(start, end) > 0) [start, end] = [end, start];
    if (start.row === end.row) {
      const line = this.line(start.row);
      const removed = line.slice(start.col, end.col);
      this.lines[start.row] = line.slice(0, start.col) + line.slice(end.col);
      return removed;
    }
    const firstLine = this.line(start.row);
    const lastLine = this.line(end.row);
    const removed =
      firstLine.slice(start.col) +
      "\n" +
      this.lines.slice(start.row + 1, end.row).join("\n") +
      (end.row - start.row > 1 ? "\n" : "") +
      lastLine.slice(0, end.col);
    const merged = firstLine.slice(0, start.col) + lastLine.slice(end.col);
    this.lines.splice(start.row, end.row - start.row + 1, merged);
    return removed;
  }

  /** Delete whole lines [startRow, endRow] inclusive. Returns text with trailing newline. */
  deleteLines(startRow: number, endRow: number): string {
    if (startRow > endRow) [startRow, endRow] = [endRow, startRow];
    startRow = Math.max(0, startRow);
    endRow = Math.min(this.lineCount - 1, endRow);
    const removed = this.lines.slice(startRow, endRow + 1).join("\n") + "\n";
    this.lines.splice(startRow, endRow - startRow + 1);
    if (this.lines.length === 0) this.lines = [""];
    return removed;
  }

  /** Delete a single character at pos. Returns it (or "" if none). */
  deleteChar(pos: Pos): string {
    const line = this.line(pos.row);
    if (pos.col >= line.length) return "";
    const ch = line[pos.col]!;
    this.lines[pos.row] = line.slice(0, pos.col) + line.slice(pos.col + 1);
    return ch;
  }

  replaceLine(row: number, text: string): void {
    this.lines[row] = text;
  }

  insertLine(row: number, text: string): void {
    this.lines.splice(row, 0, text);
  }
}

export function cmpPos(a: Pos, b: Pos): number {
  if (a.row !== b.row) return a.row - b.row;
  return a.col - b.col;
}

export function clonePos(p: Pos): Pos {
  return { row: p.row, col: p.col };
}
