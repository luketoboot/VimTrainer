import { describe, expect, it } from "vitest";
import { TutorialMode, computeReach, lessonSatisfied } from "./tutorial.ts";
import type { GameServices } from "./mode.ts";
import { GREEN_PHOSPHOR } from "../render/theme.ts";
import { VimEngine, tokenize } from "../engine/engine.ts";
import { TUTORIAL_CHAPTERS } from "../levels/tutorial.ts";

function stubServices(): GameServices {
  return {
    term: { theme: GREEN_PHOSPHOR, gridToPixel: () => ({ x: 0, y: 0 }) } as unknown as GameServices["term"],
    shake: { add() {} } as unknown as GameServices["shake"],
    particles: { burst() {} } as unknown as GameServices["particles"],
    flash: { trigger() {} } as unknown as GameServices["flash"],
    hitstop: {} as unknown as GameServices["hitstop"],
    audio: { play() {} } as unknown as GameServices["audio"],
  };
}

describe("tutorial lessons are all solvable by their idealKeys", () => {
  for (const chapter of TUTORIAL_CHAPTERS) {
    for (const lesson of chapter.lessons) {
      it(`${chapter.id}: ${lesson.teach}`, () => {
        const engine = new VimEngine();
        engine.load(lesson.buffer, lesson.cursor);
        for (const tok of tokenize(lesson.idealKeys)) engine.feedKey(tok);
        const target = computeReach(lesson);
        expect(lessonSatisfied(lesson, engine, target)).toBe(true);
        if (lesson.kind === "reach") {
          // The lesson must actually require movement (target != start).
          const moved = target.row !== lesson.cursor.row || target.col !== lesson.cursor.col;
          expect(moved).toBe(true);
        }
      });
    }
  }
});

describe("TutorialMode flow", () => {
  it("completes a chapter when each lesson is solved", () => {
    const chapter = TUTORIAL_CHAPTERS[0]!;
    const mode = new TutorialMode(stubServices(), chapter);
    mode.init();
    let guard = 0;
    while (!mode.done && guard++ < 100) {
      const lesson = chapter.lessons[(mode as unknown as { index: number }).index]!;
      for (const tok of tokenize(lesson.idealKeys)) mode.handleKey(tok);
      mode.update(0.6); // clear the celebrate pause -> advance to next lesson
    }
    expect(mode.done).toBe(true);
    expect(mode.getResult()!.stars).toBe(3);
  });
});
