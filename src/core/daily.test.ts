import { describe, expect, it } from "vitest";
import { dailyLevel, dailyLevelId, seededRng, shareText } from "./daily.ts";

describe("daily challenge", () => {
  it("the same date produces an identical random sequence", () => {
    const a = seededRng("2026-07-15");
    const b = seededRng("2026-07-15");
    const seqA = Array.from({ length: 50 }, () => a());
    const seqB = Array.from({ length: 50 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it("different dates produce different runs", () => {
    const a = seededRng("2026-07-15");
    const b = seededRng("2026-07-16");
    expect(Array.from({ length: 10 }, () => a())).not.toEqual(Array.from({ length: 10 }, () => b()));
  });

  it("rng output stays in [0, 1)", () => {
    const r = seededRng("x");
    for (let i = 0; i < 1000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("level id fits the leaderboard rules pattern", () => {
    expect(dailyLevelId("2026-07-15")).toMatch(/^[a-z0-9-]{1,40}$/);
    expect(dailyLevel("2026-07-15").id).toBe("daily-2026-07-15");
  });

  it("share text carries date, stars, and score", () => {
    const t = shareText("2026-07-15", 3120, 2, "survived 43.2s");
    expect(t).toContain("2026-07-15");
    expect(t).toContain("★★☆");
    expect(t).toContain("3120");
    expect(t).toContain("https://");
  });
});
