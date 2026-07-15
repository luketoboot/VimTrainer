import { describe, expect, it } from "vitest";
import { CursorRushMode } from "./cursorRush.ts";
import type { GameServices } from "./mode.ts";
import type { CursorRushLevel } from "../levels/curriculum.ts";
import { GREEN_PHOSPHOR } from "../render/theme.ts";
import type { KeyToken } from "../engine/keymap.ts";

// Minimal no-op services so the gameplay loop runs without a canvas or audio.
function stubServices(): GameServices {
  return {
    term: {
      theme: GREEN_PHOSPHOR,
      gridToPixel: () => ({ x: 0, y: 0 }),
    } as unknown as GameServices["term"],
    shake: { add() {} } as unknown as GameServices["shake"],
    particles: { burst() {} } as unknown as GameServices["particles"],
    flash: { trigger() {} } as unknown as GameServices["flash"],
    hitstop: {} as unknown as GameServices["hitstop"],
    audio: { play() {} } as unknown as GameServices["audio"],
    coach: { observe() {}, reset() {}, update() {} } as unknown as GameServices["coach"],
  };
}

const LEVEL: CursorRushLevel = {
  id: "test-level",
  title: "Test",
  skill: "test",
  hint: "",
  buffer: ["abcdefghij", "klmnopqrst", "uvwxyz0123"],
  targetCount: 3,
  timeLimit: 30,
  targetKind: "anyChar",
  minDistance: 2,
};

/** Access the private active target for driving the cursor in tests. */
function currentTarget(mode: CursorRushMode): { row: number; col: number } {
  return (mode as unknown as { target: { row: number; col: number } }).target;
}
function cursorOf(mode: CursorRushMode): { row: number; col: number } {
  return (mode as unknown as { engine: { cursor: { row: number; col: number } } }).engine.cursor;
}
function hitsOf(mode: CursorRushMode): number {
  return (mode as unknown as { targetsHit: number }).targetsHit;
}

/** Feed hjkl keys until exactly one more target is reached (or the mode ends). */
function walkOneTarget(mode: CursorRushMode): void {
  const start = hitsOf(mode);
  let guard = 0;
  while (hitsOf(mode) === start && !mode.done) {
    const t = currentTarget(mode);
    const c = cursorOf(mode);
    let key: KeyToken;
    if (c.row < t.row) key = "j";
    else if (c.row > t.row) key = "k";
    else if (c.col < t.col) key = "l";
    else key = "h";
    mode.handleKey(key);
    if (++guard > 500) throw new Error("walk failed to reach target");
  }
}

describe("CursorRushMode", () => {
  it("scores and advances targets as the cursor reaches them", () => {
    const mode = new CursorRushMode(stubServices(), LEVEL);
    mode.init();
    expect(mode.done).toBe(false);

    walkOneTarget(mode); // hitting a target advances to the next one
    const scoreAfterOne = (mode as unknown as { score: number }).score;
    expect(scoreAfterOne).toBeGreaterThan(0);
    expect(hitsOf(mode)).toBe(1);
  });

  it("completes after all targets and produces a result with stars", () => {
    const mode = new CursorRushMode(stubServices(), LEVEL);
    mode.init();
    let guard = 0;
    while (!mode.done && guard++ < 20) walkOneTarget(mode);
    expect(mode.done).toBe(true);
    const res = mode.getResult();
    expect(res).not.toBeNull();
    expect(res!.stars).toBeGreaterThanOrEqual(1);
    expect(res!.levelId).toBe("test-level");
  });

  it("ends when the timer runs out", () => {
    const mode = new CursorRushMode(stubServices(), LEVEL);
    mode.init();
    mode.update(999); // blow past the time limit
    expect(mode.done).toBe(true);
  });
});
