import { describe, expect, it } from "vitest";
import { categoryMix, emptyStats, fingerprintVerdict, neverUsed, topKeys } from "./stats.ts";
import type { UsageStats } from "./storage.ts";

function make(keys: Record<string, number>, totalKeys?: number): UsageStats {
  const normal = Object.values(keys).reduce((a, b) => a + b, 0);
  return { keys, totalKeys: totalKeys ?? normal, runs: 5 };
}

describe("stats", () => {
  it("topKeys sorts by count descending", () => {
    const s = make({ j: 50, l: 90, w: 20 });
    expect(topKeys(s, 2)).toEqual([
      { key: "l", count: 90 },
      { key: "j", count: 50 },
    ]);
  });

  it("categoryMix buckets keys and computes shares", () => {
    const s = make({ h: 30, j: 30, w: 20, f: 20 }); // 60 steps, 20 words, 20 finds
    const mix = categoryMix(s);
    expect(mix.find((m) => m.name.startsWith("steps"))!.share).toBeCloseTo(0.6);
    expect(mix.find((m) => m.name.startsWith("words"))!.share).toBeCloseTo(0.2);
    expect(mix.find((m) => m.name.startsWith("finds"))!.share).toBeCloseTo(0.2);
  });

  it("neverUsed lists power keys with zero presses", () => {
    const s = make({ f: 3, G: 1, "/": 2 });
    const unused = neverUsed(s);
    expect(unused).not.toContain("f");
    expect(unused).not.toContain("G");
    expect(unused).toContain("%");
    expect(unused).toContain("q (macros)");
    expect(unused).toContain("Ctrl-V");
  });

  it("verdict reflects the step share", () => {
    expect(fingerprintVerdict(make({ h: 200, l: 200 }))).toContain("hjkl");
    expect(fingerprintVerdict(make({ f: 100, w: 100, G: 100 }))).toContain("connoisseur");
    expect(fingerprintVerdict(make({ h: 10 }))).toContain("play a few");
  });

  it("empty stats are safe everywhere", () => {
    const s = emptyStats();
    expect(topKeys(s, 5)).toEqual([]);
    expect(categoryMix(s).every((c) => c.share === 0)).toBe(true);
    expect(neverUsed(s).length).toBeGreaterThan(5);
  });
});
