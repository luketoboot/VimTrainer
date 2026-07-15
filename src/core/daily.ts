// The Daily Gauntlet: a date-seeded Dodge run — same waves for every player
// worldwide, one attempt per day, its own global leaderboard.

import type { DodgeLevel } from "../levels/curriculum.ts";

/** Today's challenge date, UTC so the whole world rolls over together. */
export function todayId(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

export function dailyLevelId(date: string): string {
  return `daily-${date}`; // fits the leaderboard's ^[a-z0-9-]{1,40}$ rule
}

/** Deterministic PRNG (mulberry32) so a date string fully defines the run. */
export function seededRng(seedText: string): () => number {
  let h = 1779033703 ^ seedText.length;
  for (let i = 0; i < seedText.length; i++) {
    h = Math.imul(h ^ seedText.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The daily run itself: a hard mixed gauntlet, identical for everyone. */
export function dailyLevel(date: string): DodgeLevel {
  return {
    id: dailyLevelId(date),
    title: `Daily Gauntlet ${date}`,
    skill: "One attempt. Every pattern.",
    hint: "Same waves for everyone today. One try — make it count.",
    duration: 75,
    startHp: 3,
    baseSpawnInterval: 1.0,
    minSpawnInterval: 0.38,
    baseSpeed: 7,
    maxSpeed: 16,
    patterns: ["stream", "rain", "aimed", "wall", "diagonal", "arc", "ring", "spiral"],
    intensity: 2,
  };
}

/** Wordle-style share text for the clipboard. */
export function shareText(date: string, score: number, stars: number, survivedLine: string): string {
  const starStr = "★".repeat(stars) + "☆".repeat(3 - stars);
  return [
    `VimTrainer Daily ${date}`,
    `${starStr}  ${score} pts — ${survivedLine}`,
    "https://luketoboot.github.io/VimTrainer/",
  ].join("\n");
}
