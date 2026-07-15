// Cursor Rush — race the cursor onto highlighted targets using the fewest keystrokes.
// The scoring rewards covering distance in fewer keys than a naive hjkl walk, which
// directly trains the habit of reaching for motions (w, f, gg, counts) over arrows.

import { VimEngine } from "../engine/engine.ts";
import type { KeyToken } from "../engine/keymap.ts";
import type { Pos } from "../engine/types.ts";
import { drawBuffer } from "../render/bufferView.ts";
import type { CursorRushLevel } from "../levels/curriculum.ts";
import { Storage } from "../core/storage.ts";
import { contextForEngine, engineWantsEsc, type RemapContext } from "../core/keybinds.ts";
import type { GameMode, GameServices, ModeResult } from "./mode.ts";

interface Rating {
  label: string;
  color: string;
}

export class CursorRushMode implements GameMode {
  private svc: GameServices;
  private level: CursorRushLevel;
  private engine = new VimEngine();

  private target: Pos = { row: 0, col: 0 };
  private spawnFrom: Pos = { row: 0, col: 0 };
  private keysThisTarget = 0;
  private timeThisTarget = 0;

  private timeLeft: number;
  private score = 0;
  private combo = 0;
  private comboMax = 0;
  private targetsHit = 0;
  private totalKeys = 0;
  private lastKey = "";
  private lastRating: Rating | null = null;
  private ratingFade = 0;

  done = false;
  private result: ModeResult | null = null;

  constructor(svc: GameServices, level: CursorRushLevel) {
    this.svc = svc;
    this.level = level;
    this.timeLeft = level.timeLimit;
  }

  init(): void {
    this.engine.load(this.level.buffer, { row: 0, col: 0 });
    this.spawnFrom = { ...this.engine.cursor };
    this.pickTarget();
    this.svc.audio.play("start");
  }

  // --- input ---

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
    this.keysThisTarget++;
    this.totalKeys++;
    const events = this.engine.feedKey(token);

    for (const e of events) {
      if (e.type === "move") this.svc.audio.play("move");
      if (e.type === "bell") this.svc.audio.play("error");
    }
    this.checkReached();
  }

  private checkReached(): void {
    const c = this.engine.cursor;
    if (c.row === this.target.row && c.col === this.target.col) {
      this.onReached();
    }
  }

  private onReached(): void {
    const naive =
      Math.abs(this.target.row - this.spawnFrom.row) +
      Math.abs(this.target.col - this.spawnFrom.col);
    const rating = this.rate(this.keysThisTarget, naive);

    let bonus = 0;
    if (rating.label === "PERFECT") {
      this.combo++;
      bonus = 100 + this.combo * 25;
      this.svc.audio.play(this.combo >= 3 ? "combo" : "perfect");
    } else if (rating.label === "GOOD") {
      this.combo++;
      bonus = 40;
      this.svc.audio.play("land");
    } else {
      this.combo = 0;
      this.svc.audio.play("land");
    }
    this.comboMax = Math.max(this.comboMax, this.combo);

    const speedBonus = Math.max(0, 60 - Math.floor(this.timeThisTarget * 20));
    this.score += 100 + bonus + speedBonus;
    this.targetsHit++;
    this.lastRating = rating;
    this.ratingFade = 1;

    // Juice: burst at the landing cell, flash, a touch of shake on big combos.
    const px = this.svc.term.gridToPixel(this.target.row, this.target.col);
    this.svc.particles.burst(px.x, px.y, {
      color: rating.color,
      count: rating.label === "PERFECT" ? 22 : 12,
      chars: rating.label === "PERFECT" ? "*+·" : undefined,
    });
    this.svc.flash.trigger(rating.color, rating.label === "PERFECT" ? 0.28 : 0.15, 5);
    if (this.combo >= 3) this.svc.shake.add(0.18 + Math.min(0.3, this.combo * 0.03));

    if (this.targetsHit >= this.level.targetCount) {
      this.finish();
      return;
    }
    this.spawnFrom = { ...this.engine.cursor };
    this.keysThisTarget = 0;
    this.timeThisTarget = 0;
    this.pickTarget();
  }

  private rate(keys: number, naive: number): Rating {
    const th = this.svc.term.theme;
    if (keys <= Math.max(1, Math.ceil(naive / 2))) return { label: "PERFECT", color: th.accent };
    if (keys <= naive) return { label: "GOOD", color: th.fg };
    return { label: "OK", color: th.dim };
  }

  // --- update ---

  update(dt: number): void {
    if (this.done) return;
    this.timeLeft -= dt;
    this.timeThisTarget += dt;
    if (this.ratingFade > 0) this.ratingFade = Math.max(0, this.ratingFade - dt * 1.5);
    if (this.timeLeft <= 0) {
      this.timeLeft = 0;
      this.finish();
    }
  }

  private finish(): void {
    if (this.done) return;
    this.done = true;
    const perfectAll = this.targetsHit >= this.level.targetCount;
    const avg = this.targetsHit > 0 ? this.score / this.targetsHit : 0;
    let stars = 0;
    if (perfectAll) {
      stars = 1;
      if (avg >= 150) stars = 2;
      if (avg >= 220) stars = 3;
    }
    const isBest = Storage.recordScore(this.level.id, this.score, stars);
    this.result = {
      levelId: this.level.id,
      title: this.level.title,
      score: this.score,
      stars,
      lines: [
        `${this.targetsHit}/${this.level.targetCount} targets reached`,
        `max combo x${this.comboMax}   keys used: ${this.totalKeys}`,
        `efficiency: ${this.efficiencyLabel()}`,
        isBest ? "NEW BEST!" : `best: ${Storage.getHighScore(this.level.id)}`,
      ],
    };
    this.svc.audio.play(perfectAll ? "perfect" : "land");
  }

  private efficiencyLabel(): string {
    if (this.targetsHit === 0) return "—";
    const kpt = this.totalKeys / this.targetsHit;
    if (kpt <= 2.5) return "surgical";
    if (kpt <= 4) return "sharp";
    if (kpt <= 6) return "decent";
    return "spammy — try motions!";
  }

  getResult(): ModeResult | null {
    return this.result;
  }

  // --- target selection ---

  private pickTarget(): void {
    const cands = this.candidates().filter((p) => {
      const d = Math.abs(p.row - this.engine.cursor.row) + Math.abs(p.col - this.engine.cursor.col);
      return d >= this.level.minDistance && !(p.row === this.engine.cursor.row && p.col === this.engine.cursor.col);
    });
    const pool = cands.length > 0 ? cands : this.candidates();
    this.target = pool[Math.floor(Math.random() * pool.length)] ?? { row: 0, col: 0 };
  }

  private candidates(): Pos[] {
    const lines = this.engine.lines;
    const out: Pos[] = [];
    lines.forEach((line, row) => {
      switch (this.level.targetKind) {
        case "anyChar":
          for (let col = 0; col < line.length; col++) if (line[col] !== " ") out.push({ row, col });
          break;
        case "wordStart":
          for (let col = 0; col < line.length; col++) {
            const prev = col === 0 ? " " : line[col - 1]!;
            if (line[col] !== " " && prev === " ") out.push({ row, col });
          }
          break;
        case "findChar":
          for (let col = 0; col < line.length; col++) if (/[a-z]/i.test(line[col]!)) out.push({ row, col });
          break;
        case "lineStart": {
          const idx = line.search(/\S/);
          if (idx >= 0) out.push({ row, col: idx });
          break;
        }
      }
    });
    return out;
  }

  // --- render ---

  render(): void {
    const term = this.svc.term;
    term.clear();
    drawBuffer(term, this.engine.getView(), {
      dimText: true,
      highlights: [{ pos: this.target, bg: term.theme.accent }],
    });

    this.svc.flash.render(term.context, term.canvas.width, term.canvas.height);
    this.svc.particles.render(term.context, term.theme.fontFamily);

    // HUD statusline (shows the search command line while typing /pattern).
    const timeStr = this.timeLeft.toFixed(1).padStart(4);
    const comboStr = this.combo > 1 ? `  x${this.combo}` : "";
    const cmd = this.engine.getView().cmdline;
    term.drawStatusLine(
      cmd
        ? ` ${cmd}`
        : ` ${this.level.title}   ${this.targetsHit}/${this.level.targetCount}   ⏱ ${timeStr}s${comboStr}`,
      `score ${this.score}   key ${this.lastKey || "—"} `,
    );

    // Top hint bar + rating popup.
    term.drawText(0, 0, this.level.hint.slice(0, term.cols), { fg: term.theme.dim });
    if (this.lastRating && this.ratingFade > 0) {
      const label = `${this.lastRating.label}!`;
      const col = Math.max(0, Math.floor((term.cols - label.length) / 2));
      term.drawText(1, col, label, { fg: this.lastRating.color, bold: true });
    }
  }
}
