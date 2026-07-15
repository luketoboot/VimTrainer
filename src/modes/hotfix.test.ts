import { describe, expect, it } from "vitest";
import { HotfixMode } from "./hotfix.ts";
import type { GameServices } from "./mode.ts";
import { GREEN_PHOSPHOR } from "../render/theme.ts";
import { VimEngine, tokenize } from "../engine/engine.ts";
import { HOTFIX_LEVELS } from "../levels/hotfix.ts";

function stubServices(): GameServices {
  return {
    term: {
      theme: GREEN_PHOSPHOR,
      gridToPixel: () => ({ x: 0, y: 0 }),
    } as unknown as GameServices["term"],
    shake: { add() {} } as unknown as GameServices["shake"],
    particles: { burst() {} } as unknown as GameServices["particles"],
    flash: { trigger() {} } as unknown as GameServices["flash"],
    hitstop: { trigger() {} } as unknown as GameServices["hitstop"],
    audio: { play() {} } as unknown as GameServices["audio"],
    coach: { observe() {}, reset() {}, update() {} } as unknown as GameServices["coach"],
  };
}

describe("hotfix level data", () => {
  for (const level of HOTFIX_LEVELS) {
    it(`${level.id}: the ideal chain produces the pinned 'after' buffer`, () => {
      const e = new VimEngine();
      e.load(level.buffer, { row: 0, col: 0 });
      let prev = e.getText();
      for (const t of level.tasks) {
        for (const tok of tokenize(t.ideal)) e.feedKey(tok);
        const cur = e.getText();
        expect(cur, `ticket "${t.desc}" must change the buffer`).not.toBe(prev);
        prev = cur;
      }
      expect(e.getText()).toBe(level.after.join("\n"));
    });

    it(`${level.id}: every ticket target sits inside the buffer at ticket time`, () => {
      const e = new VimEngine();
      e.load(level.buffer, { row: 0, col: 0 });
      for (const t of level.tasks) {
        expect(t.target.row, `"${t.desc}" target row`).toBeLessThan(e.lines.length);
        expect(t.target.col, `"${t.desc}" target col`).toBeLessThan(e.lines[t.target.row]!.length);
        for (const tok of tokenize(t.ideal)) e.feedKey(tok);
      }
    });
  }
});

describe("HotfixMode", () => {
  function playThrough(): HotfixMode {
    const level = HOTFIX_LEVELS[0]!;
    const mode = new HotfixMode(stubServices(), level);
    mode.init();
    for (const t of level.tasks) {
      for (const tok of tokenize(t.ideal)) mode.handleKey(tok);
    }
    return mode;
  }

  it("closes every ticket and enters the ship phase without finishing", () => {
    const mode = playThrough();
    expect(mode.done).toBe(false); // still needs :wq
  });

  it(":wq ships the build and awards 3 stars for all-clean fixes", () => {
    const mode = playThrough();
    for (const tok of tokenize(":wq<CR>")) mode.handleKey(tok);
    expect(mode.done).toBe(true);
    const res = mode.getResult()!;
    expect(res.stars).toBe(3);
    expect(res.lines[0]).toBe("SHIPPED!");
    expect(res.score).toBeGreaterThan(0);
  });

  it(":wq with tickets still open does not end the run", () => {
    const mode = new HotfixMode(stubServices(), HOTFIX_LEVELS[0]!);
    mode.init();
    for (const tok of tokenize(":wq<CR>")) mode.handleKey(tok);
    expect(mode.done).toBe(false);
  });

  it("running out the clock fails the build with 0 stars", () => {
    const mode = new HotfixMode(stubServices(), HOTFIX_LEVELS[0]!);
    mode.init();
    mode.update(HOTFIX_LEVELS[0]!.startTime + 1);
    expect(mode.done).toBe(true);
    expect(mode.getResult()!.stars).toBe(0);
  });

  it("closing a ticket refunds time on the deploy clock", () => {
    const level = HOTFIX_LEVELS[0]!;
    const mode = new HotfixMode(stubServices(), level);
    mode.init();
    mode.update(5); // burn 5 seconds
    for (const tok of tokenize(level.tasks[0]!.ideal)) mode.handleKey(tok);
    mode.update(0);
    // startTime - 5 + bonusTime > startTime - 5 — the run survives longer.
    // (Verified indirectly: burning startTime-2 more seconds would have killed
    // a bonus-less run, but this one is still alive.)
    mode.update(level.startTime - 5 - 2 + level.bonusTime - 1);
    expect(mode.done).toBe(false);
  });
});
