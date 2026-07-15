import { describe, expect, it } from "vitest";
import { DodgeMode } from "./dodge.ts";
import type { GameServices } from "./mode.ts";
import { GREEN_PHOSPHOR, DEFAULT_METRICS } from "../render/theme.ts";
import type { DodgeLevel } from "../levels/curriculum.ts";

function stubServices(): GameServices {
  return {
    term: {
      theme: GREEN_PHOSPHOR,
      metrics: DEFAULT_METRICS,
      cols: 40,
      rows: 18,
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

const LEVEL: DodgeLevel = {
  id: "test-dodge",
  title: "Test Dodge",
  skill: "test",
  hint: "",
  duration: 5,
  startHp: 3,
  baseSpawnInterval: 999, // effectively never auto-spawn during the test
  minSpawnInterval: 999,
  baseSpeed: 5,
  maxSpeed: 5,
  patterns: ["stream"],
};

type Internals = {
  projectiles: { x: number; y: number; vx: number; vy: number; glyph: string; color: string; near: boolean }[];
  hp: number;
  invuln: number;
  engine: { cursor: { row: number; col: number }; getText(): string };
  backdropText: string;
  spawn(pattern: string, speed: number, difficulty: number): void;
  bomb: number;
  bombsUsed: number;
  leaps: number;
  score: number;
};
function peek(mode: DodgeMode): Internals {
  return mode as unknown as Internals;
}

describe("DodgeMode", () => {
  it("a projectile on the cursor cell costs HP and grants i-frames", () => {
    const mode = new DodgeMode(stubServices(), LEVEL);
    mode.init();
    const g = peek(mode);
    const { row, col } = g.engine.cursor;
    g.projectiles.push({ x: col, y: row, vx: 0, vy: 0, glyph: "●", color: "#f00", near: false });

    mode.update(0.01);
    expect(g.hp).toBe(2);
    expect(g.invuln).toBeGreaterThan(0);

    // Still overlapping, but i-frames protect from a second immediate hit.
    mode.update(0.01);
    expect(g.hp).toBe(2);
  });

  it("surviving to the duration is a win with stars", () => {
    const mode = new DodgeMode(stubServices(), LEVEL);
    mode.init();
    mode.update(LEVEL.duration + 0.1);
    expect(mode.done).toBe(true);
    const res = mode.getResult()!;
    expect(res.stars).toBe(3); // full HP survival
    expect(res.lines[0]).toContain("SURVIVED");
  });

  it("losing all HP ends the run as a loss", () => {
    const mode = new DodgeMode(stubServices(), LEVEL);
    mode.init();
    const g = peek(mode);
    for (let i = 0; i < LEVEL.startHp; i++) {
      const { row, col } = g.engine.cursor;
      g.projectiles.push({ x: col, y: row, vx: 0, vy: 0, glyph: "●", color: "#f00", near: false });
      g.invuln = 0; // bypass i-frames to force consecutive hits
      mode.update(0.01);
    }
    expect(mode.done).toBe(true);
    expect(peek(mode).hp).toBe(0);
    expect(mode.getResult()!.stars).toBe(0);
  });

  it("a ring burst sends bullets out at every angle, not just axis-aligned", () => {
    const mode = new DodgeMode(stubServices(), LEVEL);
    mode.init();
    const g = peek(mode);
    g.projectiles.length = 0;
    g.spawn("ring", 8, 1);
    expect(g.projectiles.length).toBeGreaterThan(4);
    // A ring is omnidirectional: some bullets must travel diagonally (both
    // velocity components non-zero), which the old left/right-only spawns never did.
    const diagonal = g.projectiles.filter(
      (p) => Math.abs(p.vx) > 0.5 && Math.abs(p.vy) > 0.5,
    );
    expect(diagonal.length).toBeGreaterThan(0);
  });

  it("a big motion is rewarded as a leap (score + leap count)", () => {
    const mode = new DodgeMode(stubServices(), LEVEL);
    mode.init();
    const g = peek(mode);
    expect(g.leaps).toBe(0);
    mode.handleKey("G"); // jump to the last line — a long vertical move
    expect(g.leaps).toBe(1);
    expect(g.score).toBeGreaterThan(0);
  });

  it("a charged bomb fires on `dd` and clears the field", () => {
    const mode = new DodgeMode(stubServices(), LEVEL);
    mode.init();
    const g = peek(mode);
    g.bomb = 1;
    for (let i = 0; i < 5; i++) {
      g.projectiles.push({ x: i, y: i, vx: -1, vy: 0, glyph: "●", color: "#f00", near: false });
    }
    mode.handleKey("d");
    mode.handleKey("d"); // second d detonates
    expect(g.projectiles.length).toBe(0);
    expect(g.bombsUsed).toBe(1);
    expect(g.bomb).toBe(0);
  });

  it("edits are snapped back — the field is read-only", () => {
    const mode = new DodgeMode(stubServices(), LEVEL);
    mode.init();
    const g = peek(mode);
    const before = g.engine.getText();
    mode.handleKey("x"); // would delete a char in a normal buffer
    expect(g.engine.getText()).toBe(before);
  });
});
