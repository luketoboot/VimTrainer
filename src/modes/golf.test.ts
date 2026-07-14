import { describe, expect, it } from "vitest";
import { GolfMode } from "./golf.ts";
import type { GameServices } from "./mode.ts";
import { GREEN_PHOSPHOR } from "../render/theme.ts";
import { tokenize } from "../engine/engine.ts";
import type { GolfPuzzle } from "../levels/curriculum.ts";

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
  };
}

function play(puzzle: GolfPuzzle, keys: string): GolfMode {
  const mode = new GolfMode(stubServices(), puzzle);
  mode.init();
  for (const tok of tokenize(keys)) mode.handleKey(tok);
  return mode;
}

const DELETE_LINE: GolfPuzzle = {
  id: "t-del",
  title: "del",
  skill: "",
  hint: "",
  start: ["a", "DEBUG", "b"],
  target: ["a", "b"],
  par: 3,
  startCursor: { row: 1, col: 0 },
};

const SWAP_WORD: GolfPuzzle = {
  id: "t-swap",
  title: "swap",
  skill: "",
  hint: "",
  start: ["let foo = 42;"],
  target: ["let bar = 42;"],
  par: 8,
  startCursor: { row: 0, col: 4 },
};

describe("GolfMode", () => {
  it("detects a solve and awards 3 stars under par (dd)", () => {
    const mode = play(DELETE_LINE, "dd");
    expect(mode.done).toBe(true);
    const res = mode.getResult()!;
    expect(res.stars).toBe(3);
    expect(res.score).toBe(2); // keystrokes
  });

  it("solves a change-word puzzle via ciw", () => {
    const mode = play(SWAP_WORD, "ciwbar<Esc>");
    expect(mode.done).toBe(true);
    expect(mode.getResult()!.stars).toBe(3);
  });

  it("does not report solved until the text matches the target", () => {
    const mode = play(DELETE_LINE, "x"); // deletes one char, not the line
    expect(mode.done).toBe(false);
  });

  it("counts keystrokes and solves as soon as the buffer matches (mid-insert)", () => {
    const mode = play(SWAP_WORD, "ciwbar<Esc>");
    // c i w b a r -> buffer already reads the target after 'r' (6 keys), before <Esc>.
    expect(mode.getResult()!.score).toBe(6);
  });
});
