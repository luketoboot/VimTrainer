// The Vim engine: an authentic keystroke -> command interpreter over a text buffer.
// Public surface: feedKey(token) -> EngineEvent[], getView(), load(). No DOM/canvas.

import { TextBuffer, clonePos, cmpPos } from "./buffer.ts";
import type { KeyToken } from "./keymap.ts";
import {
  clampNormal,
  motionDown,
  motionFind,
  motionFirstLine,
  motionFirstNonBlank,
  motionLastLine,
  motionLeft,
  motionLineEnd,
  motionLineStart,
  motionParagraphBackward,
  motionParagraphForward,
  motionRight,
  motionUp,
  motionWord,
  motionWordBack,
  motionWordEnd,
  wordEnd,
  type MotionCtx,
  type MotionFn,
} from "./motions.ts";
import { motionToRange, textObjectToRange, type OpRange } from "./operators.ts";
import { matchPair, searchBackward, searchForward, wordUnderCursor } from "./search.ts";
import { parseEx, substituteLine } from "./ex.ts";
import {
  paragraphObject,
  pairObject,
  quoteObject,
  wordObject,
} from "./textobjects.ts";
import type {
  EngineEvent,
  Mode,
  MotionResult,
  Pos,
  Register,
  VimStateView,
} from "./types.ts";

interface Snapshot {
  lines: string[];
  cursor: Pos;
}

type WaitKind =
  | { kind: "find"; forward: boolean; till: boolean }
  | { kind: "replace" }
  | { kind: "register" }
  | { kind: "textobject"; around: boolean }
  | { kind: "macroRecord" }
  | { kind: "macroPlay" }
  | { kind: "markSet" }
  | { kind: "markJump"; line: boolean };

const SIMPLE_MOTIONS: Record<string, MotionFn> = {
  h: motionLeft,
  "<Left>": motionLeft,
  "<BS>": motionLeft,
  l: motionRight,
  "<Right>": motionRight,
  "<Space>": motionRight,
  j: motionDown,
  "<Down>": motionDown,
  k: motionUp,
  "<Up>": motionUp,
  "^": motionFirstNonBlank,
  "0": motionLineStart,
  $: motionLineEnd,
  w: motionWord(false),
  W: motionWord(true),
  e: motionWordEnd(false),
  E: motionWordEnd(true),
  b: motionWordBack(false),
  B: motionWordBack(true),
  G: motionLastLine,
  "{": motionParagraphBackward,
  "}": motionParagraphForward,
};

const PAIR_OPEN: Record<string, [string, string]> = {
  "(": ["(", ")"],
  ")": ["(", ")"],
  b: ["(", ")"],
  "{": ["{", "}"],
  "}": ["{", "}"],
  B: ["{", "}"],
  "[": ["[", "]"],
  "]": ["[", "]"],
  "<": ["<", ">"],
  ">": ["<", ">"],
};

export class VimEngine {
  private buf: TextBuffer;
  cursor: Pos = { row: 0, col: 0 };
  mode: Mode = "normal";
  private desiredCol = 0;
  private visualAnchor: Pos | null = null;

  private registers = new Map<string, Register>();
  private pendingCount = "";
  private opCount = 1; // count captured before the operator (the d in 2d3w)
  private pendingOperator: string | null = null;
  private pendingRegister: string | null = null;
  private waiting: WaitKind | null = null;
  private gPending = false;
  private lastFind: { forward: boolean; till: boolean; ch: string } | null = null;

  // Command line: search (/ ?) and ex (:).
  private cmdlineActive = false;
  private cmdlineKind: "search" | "ex" = "search";
  private cmdlineDir: 1 | -1 = 1;
  private cmdlineText = "";
  private lastSearch: { text: string; dir: 1 | -1 } | null = null;

  // Macros (recorded into the a-z registers) and marks.
  private recording: { reg: string; keys: KeyToken[] } | null = null;
  private lastMacroReg: string | null = null;
  private macroCount = 1;
  private marks = new Map<string, Pos>();
  private blockInsert: { rows: number[]; col: number } | null = null;

  private undoStack: Snapshot[] = [];
  private redoStack: Snapshot[] = [];

  // Dot-repeat: tokens accumulated for the current command, committed on a change.
  private cmdTokens: KeyToken[] = [];
  private lastChange: KeyToken[] | null = null;
  private replaying = false;

  private events: EngineEvent[] = [];

  constructor(text: string | string[] = "") {
    this.buf = new TextBuffer(text);
  }

  load(text: string | string[], cursor?: Pos): void {
    this.buf = new TextBuffer(text);
    this.cursor = cursor ? clonePos(cursor) : { row: 0, col: 0 };
    this.clampCursor();
    this.desiredCol = this.cursor.col;
    this.mode = "normal";
    this.visualAnchor = null;
    this.resetPending();
    this.cmdlineActive = false;
    this.cmdlineText = "";
    this.undoStack = [];
    this.redoStack = [];
    this.lastChange = null;
  }

  getText(): string {
    return this.buf.toString();
  }

  get lines(): readonly string[] {
    return this.buf.lines;
  }

  /** True while the next key is consumed literally (f/t/r/m/"/q argument, or
   *  typing on the : / search command line) — remap layers must stand down,
   *  exactly like real Vim mappings do. */
  get awaitingLiteral(): boolean {
    return this.waiting !== null || this.cmdlineActive;
  }

  getView(): VimStateView {
    return {
      lines: this.buf.lines,
      cursor: this.cursor,
      mode: this.mode,
      visualAnchor: this.visualAnchor,
      pending:
        (this.pendingRegister ? `"${this.pendingRegister}` : "") +
        this.pendingCount +
        (this.pendingOperator ?? "") +
        (this.gPending ? "g" : ""),
      cmdline: this.cmdlineActive
        ? (this.cmdlineKind === "ex" ? ":" : this.cmdlineDir === 1 ? "/" : "?") + this.cmdlineText
        : null,
    };
  }

  // --- main entry ---

  feedKey(token: KeyToken): EngineEvent[] {
    this.events = [];
    const wasRecording = !!this.recording;
    if (!this.replaying) this.cmdTokens.push(token);
    try {
      if (this.cmdlineActive) this.handleCmdline(token);
      else if (this.mode === "insert") this.handleInsert(token);
      else this.handleNormalLike(token);
    } catch (e) {
      this.bell();
      if (typeof console !== "undefined") console.error(e);
    }
    // Record into a macro only tokens that occur *during* recording — not the
    // q{reg} that starts it, nor the q that stops it (recording becomes null then).
    if (wasRecording && this.recording && !this.replaying) this.recording.keys.push(token);
    // A token that leaves the engine fully idle in normal mode completed a
    // pure motion, a yank, or nothing (edits always commitChange, which clears
    // the accumulator). Drop those tokens so travel never leaks into the next
    // change's dot-repeat record — `.` replays the change only, like real Vim.
    if (
      !this.replaying &&
      this.mode === "normal" &&
      !this.cmdlineActive &&
      this.pendingOperator === null &&
      this.waiting === null &&
      !this.gPending &&
      this.pendingCount === "" &&
      this.pendingRegister === null
    ) {
      this.cmdTokens = [];
    }
    return this.events;
  }

  /** Feed a whole string of tokens (test helper; multi-char specials use <..>). */
  feedKeys(keys: string): EngineEvent[] {
    let all: EngineEvent[] = [];
    for (const tok of tokenize(keys)) all = all.concat(this.feedKey(tok));
    return all;
  }

  // --- events ---
  private emit(e: EngineEvent): void {
    this.events.push(e);
  }
  private bell(): void {
    this.emit({ type: "bell" });
  }

  // --- normal / visual / operator-pending ---

  private handleNormalLike(token: KeyToken): void {
    // Multi-key continuations first.
    if (this.waiting) return this.resolveWaiting(token);
    if (this.gPending) return this.resolveG(token);

    // Count accumulation ("0" only starts a count when one is already building).
    if (/^[1-9]$/.test(token) || (token === "0" && this.pendingCount !== "")) {
      this.pendingCount += token;
      return;
    }

    // Register selection: "x
    if (token === '"') {
      this.waiting = { kind: "register" };
      return;
    }

    // Operators.
    if (token === "d" || token === "c" || token === "y") {
      this.startOrRepeatOperator(token);
      return;
    }

    // Text object entry (only meaningful with a pending operator or visual mode).
    if ((token === "i" || token === "a") && (this.pendingOperator || this.isVisual())) {
      this.waiting = { kind: "textobject", around: token === "a" };
      return;
    }

    // 'g' prefix.
    if (token === "g" && !this.pendingOperator) {
      this.gPending = true;
      return;
    }
    if (token === "g" && this.pendingOperator) {
      // dg / cg wait for the second g -> linewise gg motion
      this.gPending = true;
      return;
    }

    // Find family (need a char next).
    if (token === "f" || token === "F" || token === "t" || token === "T") {
      this.waiting = {
        kind: "find",
        forward: token === "f" || token === "t",
        till: token === "t" || token === "T",
      };
      return;
    }
    if (token === ";" || token === ",") {
      this.repeatFind(token === ",");
      return;
    }

    // Search family.
    if (token === "/" || token === "?") {
      this.cmdlineActive = true;
      this.cmdlineKind = "search"; // a prior ":" leaves kind at "ex" — reset it
      this.cmdlineDir = token === "/" ? 1 : -1;
      this.cmdlineText = "";
      return;
    }
    if (token === "n" || token === "N") {
      this.repeatSearch(token === "N");
      return;
    }
    if (token === "*") {
      this.searchWordUnderCursor();
      return;
    }

    // Ex command line.
    if (token === ":") {
      this.cmdlineActive = true;
      this.cmdlineKind = "ex";
      this.cmdlineText = "";
      return;
    }

    // Macros.
    if (token === "q") {
      if (this.recording) this.stopRecording();
      else this.waiting = { kind: "macroRecord" };
      return;
    }
    if (token === "@") {
      this.macroCount = this.takeCount();
      this.waiting = { kind: "macroPlay" };
      return;
    }

    // Marks.
    if (token === "m") {
      this.waiting = { kind: "markSet" };
      return;
    }
    if (token === "`") {
      this.waiting = { kind: "markJump", line: false };
      return;
    }
    if (token === "'") {
      this.waiting = { kind: "markJump", line: true };
      return;
    }

    // Visual block.
    if (token === "<C-v>") {
      this.enterVisual("visual-block");
      return;
    }

    // In-selection shortcuts: x deletes the selection; I/A do block insert.
    if (this.isVisual()) {
      if (token === "x") {
        this.applyOperatorToSelection("d");
        return;
      }
      if (this.mode === "visual-block" && (token === "I" || token === "A")) {
        this.startBlockInsert(token === "A");
        return;
      }
    }

    // % match-pair (works as a motion, so d% etc. compose).
    if (token === "%") {
      const pos = matchPair(this.buf, this.cursor);
      if (pos) this.applyMotion({ pos, wise: "charwise", inclusive: true }, "%");
      else this.afterFailedMotion();
      return;
    }

    // Motions.
    const m = this.resolveSimpleMotion(token);
    if (m) {
      this.applyMotion(m, token);
      return;
    }

    // Non-motion commands.
    this.handleAction(token);
  }

  private startOrRepeatOperator(op: string): void {
    if (this.isVisual()) {
      // Operator on the visual selection.
      this.applyOperatorToSelection(op);
      return;
    }
    if (this.pendingOperator === op) {
      // Doubled operator -> linewise on `count` lines (dd, cc, yy).
      const n = this.opCount * this.peekCount();
      this.operateLinewise(op, this.cursor.row, Math.min(this.buf.lineCount - 1, this.cursor.row + n - 1));
      this.resetPending();
      return;
    }
    if (this.pendingOperator) {
      // Different operator already pending: invalid, reset.
      this.resetPending();
      this.bell();
      return;
    }
    // Capture the count typed before the operator; motion count accumulates fresh.
    this.opCount = this.takeCount();
    this.pendingOperator = op;
  }

  private resolveWaiting(token: KeyToken): void {
    const w = this.waiting!;
    this.waiting = null;
    if (w.kind === "register") {
      if (/^[a-zA-Z0-9"]$/.test(token)) this.pendingRegister = token.toLowerCase();
      else this.bell();
      return;
    }
    if (w.kind === "replace") {
      this.doReplaceChar(token);
      return;
    }
    if (w.kind === "find") {
      if (token.length !== 1) return this.bell();
      this.lastFind = { forward: w.forward, till: w.till, ch: token };
      const m = motionFind(w.forward, w.till)({
        ...this.motionCtx(),
        arg: token,
      });
      if (m) this.applyMotion(m, token);
      else this.afterFailedMotion();
      return;
    }
    if (w.kind === "textobject") {
      this.resolveTextObject(token, w.around);
      return;
    }
    if (w.kind === "macroRecord") {
      if (/^[a-zA-Z0-9]$/.test(token)) this.startRecording(token.toLowerCase());
      else this.bell();
      return;
    }
    if (w.kind === "macroPlay") {
      const reg = token === "@" ? this.lastMacroReg : token.toLowerCase();
      if (reg) this.playMacro(reg, this.macroCount);
      else this.bell();
      return;
    }
    if (w.kind === "markSet") {
      if (/^[a-zA-Z]$/.test(token)) this.marks.set(token, clonePos(this.cursor));
      else this.bell();
      return;
    }
    if (w.kind === "markJump") {
      this.jumpToMark(token, w.line);
      return;
    }
  }

  // --- macros ---

  private startRecording(reg: string): void {
    this.recording = { reg, keys: [] };
  }

  private stopRecording(): void {
    if (!this.recording) return;
    const { reg, keys } = this.recording;
    // Stored like a real Vim register: the keystrokes as replayable text.
    this.registers.set(reg, { text: keys.join(""), wise: "charwise" });
    this.recording = null;
  }

  private playMacro(reg: string, count: number): void {
    const r = this.registers.get(reg);
    if (!r || r.text === "") return this.bell();
    this.lastMacroReg = reg;
    const toks = tokenize(r.text);
    const prev = this.replaying;
    this.replaying = true;
    try {
      for (let i = 0; i < count; i++) for (const t of toks) this.feedKey(t);
    } finally {
      this.replaying = prev;
    }
    this.cmdTokens = []; // avoid polluting dot-repeat with @reg
  }

  // --- marks ---

  private jumpToMark(token: KeyToken, line: boolean): void {
    const pos = this.marks.get(token);
    if (!pos) {
      this.resetPending();
      return this.bell();
    }
    const target = line
      ? { row: Math.min(pos.row, this.buf.lineCount - 1), col: firstNonBlankCol(this.buf, Math.min(pos.row, this.buf.lineCount - 1)) }
      : clonePos(pos);
    this.applyMotion(
      { pos: target, wise: line ? "linewise" : "charwise", inclusive: false },
      line ? "'" : "`",
    );
  }

  private resolveG(token: KeyToken): void {
    this.gPending = false;
    if (token === "g") {
      const count = this.pendingCount === "" ? 1 : parseInt(this.pendingCount, 10);
      const m = motionFirstLine({ ...this.motionCtx(), count });
      if (m) this.applyMotion(m, "gg");
      return;
    }
    // Unsupported g-command.
    this.resetPending();
    this.bell();
  }

  // --- motions ---

  /** Effective count = operator count × motion count (e.g. 2d3w -> 6). */
  private effectiveCount(): number {
    const motion = this.peekCount();
    return this.pendingOperator ? this.opCount * motion : motion;
  }

  private motionCtx(): MotionCtx {
    return {
      buf: this.buf,
      from: this.cursor,
      count: this.effectiveCount(),
      desiredCol: this.desiredCol,
    };
  }

  private resolveSimpleMotion(token: KeyToken): MotionResult | null {
    const fn = SIMPLE_MOTIONS[token];
    if (!fn) return null;
    const ctx = this.motionCtx();
    // Bare G (no motion count) means "last line"; a count means "go to that line".
    if (token === "G" && this.pendingCount === "") ctx.count = 0;
    return fn(ctx);
  }

  /** cw/cW act like ce/cE, and dw stops at end of line (does not eat the newline). */
  private adjustWordOperator(op: string, token: KeyToken, m: MotionResult): MotionResult {
    if ((token === "w" || token === "W") && op === "c") {
      // change word -> change to end of word
      const big = token === "W";
      let pos = this.cursor;
      const count = this.effectiveCount();
      for (let i = 0; i < count; i++) pos = wordEnd(this.buf, pos, big);
      return { pos, wise: "charwise", inclusive: true };
    }
    if ((token === "w" || token === "W") && op === "d") {
      // dw on the last word of a line stops at end of line.
      if (m.pos.row > this.cursor.row) {
        const endCol = this.buf.lineLen(this.cursor.row);
        return { pos: { row: this.cursor.row, col: endCol }, wise: "charwise", inclusive: false };
      }
    }
    return m;
  }

  private applyMotion(m: MotionResult, token: KeyToken): void {
    if (this.pendingOperator) {
      const op = this.pendingOperator;
      const adjusted = this.adjustWordOperator(op, token, m);
      const range = motionToRange(this.cursor, adjusted);
      this.applyOperator(op, range);
      this.resetPending();
      return;
    }
    // Plain movement (also extends selection in visual mode).
    const from = clonePos(this.cursor);
    this.cursor = clampNormal(this.buf, m.pos);
    if (token !== "j" && token !== "k" && token !== "<Down>" && token !== "<Up>") {
      this.desiredCol = this.cursor.col;
    }
    this.takeCount();
    if (cmpPos(from, this.cursor) !== 0) this.emit({ type: "move", from, to: this.cursor });
  }

  private afterFailedMotion(): void {
    this.resetPending();
    this.bell();
  }

  private repeatFind(reverse: boolean): void {
    if (!this.lastFind) return this.bell();
    const { forward, till, ch } = this.lastFind;
    const dir = reverse ? !forward : forward;
    const m = motionFind(dir, till)({ ...this.motionCtx(), arg: ch });
    if (m) this.applyMotion(m, ";");
    else this.afterFailedMotion();
  }

  // --- search ---

  private handleCmdline(token: KeyToken): void {
    if (token === "<Esc>") {
      this.cmdlineActive = false;
      this.cmdlineText = "";
      return;
    }
    if (token === "<CR>") {
      this.cmdlineActive = false;
      const text = this.cmdlineText;
      this.cmdlineText = "";
      if (this.cmdlineKind === "ex") {
        this.execEx(text);
        return;
      }
      if (text === "") {
        // Bare Enter repeats the previous search.
        this.repeatSearch(false);
        return;
      }
      this.lastSearch = { text, dir: this.cmdlineDir };
      this.execSearch(text, this.cmdlineDir);
      return;
    }
    if (token === "<BS>") {
      if (this.cmdlineText === "") this.cmdlineActive = false;
      else this.cmdlineText = this.cmdlineText.slice(0, -1);
      return;
    }
    if (token.length === 1) this.cmdlineText += token;
    else if (token === "<Space>") this.cmdlineText += " ";
  }

  private execSearch(text: string, dir: 1 | -1): void {
    const pos = dir === 1 ? searchForward(this.buf, this.cursor, text) : searchBackward(this.buf, this.cursor, text);
    if (!pos) {
      this.emit({ type: "search", pattern: text, found: false });
      this.bell();
      return;
    }
    const from = clonePos(this.cursor);
    this.cursor = clampNormal(this.buf, pos);
    this.desiredCol = this.cursor.col;
    this.emit({ type: "search", pattern: text, found: true, to: this.cursor });
    if (cmpPos(from, this.cursor) !== 0) this.emit({ type: "move", from, to: this.cursor });
  }

  private repeatSearch(reverse: boolean): void {
    if (!this.lastSearch) return this.bell();
    const dir = (reverse ? -this.lastSearch.dir : this.lastSearch.dir) as 1 | -1;
    this.execSearch(this.lastSearch.text, dir);
  }

  private searchWordUnderCursor(): void {
    const word = wordUnderCursor(this.buf, this.cursor);
    if (!word) return this.bell();
    this.lastSearch = { text: word, dir: 1 };
    this.execSearch(word, 1);
  }

  // --- ex commands (:) ---

  private execEx(text: string): void {
    const cmd = parseEx(text, { cursorRow: this.cursor.row, lineCount: this.buf.lineCount });
    if (cmd.type === "error") return this.bell();
    if (cmd.type === "noop") return;
    if (cmd.type === "goto") {
      const from = clonePos(this.cursor);
      this.cursor = clampNormal(this.buf, { row: cmd.row, col: firstNonBlankCol(this.buf, cmd.row) });
      if (cmpPos(from, this.cursor) !== 0) this.emit({ type: "move", from, to: this.cursor });
      return;
    }
    // substitute
    let total = 0;
    let lastRow = -1;
    this.pushUndo();
    for (let row = cmd.startRow; row <= cmd.endRow; row++) {
      const [next, n] = substituteLine(this.buf.line(row), cmd.pat, cmd.rep, cmd.global, cmd.ignoreCase);
      if (n > 0) {
        this.buf.replaceLine(row, next);
        total += n;
        lastRow = row;
      }
    }
    if (total === 0) {
      this.undoStack.pop(); // nothing changed — discard the snapshot
      this.emit({ type: "search", pattern: cmd.pat, found: false });
      this.bell();
      return;
    }
    this.cursor = clampNormal(this.buf, { row: lastRow, col: firstNonBlankCol(this.buf, lastRow) });
    this.emit({ type: "edit", kind: "change", at: this.cursor });
    this.commitChange();
  }

  // --- text objects ---

  private resolveTextObject(token: KeyToken, around: boolean): void {
    let range: OpRange | null = null;
    if (token === "w" || token === "W") {
      const o = wordObject(this.buf, this.cursor, around, token === "W");
      range = o ? textObjectToRange(o) : null;
    } else if (token === '"' || token === "'" || token === "`") {
      const o = quoteObject(this.buf, this.cursor, token, around);
      range = o ? textObjectToRange(o) : null;
    } else if (token in PAIR_OPEN) {
      const [open, close] = PAIR_OPEN[token]!;
      const o = pairObject(this.buf, this.cursor, open, close, around);
      range = o ? textObjectToRange(o) : null;
    } else if (token === "p") {
      const o = paragraphObject(this.buf, this.cursor, around);
      range = textObjectToRange(o);
    }

    if (!range) {
      this.resetPending();
      return this.bell();
    }
    if (this.isVisual()) {
      this.visualAnchor = clonePos(range.start);
      this.cursor = clampNormal(this.buf, range.wise === "linewise" ? { row: range.endRow, col: 0 } : { row: range.end.row, col: Math.max(0, range.end.col - 1) });
      return;
    }
    const op = this.pendingOperator;
    if (op) {
      this.applyOperator(op, range);
    }
    this.resetPending();
  }

  // --- operators ---

  private applyOperator(op: string, range: OpRange): void {
    if (op === "y") {
      this.doYank(range);
      // cursor to start of yank (charwise) or stays (linewise -> start row).
      this.cursor = clampNormal(this.buf, range.wise === "linewise" ? { row: range.startRow, col: this.cursor.col } : range.start);
      return;
    }
    if (op === "d") {
      this.doDelete(range);
      return;
    }
    if (op === "c") {
      this.doChange(range);
      return;
    }
  }

  private operateLinewise(op: string, startRow: number, endRow: number): void {
    const range: OpRange = {
      wise: "linewise",
      startRow,
      endRow,
      start: { row: startRow, col: 0 },
      end: { row: endRow, col: 0 },
    };
    this.applyOperator(op, range);
  }

  private applyOperatorToSelection(op: string): void {
    if (!this.visualAnchor) return;
    if (this.mode === "visual-block") {
      this.applyBlockOperator(op);
      return;
    }
    const linewise = this.mode === "visual-line";
    let a = this.visualAnchor;
    let b = this.cursor;
    if (cmpPos(a, b) > 0) [a, b] = [b, a];
    const range: OpRange = linewise
      ? { wise: "linewise", startRow: a.row, endRow: b.row, start: { row: a.row, col: 0 }, end: { row: b.row, col: 0 } }
      : { wise: "charwise", start: a, end: { row: b.row, col: b.col + 1 }, startRow: a.row, endRow: b.row };
    this.pushUndo();
    this.applyOperator(op, range);
    if (op !== "c") {
      this.mode = "normal";
      this.visualAnchor = null;
      this.emit({ type: "mode", from: linewise ? "visual-line" : "visual", to: "normal" });
    }
    this.resetPending();
  }

  // --- visual block ---

  private blockGeom(): { r0: number; r1: number; c0: number; c1: number } {
    const a = this.visualAnchor!;
    const c = this.cursor;
    return {
      r0: Math.min(a.row, c.row),
      r1: Math.max(a.row, c.row),
      c0: Math.min(a.col, c.col),
      c1: Math.max(a.col, c.col),
    };
  }

  /** Pad a line with spaces so column `col` exists; returns col. */
  private padTo(row: number, col: number): number {
    const line = this.buf.line(row);
    if (line.length < col) this.buf.replaceLine(row, line + " ".repeat(col - line.length));
    return col;
  }

  private applyBlockOperator(op: string): void {
    const { r0, r1, c0, c1 } = this.blockGeom();
    if (op === "y" || op === "d") {
      if (op === "d") this.pushUndo();
      const slices: string[] = [];
      for (let r = r0; r <= r1; r++) {
        const line = this.buf.line(r);
        const start = Math.min(c0, line.length);
        const end = Math.min(c1 + 1, line.length);
        slices.push(line.slice(start, end));
        if (op === "d") this.buf.replaceLine(r, line.slice(0, start) + line.slice(end));
      }
      this.setRegister({ text: slices.join("\n"), wise: "charwise" });
      this.cursor = clampNormal(this.buf, { row: r0, col: c0 });
      this.exitVisualTo("normal");
      if (op === "d") {
        this.emit({ type: "edit", kind: "delete", at: this.cursor });
        this.commitChange();
      }
      return;
    }
    if (op === "c") {
      this.pushUndo();
      for (let r = r0; r <= r1; r++) {
        const line = this.buf.line(r);
        const start = Math.min(c0, line.length);
        const end = Math.min(c1 + 1, line.length);
        this.buf.replaceLine(r, line.slice(0, start) + line.slice(end));
      }
      this.beginBlockInsert(r0, r1, c0);
      return;
    }
    // Other operators on a block are not supported — treat as a no-op exit.
    this.exitVisualTo("normal");
    this.resetPending();
  }

  /** Enter block insert (I/A/c): type on the top row, replicate to the rest on <Esc>. */
  private beginBlockInsert(r0: number, r1: number, col: number): void {
    const rows: number[] = [];
    for (let r = r0; r <= r1; r++) rows.push(r);
    this.blockInsert = { rows, col };
    this.padTo(r0, col);
    this.visualAnchor = null;
    this.cursor = { row: r0, col };
    const from = this.mode;
    this.mode = "insert";
    this.emit({ type: "mode", from, to: "insert" });
    this.pendingCount = "";
    this.pendingOperator = null;
  }

  private startBlockInsert(append: boolean): void {
    const { r0, r1, c0, c1 } = this.blockGeom();
    this.pushUndo();
    this.beginBlockInsert(r0, r1, append ? c1 + 1 : c0);
  }

  /** On leaving block insert, copy the text typed on the top row to every other row. */
  private finishBlockInsert(): void {
    const bi = this.blockInsert;
    this.blockInsert = null;
    if (!bi) return;
    const r0 = bi.rows[0]!;
    const typed = this.buf.line(r0).slice(bi.col, this.cursor.col);
    if (typed === "") return;
    for (const r of bi.rows) {
      if (r === r0) continue;
      const at = this.padTo(r, bi.col);
      this.buf.insertAt({ row: r, col: at }, typed);
    }
  }

  private exitVisualTo(mode: Mode): void {
    const from = this.mode;
    this.mode = mode;
    this.visualAnchor = null;
    if (from !== mode) this.emit({ type: "mode", from, to: mode });
    this.resetPending();
  }

  private doYank(range: OpRange): void {
    let text: string;
    if (range.wise === "linewise") {
      text = this.buf.lines.slice(range.startRow, range.endRow + 1).join("\n") + "\n";
    } else {
      text = sliceCharwise(this.buf, range.start, range.end);
    }
    this.setRegister({ text, wise: range.wise });
    this.emit({ type: "yank", text, wise: range.wise });
  }

  private doDelete(range: OpRange): void {
    this.pushUndo();
    let removed: string;
    if (range.wise === "linewise") {
      removed = this.buf.deleteLines(range.startRow, range.endRow);
      this.setRegister({ text: removed, wise: "linewise" });
      const row = Math.min(range.startRow, this.buf.lineCount - 1);
      this.cursor = clampNormal(this.buf, { row, col: firstNonBlankCol(this.buf, row) });
    } else {
      removed = this.buf.deleteRange(range.start, range.end);
      this.setRegister({ text: removed, wise: "charwise" });
      this.cursor = clampNormal(this.buf, range.start);
    }
    this.emit({ type: "edit", kind: "delete", at: this.cursor, text: removed });
    this.commitChange();
  }

  private doChange(range: OpRange): void {
    this.pushUndo();
    if (range.wise === "linewise") {
      // Change lines: clear them to one empty line and enter insert.
      const removed = this.buf.lines.slice(range.startRow, range.endRow + 1).join("\n") + "\n";
      this.setRegister({ text: removed, wise: "linewise" });
      this.buf.lines.splice(range.startRow, range.endRow - range.startRow + 1, "");
      this.cursor = { row: range.startRow, col: 0 };
    } else {
      const removed = this.buf.deleteRange(range.start, range.end);
      this.setRegister({ text: removed, wise: "charwise" });
      this.cursor = { row: range.start.row, col: range.start.col };
    }
    this.emit({ type: "edit", kind: "change", at: this.cursor });
    this.enterInsert(false);
  }

  // --- non-motion actions ---

  private handleAction(token: KeyToken): void {
    switch (token) {
      case "x": {
        this.deleteCharsUnderCursor(this.takeCount());
        return;
      }
      case "X": {
        this.deleteCharsBeforeCursor(this.takeCount());
        return;
      }
      case "D": {
        this.operateToLineEnd("d");
        return;
      }
      case "C": {
        this.operateToLineEnd("c");
        return;
      }
      case "s": {
        this.pushUndo();
        this.deleteCharsUnderCursor(this.takeCount(), true);
        this.enterInsert(false);
        return;
      }
      case "S": {
        this.operateLinewise("c", this.cursor.row, this.cursor.row);
        this.resetPending();
        return;
      }
      case "r": {
        this.waiting = { kind: "replace" };
        return;
      }
      case "~": {
        this.toggleCase(this.takeCount());
        return;
      }
      case "J": {
        this.joinLines(Math.max(2, this.takeCount()));
        return;
      }
      case "p": {
        this.paste(true, this.takeCount());
        return;
      }
      case "P": {
        this.paste(false, this.takeCount());
        return;
      }
      case "u": {
        this.undo();
        this.resetPending();
        return;
      }
      case "<C-r>": {
        this.redo();
        this.resetPending();
        return;
      }
      case ".": {
        this.repeatLastChange();
        return;
      }
      case "i":
        this.pushUndo();
        this.enterInsert(false);
        return;
      case "I":
        this.pushUndo();
        this.cursor = { row: this.cursor.row, col: firstNonBlankCol(this.buf, this.cursor.row) };
        this.enterInsert(false);
        return;
      case "a":
        this.pushUndo();
        this.cursor = { row: this.cursor.row, col: Math.min(this.buf.lineLen(this.cursor.row), this.cursor.col + 1) };
        this.enterInsert(false);
        return;
      case "A":
        this.pushUndo();
        this.cursor = { row: this.cursor.row, col: this.buf.lineLen(this.cursor.row) };
        this.enterInsert(false);
        return;
      case "o":
        this.pushUndo();
        this.openLine(true);
        return;
      case "O":
        this.pushUndo();
        this.openLine(false);
        return;
      case "v":
        this.enterVisual("visual");
        return;
      case "V":
        this.enterVisual("visual-line");
        return;
      case "<Esc>":
        if (this.isVisual()) this.exitVisual();
        else this.resetPending();
        return;
      default:
        this.resetPending();
        this.bell();
        return;
    }
  }

  private deleteCharsUnderCursor(count: number, forChange = false): void {
    const line = this.buf.line(this.cursor.row);
    if (line.length === 0) {
      if (!forChange) this.bell();
      return;
    }
    if (!forChange) this.pushUndo();
    const end = Math.min(line.length, this.cursor.col + count);
    const removed = this.buf.deleteRange(this.cursor, { row: this.cursor.row, col: end });
    this.setRegister({ text: removed, wise: "charwise" });
    if (!forChange) {
      this.cursor = clampNormal(this.buf, this.cursor);
      this.emit({ type: "edit", kind: "delete", at: this.cursor, text: removed });
      this.commitChange();
    }
  }

  private deleteCharsBeforeCursor(count: number): void {
    const start = Math.max(0, this.cursor.col - count);
    if (start === this.cursor.col) return this.bell();
    this.pushUndo();
    const removed = this.buf.deleteRange({ row: this.cursor.row, col: start }, this.cursor);
    this.setRegister({ text: removed, wise: "charwise" });
    this.cursor = { row: this.cursor.row, col: start };
    this.emit({ type: "edit", kind: "delete", at: this.cursor, text: removed });
    this.commitChange();
  }

  private operateToLineEnd(op: string): void {
    const range: OpRange = {
      wise: "charwise",
      start: this.cursor,
      end: { row: this.cursor.row, col: this.buf.lineLen(this.cursor.row) },
      startRow: this.cursor.row,
      endRow: this.cursor.row,
    };
    this.applyOperator(op, range);
    this.resetPending();
  }

  private doReplaceChar(token: KeyToken): void {
    if (token.length !== 1) {
      this.resetPending();
      return this.bell();
    }
    const count = this.takeCount();
    const line = this.buf.line(this.cursor.row);
    if (this.cursor.col + count > line.length) return this.bell();
    this.pushUndo();
    const rep = token.repeat(count);
    this.buf.replaceLine(
      this.cursor.row,
      line.slice(0, this.cursor.col) + rep + line.slice(this.cursor.col + count),
    );
    this.cursor = { row: this.cursor.row, col: this.cursor.col + count - 1 };
    this.emit({ type: "edit", kind: "replace", at: this.cursor, text: rep });
    this.commitChange();
  }

  private toggleCase(count: number): void {
    const line = this.buf.line(this.cursor.row);
    if (line.length === 0) return;
    this.pushUndo();
    const end = Math.min(line.length, this.cursor.col + count);
    let out = line.slice(0, this.cursor.col);
    for (let i = this.cursor.col; i < end; i++) {
      const c = line[i]!;
      out += c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase();
    }
    out += line.slice(end);
    this.buf.replaceLine(this.cursor.row, out);
    this.cursor = clampNormal(this.buf, { row: this.cursor.row, col: end });
    this.emit({ type: "edit", kind: "replace", at: this.cursor });
    this.commitChange();
  }

  private joinLines(count: number): void {
    if (this.cursor.row >= this.buf.lineCount - 1) return this.bell();
    this.pushUndo();
    const times = Math.min(count - 1, this.buf.lineCount - 1 - this.cursor.row);
    let joinCol = 0;
    for (let i = 0; i < times; i++) {
      const cur = this.buf.line(this.cursor.row);
      const next = this.buf.line(this.cursor.row + 1).replace(/^\s+/, "");
      joinCol = cur.length;
      const sep = cur.endsWith(" ") || cur.length === 0 || next.length === 0 ? "" : " ";
      this.buf.replaceLine(this.cursor.row, cur + sep + next);
      this.buf.lines.splice(this.cursor.row + 1, 1);
    }
    this.cursor = clampNormal(this.buf, { row: this.cursor.row, col: joinCol });
    this.emit({ type: "edit", kind: "join", at: this.cursor });
    this.commitChange();
  }

  private paste(after: boolean, count: number): void {
    const reg = this.getRegister();
    if (!reg || reg.text === "") return this.bell();
    this.pushUndo();
    if (reg.wise === "linewise") {
      const text = reg.text.endsWith("\n") ? reg.text.slice(0, -1) : reg.text;
      const newLines = text.split("\n");
      const insertAt = after ? this.cursor.row + 1 : this.cursor.row;
      const repeated: string[] = [];
      for (let i = 0; i < count; i++) repeated.push(...newLines);
      this.buf.lines.splice(insertAt, 0, ...repeated);
      this.cursor = { row: insertAt, col: firstNonBlankCol(this.buf, insertAt) };
    } else {
      const text = reg.text.repeat(count);
      const col = after ? Math.min(this.buf.lineLen(this.cursor.row), this.cursor.col + 1) : this.cursor.col;
      const endPos = this.buf.insertAt({ row: this.cursor.row, col }, text);
      this.cursor = clampNormal(this.buf, { row: endPos.row, col: Math.max(col, endPos.col - 1) });
    }
    this.emit({ type: "edit", kind: "paste", at: this.cursor, text: reg.text });
    this.commitChange();
  }

  // --- insert mode ---

  private enterInsert(fromCommand: boolean): void {
    const from = this.mode;
    this.mode = "insert";
    this.visualAnchor = null;
    if (from !== "insert") this.emit({ type: "mode", from, to: "insert" });
    // Pending state is cleared but cmdTokens continue to accumulate for dot-repeat.
    this.pendingCount = "";
    this.pendingOperator = null;
    this.gPending = false;
    this.waiting = null;
    void fromCommand;
  }

  private openLine(below: boolean): void {
    const row = below ? this.cursor.row + 1 : this.cursor.row;
    this.buf.insertLine(row, "");
    this.cursor = { row, col: 0 };
    this.emit({ type: "edit", kind: "insert", at: this.cursor });
    this.enterInsert(false);
  }

  private handleInsert(token: KeyToken): void {
    if (token === "<Esc>") {
      if (this.blockInsert) this.finishBlockInsert(); // replicate typed text across the block
      this.mode = "normal";
      this.cursor = clampNormal(this.buf, { row: this.cursor.row, col: Math.max(0, this.cursor.col - 1) });
      this.emit({ type: "mode", from: "insert", to: "normal" });
      this.commitChange();
      return;
    }
    if (token === "<BS>") {
      if (this.cursor.col > 0) {
        this.buf.deleteChar({ row: this.cursor.row, col: this.cursor.col - 1 });
        this.cursor = { row: this.cursor.row, col: this.cursor.col - 1 };
      } else if (this.cursor.row > 0) {
        const prevLen = this.buf.lineLen(this.cursor.row - 1);
        const cur = this.buf.line(this.cursor.row);
        this.buf.replaceLine(this.cursor.row - 1, this.buf.line(this.cursor.row - 1) + cur);
        this.buf.lines.splice(this.cursor.row, 1);
        this.cursor = { row: this.cursor.row - 1, col: prevLen };
      }
      this.emit({ type: "edit", kind: "delete", at: this.cursor });
      return;
    }
    if (token === "<CR>") {
      const endPos = this.buf.insertAt(this.cursor, "\n");
      this.cursor = endPos;
      this.emit({ type: "edit", kind: "insert", at: this.cursor, text: "\n" });
      return;
    }
    if (token === "<Tab>") {
      this.insertText("  ");
      return;
    }
    if (token === "<Space>") {
      this.insertText(" ");
      return;
    }
    if (token === "<Left>") {
      this.cursor = { row: this.cursor.row, col: Math.max(0, this.cursor.col - 1) };
      return;
    }
    if (token === "<Right>") {
      this.cursor = { row: this.cursor.row, col: Math.min(this.buf.lineLen(this.cursor.row), this.cursor.col + 1) };
      return;
    }
    // Printable character.
    if (token.length === 1) this.insertText(token);
  }

  private insertText(text: string): void {
    const endPos = this.buf.insertAt(this.cursor, text);
    this.cursor = endPos;
    this.emit({ type: "edit", kind: "insert", at: this.cursor, text });
  }

  // --- visual mode ---

  private isVisual(): boolean {
    return this.mode === "visual" || this.mode === "visual-line" || this.mode === "visual-block";
  }

  private enterVisual(mode: Mode): void {
    if (this.mode === mode) {
      this.exitVisual();
      return;
    }
    const from = this.mode;
    this.mode = mode;
    this.visualAnchor = clonePos(this.cursor);
    this.emit({ type: "mode", from, to: mode });
  }

  private exitVisual(): void {
    const from = this.mode;
    this.mode = "normal";
    this.visualAnchor = null;
    this.resetPending();
    this.emit({ type: "mode", from, to: "normal" });
  }

  // --- registers ---

  private setRegister(reg: Register): void {
    const name = this.pendingRegister;
    if (name && name !== '"') this.registers.set(name, reg);
    this.registers.set('"', reg); // unnamed always updated
  }

  private getRegister(): Register | undefined {
    const name = this.pendingRegister ?? '"';
    return this.registers.get(name) ?? this.registers.get('"');
  }

  // --- undo / redo / dot ---

  private snapshot(): Snapshot {
    return { lines: [...this.buf.lines], cursor: clonePos(this.cursor) };
  }

  private pushUndo(): void {
    if (this.replayingUndo) return;
    this.undoStack.push(this.snapshot());
    this.redoStack = [];
    if (this.undoStack.length > 500) this.undoStack.shift();
  }
  private replayingUndo = false;

  private undo(): void {
    const snap = this.undoStack.pop();
    if (!snap) return this.bell();
    this.redoStack.push(this.snapshot());
    this.buf.lines = [...snap.lines];
    this.cursor = clampNormal(this.buf, snap.cursor);
    this.emit({ type: "edit", kind: "undo", at: this.cursor });
  }

  private redo(): void {
    const snap = this.redoStack.pop();
    if (!snap) return this.bell();
    this.undoStack.push(this.snapshot());
    this.buf.lines = [...snap.lines];
    this.cursor = clampNormal(this.buf, snap.cursor);
    this.emit({ type: "edit", kind: "redo", at: this.cursor });
  }

  private commitChange(): void {
    if (this.replaying) return;
    if (this.cmdTokens.length > 0) this.lastChange = [...this.cmdTokens];
    this.cmdTokens = [];
    this.resetPending();
  }

  private repeatLastChange(): void {
    if (!this.lastChange) return this.bell();
    const tokens = this.lastChange;
    this.resetPending();
    this.replaying = true;
    try {
      for (const t of tokens) this.feedKey(t);
    } finally {
      this.replaying = false;
    }
  }

  // --- pending / counts ---

  private peekCount(): number {
    const c = this.pendingCount === "" ? 1 : parseInt(this.pendingCount, 10);
    return Math.max(1, c);
  }
  private takeCount(): number {
    const c = this.peekCount();
    this.pendingCount = "";
    return c;
  }

  private resetPending(): void {
    this.pendingCount = "";
    this.opCount = 1;
    this.pendingOperator = null;
    this.pendingRegister = null;
    this.gPending = false;
    this.waiting = null;
  }

  private clampCursor(): void {
    this.cursor = clampNormal(this.buf, this.cursor);
  }
}

// --- helpers ---

function firstNonBlankCol(buf: TextBuffer, row: number): number {
  const idx = buf.line(row).search(/\S/);
  return idx < 0 ? 0 : idx;
}

function sliceCharwise(buf: TextBuffer, start: Pos, end: Pos): string {
  if (start.row === end.row) return buf.line(start.row).slice(start.col, end.col);
  let out = buf.line(start.row).slice(start.col) + "\n";
  for (let r = start.row + 1; r < end.row; r++) out += buf.line(r) + "\n";
  out += buf.line(end.row).slice(0, end.col);
  return out;
}

/** Split a human key string into tokens: "<Esc>" stays whole, "dw" -> ["d","w"]. */
export function tokenize(keys: string): KeyToken[] {
  const out: KeyToken[] = [];
  let i = 0;
  while (i < keys.length) {
    if (keys[i] === "<") {
      const close = keys.indexOf(">", i);
      if (close > i) {
        out.push(keys.slice(i, close + 1));
        i = close + 1;
        continue;
      }
    }
    out.push(keys[i]!);
    i++;
  }
  return out;
}
