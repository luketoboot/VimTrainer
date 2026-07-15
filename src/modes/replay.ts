// Replay — plays a golf puzzle's canonical par solution key-by-key so the
// player can SEE the efficient way after their own attempt. Entered from the
// result screen; exits back to it (getResult returns the original run's
// result, so the app's normal done-routing lands there).

import { VimEngine, tokenize } from "../engine/engine.ts";
import type { KeyToken } from "../engine/keymap.ts";
import { drawBuffer } from "../render/bufferView.ts";
import type { GolfPuzzle } from "../levels/curriculum.ts";
import type { RemapContext } from "../core/keybinds.ts";
import type { GameMode, GameServices, ModeResult } from "./mode.ts";

const STEP_SECONDS = 0.55; // time between replayed keys — slow enough to read

/** Pretty-print a key token for the tape. */
function keyLabel(token: KeyToken): string {
  switch (token) {
    case "<Esc>":
      return "Esc";
    case "<CR>":
      return "⏎";
    case "<Space>":
      return "␣";
    case "<C-v>":
      return "^V";
    case "<BS>":
      return "⌫";
    default:
      return token;
  }
}

export class ReplayMode implements GameMode {
  private svc: GameServices;
  private puzzle: GolfPuzzle;
  private returnTo: ModeResult;
  private engine = new VimEngine();
  private tokens: KeyToken[];
  private played = 0;
  private timer = 1.0; // opening beat before the first key
  private finishedFor = 0;

  done = false;

  constructor(svc: GameServices, puzzle: GolfPuzzle, returnTo: ModeResult) {
    this.svc = svc;
    this.puzzle = puzzle;
    this.returnTo = returnTo;
    this.tokens = tokenize(puzzle.solution);
  }

  init(): void {
    this.engine.load(this.puzzle.start, this.puzzle.startCursor ?? { row: 0, col: 0 });
    this.svc.audio.play("start");
  }

  remapContext(): RemapContext {
    return "literal"; // replay controls are never remapped
  }

  wantsEsc(): boolean {
    return true; // we consume Esc ourselves to exit back to the result screen
  }

  handleKey(token: KeyToken): void {
    if (token === "<Esc>" || token === "<CR>" || token === "<Space>" || token === "q") {
      this.done = true;
    }
  }

  update(dt: number): void {
    if (this.done) return;
    if (this.played >= this.tokens.length) {
      this.finishedFor += dt;
      return;
    }
    this.timer -= dt;
    if (this.timer <= 0) {
      const tok = this.tokens[this.played++]!;
      this.engine.feedKey(tok);
      this.svc.audio.play("move");
      // Hold a touch longer on mode-changing keys so the effect can register.
      this.timer = tok === "<Esc>" || tok === "<CR>" ? STEP_SECONDS * 1.5 : STEP_SECONDS;
    }
  }

  getResult(): ModeResult | null {
    return this.returnTo; // routes the app straight back to the result screen
  }

  render(): void {
    const term = this.svc.term;
    const th = term.theme;
    term.clear();

    term.drawText(0, 0, `PAR SOLUTION — ${this.puzzle.title}`, { fg: th.accent, bold: true });

    // The key tape: played keys bright, current key highlighted, rest dim.
    let col = 0;
    this.tokens.forEach((tok, i) => {
      const label = keyLabel(tok);
      const current = i === this.played - 1;
      term.drawText(1, col, label, {
        fg: i < this.played ? (current ? th.accent : th.fg) : th.dim,
        bold: current,
        bg: current ? th.statusBg : undefined,
      });
      col += label.length + 1;
    });

    const workRow = 3;
    drawBuffer(term, this.engine.getView(), { screenRow: workRow });

    const targetRow = workRow + this.engine.lines.length + 1;
    term.drawText(targetRow, 0, "── target ──────────────────", { fg: th.accentAlt });
    this.puzzle.target.forEach((line, i) => {
      const match = this.engine.lines[i] === line;
      term.drawText(targetRow + 1 + i, 2, line, { fg: match ? th.dim : th.statusFg });
      term.drawText(targetRow + 1 + i, 0, match ? "✓" : "≠", { fg: match ? th.fg : th.dim });
    });

    const doneMsg =
      this.played >= this.tokens.length
        ? `solved in ${this.tokens.length} keys (par ${this.puzzle.par})`
        : `key ${this.played}/${this.tokens.length}`;
    term.drawStatusLine(` ${doneMsg} `, "Esc — back ");
  }
}
