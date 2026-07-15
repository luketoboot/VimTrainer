// Hotfix — the "realistic day at work" mode. Tickets stream in one at a time:
// each names an edit in plain words and highlights where it happens. You race
// the deploy clock — navigate there, make the edit (in and out of insert mode,
// operators, ex commands), and every closed ticket refunds seconds. When the
// queue is empty you ship the build the way you'd really do it: :wq.
//
// The expected buffer for each ticket is derived by replaying its canonical
// `ideal` keys on a scratch engine, so ANY technique that produces the same
// text closes the ticket — the ideal is just the par used for ratings.

import { VimEngine, tokenize } from "../engine/engine.ts";
import type { KeyToken } from "../engine/keymap.ts";
import { drawBuffer } from "../render/bufferView.ts";
import { wrapText } from "../render/text.ts";
import type { HotfixLevel } from "../levels/hotfix.ts";
import { Storage } from "../core/storage.ts";
import { contextForEngine, engineWantsEsc, type RemapContext } from "../core/keybinds.ts";
import type { GameMode, GameServices, ModeResult } from "./mode.ts";

// Grid row where the buffer starts: ticket header + two wrapped ticket lines
// + one blank row. Fixed so the buffer doesn't jump between tickets.
const PLAY_ROW = 4;

/** A closed ticket is "clean" within this many keys over the ideal. */
const CLEAN_MARGIN = 2;

export class HotfixMode implements GameMode {
  private svc: GameServices;
  private level: HotfixLevel;
  private engine = new VimEngine();

  /** Buffer text expected after each ticket, derived from the ideal chain. */
  private expected: string[] = [];
  private idealLens: number[] = [];

  private index = 0;
  private phase: "fix" | "ship" = "fix";
  private timeLeft: number;
  private keysThisTask = 0;
  private totalKeys = 0;
  private cleanFixes = 0;
  private combo = 0;
  private comboMax = 0;
  private score = 0;
  private blink = 0;
  private bonusFlash = 0; // "+Ns" popup after a fix
  private warnFlash = 0; // ":wq before the queue is empty" nudge

  done = false;
  private result: ModeResult | null = null;

  constructor(svc: GameServices, level: HotfixLevel) {
    this.svc = svc;
    this.level = level;
    this.timeLeft = level.startTime;
  }

  init(): void {
    this.engine.load(this.level.buffer, { row: 0, col: 0 });
    const scratch = new VimEngine();
    scratch.load(this.level.buffer, { row: 0, col: 0 });
    for (const t of this.level.tasks) {
      const tokens = tokenize(t.ideal);
      for (const tok of tokens) scratch.feedKey(tok);
      this.expected.push(scratch.getText());
      this.idealLens.push(tokens.length);
    }
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
    this.keysThisTask++;
    this.totalKeys++;

    // Catch the write command while the cmdline still holds it — the engine
    // accepts :w/:wq/:x as no-ops, so this is where "ship it" is detected.
    const cmd = this.engine.getView().cmdline;
    const wroteFile = token === "<CR>" && cmd !== null && /^:(w|wq|x)$/.test(cmd);

    const events = this.engine.feedKey(token);
    for (const e of events) {
      if (e.type === "bell") this.svc.audio.play("error");
      else if (e.type === "edit") this.svc.audio.play("move");
    }

    if (wroteFile) {
      if (this.phase === "ship") this.ship();
      else this.warnFlash = 1.5; // nice instinct — but the queue isn't empty
      return;
    }
    if (this.phase === "fix" && this.engine.getText() === this.expected[this.index]) {
      this.closeTicket();
    }
  }

  private closeTicket(): void {
    const ideal = this.idealLens[this.index]!;
    const clean = this.keysThisTask <= ideal + CLEAN_MARGIN;
    if (clean) {
      this.cleanFixes++;
      this.combo++;
    } else {
      this.combo = 0;
    }
    this.comboMax = Math.max(this.comboMax, this.combo);
    this.score += (clean ? 120 : 60) + this.combo * 20;
    this.timeLeft += this.level.bonusTime;
    this.bonusFlash = 1;

    const t = this.level.tasks[this.index]!;
    const px = this.svc.term.gridToPixel(t.target.row + PLAY_ROW, t.target.col);
    this.svc.particles.burst(px.x, px.y, {
      color: clean ? this.svc.term.theme.accent : this.svc.term.theme.fg,
      count: clean ? 22 : 12,
      chars: "*+·",
    });
    this.svc.flash.trigger(this.svc.term.theme.accent, clean ? 0.25 : 0.14, 5);
    this.svc.audio.play(clean && this.combo >= 3 ? "combo" : clean ? "perfect" : "land");

    this.index++;
    this.keysThisTask = 0;
    if (this.index >= this.level.tasks.length) {
      this.phase = "ship";
      this.svc.audio.play("combo");
    }
  }

  private ship(): void {
    const timeBonus = Math.floor(this.timeLeft * 15);
    this.score += timeBonus;
    const n = this.level.tasks.length;
    const stars = this.cleanFixes >= Math.ceil(n * 0.8) ? 3 : this.cleanFixes >= Math.ceil(n * 0.4) ? 2 : 1;
    const isBest = Storage.recordScore(this.level.id, this.score, stars);
    this.done = true;
    this.result = {
      levelId: this.level.id,
      title: this.level.title,
      score: this.score,
      stars,
      lines: [
        "SHIPPED!",
        `${n}/${n} tickets closed   clean fixes: ${this.cleanFixes}/${n}`,
        `${this.timeLeft.toFixed(1)}s to spare (+${timeBonus})   max combo x${this.comboMax}`,
        isBest ? "NEW BEST!" : `best: ${Storage.getHighScore(this.level.id)}`,
      ],
    };
    this.svc.audio.play("perfect");
  }

  private failBuild(): void {
    const isBest = Storage.recordScore(this.level.id, this.score, 0);
    this.done = true;
    this.result = {
      levelId: this.level.id,
      title: this.level.title,
      score: this.score,
      stars: 0,
      lines: [
        "OUT OF TIME — the build never shipped",
        `${this.index}/${this.level.tasks.length} tickets closed`,
        "close tickets faster: every fix buys more seconds",
        isBest ? "NEW BEST!" : `best: ${Storage.getHighScore(this.level.id)}`,
      ],
    };
    this.svc.audio.play("error");
  }

  update(dt: number): void {
    if (this.done) return;
    this.blink += dt;
    if (this.bonusFlash > 0) this.bonusFlash = Math.max(0, this.bonusFlash - dt);
    if (this.warnFlash > 0) this.warnFlash = Math.max(0, this.warnFlash - dt);
    this.timeLeft -= dt;
    if (this.timeLeft <= 0) {
      this.timeLeft = 0;
      this.failBuild();
    }
  }

  getResult(): ModeResult | null {
    return this.result;
  }

  render(): void {
    const term = this.svc.term;
    const th = term.theme;
    term.clear();

    const n = this.level.tasks.length;
    const width = Math.max(20, term.cols - 2);
    if (this.phase === "fix") {
      const t = this.level.tasks[this.index]!;
      term.drawText(0, 0, `TICKET ${this.index + 1}/${n}   queue: ${"▮".repeat(n - this.index)}`, { fg: th.dim });
      wrapText(t.desc, width, 2).forEach((line, i) => {
        term.drawText(1 + i, 0, line, { fg: th.fg, bold: true });
      });
    } else {
      term.drawText(0, 0, "queue empty — every ticket closed", { fg: th.dim });
      const hot = Math.floor(this.blink * 3) % 2 === 0;
      term.drawText(1, 0, "SHIP IT: type :wq then Enter", { fg: hot ? th.accent : th.accentAlt, bold: true });
    }
    if (this.bonusFlash > 0) {
      const label = `+${this.level.bonusTime}s`;
      term.drawText(0, Math.max(0, term.cols - label.length - 1), label, { fg: th.accentAlt, bold: true });
    }
    if (this.warnFlash > 0) {
      term.drawText(2, 0, "not yet — tickets still open!", { fg: th.danger, bold: true });
    }

    const highlights =
      this.phase === "fix"
        ? [{ pos: this.level.tasks[this.index]!.target, bg: th.accent }]
        : [];
    drawBuffer(term, this.engine.getView(), { screenRow: PLAY_ROW, highlights });

    this.svc.flash.render(term.context, term.canvas.width, term.canvas.height);
    this.svc.particles.render(term.context, th.fontFamily);

    const urgent = this.timeLeft < 10;
    const timeStr = `⏱ ${this.timeLeft.toFixed(1)}s`;
    if (urgent && Math.floor(this.blink * 4) % 2 === 0) {
      // Blink the countdown onto the buffer's blank row when it gets dire.
      term.drawText(PLAY_ROW - 1, Math.max(0, term.cols - timeStr.length - 1), timeStr, { fg: th.danger, bold: true });
    }
    const comboStr = this.combo > 1 ? `  x${this.combo}` : "";
    const cmd = this.engine.getView().cmdline;
    term.drawStatusLine(
      cmd ? ` ${cmd}` : ` ${this.level.title}  ${timeStr}${comboStr}`,
      `score ${this.score}  ${this.engine.mode.toUpperCase()} `,
    );
  }
}
