import { beforeEach, describe, expect, it } from "vitest";
import { Coach } from "./coach.ts";

let coach: Coach;
beforeEach(() => {
  coach = new Coach();
});

function press(keys: string[], ctx: "normal" | "insert" | "literal" = "normal"): void {
  for (const k of keys) coach.observe(k, ctx);
}

describe("Coach", () => {
  it("calls out an l-crawl and suggests f/count", () => {
    press(Array(7).fill("l"));
    expect(coach.current).toContain("7×l");
    expect(coach.current).toContain("f{char}");
  });

  it("calls out countless j mashing", () => {
    press(Array(6).fill("j"));
    expect(coach.current).toContain("6j");
  });

  it("treats arrow keys as their letter equivalents", () => {
    press(Array(7).fill("<Right>"));
    expect(coach.current).toContain("7×l");
  });

  it("suggests counts for repeated word motions", () => {
    press(["w", "w", "w", "w"]);
    expect(coach.current).toContain("4w");
  });

  it("suggests dw for x-spam", () => {
    press(["x", "x", "x", "x"]);
    expect(coach.current).toContain("dw");
  });

  it("spots a retyped find and suggests ;", () => {
    press(["f", "q", "f", "q"]);
    expect(coach.current).toContain(";");
  });

  it("different find targets don't trigger the ; tip", () => {
    press(["f", "q", "f", "z"]);
    expect(coach.current).toBeNull();
  });

  it("ignores keys typed in insert mode (jjjj is just text there)", () => {
    press(Array(10).fill("j"), "insert");
    expect(coach.current).toBeNull();
  });

  it("a broken streak doesn't fire", () => {
    press(["l", "l", "l", "j", "l", "l", "l"]);
    expect(coach.current).toBeNull();
  });

  it("tips expire after their display time", () => {
    press(Array(7).fill("l"));
    expect(coach.current).not.toBeNull();
    coach.update(10);
    expect(coach.current).toBeNull();
  });

  it("global cooldown prevents back-to-back nagging", () => {
    press(Array(7).fill("l"));
    const first = coach.current;
    coach.update(5); // tip expired, but global cooldown (9s) still active
    press(Array(6).fill("j"));
    expect(coach.current).toBeNull();
    expect(first).not.toBeNull();
  });

  it("the same habit doesn't repeat within its cooldown, but can later", () => {
    press(Array(7).fill("l"));
    coach.update(15); // past global cooldown, within habit cooldown (30s)
    press(["k"]); // break streak
    press(Array(7).fill("l"));
    expect(coach.current).toBeNull();
    coach.update(31);
    press(["k"]);
    press(Array(7).fill("l"));
    expect(coach.current).toContain("7×l");
  });

  it("disabled coach observes nothing and shows nothing", () => {
    coach.enabled = false;
    press(Array(10).fill("l"));
    expect(coach.current).toBeNull();
  });

  it("reset clears streaks so a new run starts clean", () => {
    press(Array(6).fill("l"));
    coach.reset();
    press(["l"]);
    expect(coach.current).toBeNull();
  });
});
