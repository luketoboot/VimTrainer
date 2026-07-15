// Golf — transform the start buffer into the target buffer in as few keystrokes as
// possible. Uses the full Vim engine (operators, text objects, dot-repeat). A live
// diff shows what's left; beating par earns stars. This teaches efficient editing.

import { VimEngine } from "../engine/engine.ts";
import type { KeyToken } from "../engine/keymap.ts";
import { drawBuffer } from "../render/bufferView.ts";
import type { GolfPuzzle } from "../levels/curriculum.ts";
import { Storage } from "../core/storage.ts";
import { contextForEngine, engineWantsEsc, type RemapContext } from "../core/keybinds.ts";
import type { GameMode, GameServices, ModeResult } from "./mode.ts";

export class GolfMode implements GameMode {
  private svc: GameServices;
  private puzzle: GolfPuzzle;
  private engine = new VimEngine();
  private targetText: string;

  private keystrokes = 0;
  private lastKey = "";
  private solveFade = 0;

  done = false;
  private result: ModeResult | null = null;

  constructor(svc: GameServices, puzzle: GolfPuzzle) {
    this.svc = svc;
    this.puzzle = puzzle;
    this.targetText = puzzle.target.join("\n");
  }

  init(): void {
    this.engine.load(this.puzzle.start, this.puzzle.startCursor ?? { row: 0, col: 0 });
    this.svc.audio.play("start");
  }

  remapContext(): RemapContext {
    return contextForEngine(this.engine);
  }

  wantsEsc(): boolean {
    return engineWantsEsc(this.engine);
  }

  handleKey(token: KeyToken): void {
    if (this.done) return;
    this.svc.coach.observe(token, this.remapContext());
    this.lastKey = token;
    this.keystrokes++;
    const events = this.engine.feedKey(token);
    for (const e of events) {
      if (e.type === "bell") this.svc.audio.play("error");
      else if (e.type === "edit") this.svc.audio.play("move");
    }
    if (this.engine.getText() === this.targetText) this.onSolved();
  }

  private onSolved(): void {
    this.solveFade = 1;
    let stars = 1;
    if (this.keystrokes <= this.puzzle.par) stars = 3;
    else if (this.keystrokes <= Math.round(this.puzzle.par * 1.5)) stars = 2;

    const isBest = this.recordBest(stars);
    const px = this.svc.term.gridToPixel(this.engine.cursor.row, this.engine.cursor.col);
    this.svc.particles.burst(px.x, px.y, { color: this.svc.term.theme.accent, count: 26, chars: "*+·" });
    this.svc.flash.trigger(this.svc.term.theme.accent, 0.3, 4);
    this.svc.audio.play(stars === 3 ? "perfect" : "combo");

    this.done = true;
    this.result = {
      levelId: this.puzzle.id,
      title: this.puzzle.title,
      score: this.keystrokes,
      stars,
      lines: [
        "SOLVED!",
        `${this.keystrokes} keystrokes   (par ${this.puzzle.par})`,
        stars === 3 ? "under par — surgical!" : stars === 2 ? "over par, but solved" : "solved the long way",
        isBest ? "NEW BEST!" : `best: ${Storage.getHighScore(this.puzzle.id)} keys`,
      ],
    };
  }

  /** Golf is a low-score-is-better game, so we store the negated keystrokes as "score". */
  private recordBest(stars: number): boolean {
    const prevRaw = Storage.getHighScore(this.puzzle.id); // stored as (10000 - keys)
    const encoded = 10000 - this.keystrokes;
    const isBest = encoded > prevRaw;
    Storage.recordScore(this.puzzle.id, isBest ? encoded : prevRaw, stars);
    return isBest;
  }

  update(dt: number): void {
    if (this.solveFade > 0) this.solveFade = Math.max(0, this.solveFade - dt);
  }

  getResult(): ModeResult | null {
    return this.result;
  }

  render(): void {
    const term = this.svc.term;
    const th = term.theme;
    term.clear();

    term.drawText(0, 0, this.puzzle.hint.slice(0, term.cols), { fg: th.dim });

    const workRow = 2;
    term.drawText(workRow - 1 < 0 ? 0 : 1, 0, "── your buffer ─────────────", { fg: th.accent });
    drawBuffer(term, this.engine.getView(), { screenRow: workRow });

    const workLines = this.engine.lines.length;
    const targetLabelRow = workRow + workLines + 1;
    term.drawText(targetLabelRow, 0, "── target ──────────────────", { fg: th.accentAlt });

    const cur = this.engine.lines;
    this.puzzle.target.forEach((line, i) => {
      const match = cur[i] === line;
      term.drawText(targetLabelRow + 1 + i, 2, line, {
        fg: match ? th.dim : th.danger,
        bold: !match,
      });
      term.drawText(targetLabelRow + 1 + i, 0, match ? "✓" : "≠", {
        fg: match ? th.fg : th.danger,
      });
    });

    this.svc.flash.render(term.context, term.canvas.width, term.canvas.height);
    this.svc.particles.render(term.context, term.theme.fontFamily);

    const parState =
      this.keystrokes <= this.puzzle.par
        ? "on pace"
        : this.keystrokes <= this.puzzle.par * 1.5
        ? "over par"
        : "well over";
    const cmd = this.engine.getView().cmdline;
    term.drawStatusLine(
      cmd
        ? ` ${cmd}`
        : ` ${this.puzzle.title}   keys ${this.keystrokes} / par ${this.puzzle.par}  (${parState})`,
      `${this.engine.mode.toUpperCase()}   key ${this.lastKey || "—"} `,
    );
  }
}
