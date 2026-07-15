// Tutorial — a guided course that teaches one keystroke per lesson and checks you
// actually performed it before advancing. Reach targets are derived from each
// lesson's idealKeys so the highlight always matches the taught motion exactly.

import { VimEngine, tokenize } from "../engine/engine.ts";
import type { KeyToken } from "../engine/keymap.ts";
import type { Pos } from "../engine/types.ts";
import { drawBuffer } from "../render/bufferView.ts";
import type { Lesson, TutorialChapter } from "../levels/tutorial.ts";
import { Storage } from "../core/storage.ts";
import { unlockNext } from "../core/progression.ts";
import { TUTORIAL_CHAPTERS } from "../levels/tutorial.ts";
import { contextForEngine, engineWantsEsc, type RemapContext } from "../core/keybinds.ts";
import type { GameMode, GameServices, ModeResult } from "./mode.ts";

/** Run keys on a scratch engine and report the resulting cursor (for reach targets). */
/** Greedy word-wrap capped at maxLines (last line ellipsized if truncated). */
function wrapText(text: string, width: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if (cur.length + w.length + 1 > width && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = cur ? `${cur} ${w}` : w;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    lines.length = maxLines;
    lines[maxLines - 1] = lines[maxLines - 1]!.slice(0, width - 1) + "…";
  }
  return lines;
}

export function computeReach(lesson: Lesson): Pos {
  const e = new VimEngine();
  e.load(lesson.buffer, lesson.cursor);
  for (const tok of tokenize(lesson.idealKeys)) e.feedKey(tok);
  return { ...e.cursor };
}

/** True when the lesson's completion condition is met by the given engine state. */
export function lessonSatisfied(lesson: Lesson, engine: VimEngine, reachTarget: Pos): boolean {
  if (lesson.kind === "text") return engine.getText() === lesson.target.join("\n");
  return engine.cursor.row === reachTarget.row && engine.cursor.col === reachTarget.col;
}

export class TutorialMode implements GameMode {
  private svc: GameServices;
  private chapter: TutorialChapter;
  private engine = new VimEngine();
  private index = 0;
  private reachTarget: Pos = { row: 0, col: 0 };
  private lastKey = "";
  private celebrate = 0; // fade timer after completing a lesson

  done = false;
  private result: ModeResult | null = null;

  constructor(svc: GameServices, chapter: TutorialChapter) {
    this.svc = svc;
    this.chapter = chapter;
  }

  init(): void {
    this.loadLesson();
    this.svc.audio.play("start");
  }

  private get lesson(): Lesson {
    return this.chapter.lessons[this.index]!;
  }

  private loadLesson(): void {
    const l = this.lesson;
    this.engine.load(l.buffer, l.cursor);
    this.reachTarget = l.kind === "reach" ? computeReach(l) : { row: 0, col: 0 };
  }

  remapContext(): RemapContext {
    return contextForEngine(this.engine);
  }

  wantsEsc(): boolean {
    return engineWantsEsc(this.engine);
  }

  handleKey(token: KeyToken): void {
    if (this.done || this.celebrate > 0) return; // ignore input during the little pause
    this.lastKey = token;
    const events = this.engine.feedKey(token);
    for (const e of events) {
      if (e.type === "bell") this.svc.audio.play("error");
    }
    if (lessonSatisfied(this.lesson, this.engine, this.reachTarget)) this.completeLesson();
  }

  private completeLesson(): void {
    this.celebrate = 0.55;
    this.svc.audio.play("perfect");
    const px = this.svc.term.gridToPixel(this.engine.cursor.row, this.engine.cursor.col);
    this.svc.particles.burst(px.x, px.y, { color: this.svc.term.theme.accent, count: 16, chars: "*+·" });
    this.svc.flash.trigger(this.svc.term.theme.accent, 0.18, 5);
  }

  update(dt: number): void {
    if (this.done) return;
    if (this.celebrate > 0) {
      this.celebrate = Math.max(0, this.celebrate - dt);
      if (this.celebrate === 0) this.advance();
    }
  }

  private advance(): void {
    this.index++;
    if (this.index >= this.chapter.lessons.length) {
      this.finish();
      return;
    }
    this.loadLesson();
  }

  private finish(): void {
    this.done = true;
    Storage.recordScore(this.chapter.id, this.chapter.lessons.length, 3);
    unlockNext(TUTORIAL_CHAPTERS.map((c) => c.id), this.chapter.id);
    this.result = {
      levelId: this.chapter.id,
      title: this.chapter.title,
      score: this.chapter.lessons.length,
      stars: 3,
      lines: [
        "CHAPTER COMPLETE!",
        `you practiced ${this.chapter.lessons.length} moves`,
        "keep them in your fingers — try the game modes next",
      ],
    };
    this.svc.audio.play("perfect");
  }

  getResult(): ModeResult | null {
    return this.result;
  }

  render(): void {
    const term = this.svc.term;
    const th = term.theme;
    term.clear();
    const l = this.lesson;

    // Instruction + progress + taught-key badge + real-world use case.
    term.drawText(0, 0, `${this.chapter.title}   (${this.index + 1}/${this.chapter.lessons.length})`, { fg: th.dim });
    term.drawText(1, 0, l.instruction.slice(0, term.cols), { fg: th.fg, bold: true });
    term.drawText(2, 0, `key: [ ${l.teach} ]     try: ${l.idealKeys}`, { fg: th.accentAlt });
    wrapText(l.why, Math.max(20, term.cols - 2), 2).forEach((line, i) => {
      term.drawText(3 + i, 0, line, { fg: th.dim });
    });

    const screenRow = 6;
    const highlights = l.kind === "reach" ? [{ pos: this.reachTarget, bg: th.accent }] : [];
    drawBuffer(term, this.engine.getView(), { screenRow, highlights });

    // For text lessons, show the goal underneath.
    if (l.kind === "text") {
      const base = screenRow + this.engine.lines.length + 1;
      term.drawText(base, 0, "── goal ──", { fg: th.accentAlt });
      l.target.forEach((line, i) => {
        const ok = this.engine.lines[i] === line;
        term.drawText(base + 1 + i, 0, `${ok ? "✓" : "≠"} ${line}`, { fg: ok ? th.dim : th.statusFg });
      });
    }

    this.svc.flash.render(term.context, term.canvas.width, term.canvas.height);
    this.svc.particles.render(term.context, term.theme.fontFamily);

    if (this.celebrate > 0) {
      const msg = "✓ nice!";
      term.drawText(screenRow - 1, Math.max(0, Math.floor((term.cols - msg.length) / 2)), msg, { fg: th.accent, bold: true });
    }

    const cmd = this.engine.getView().cmdline;
    term.drawStatusLine(
      cmd ? ` ${cmd}` : ` TUTORIAL — ${this.chapter.skill}`,
      `key ${this.lastKey || "—"} `,
    );
  }
}
