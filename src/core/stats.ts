// Long-term usage stats: every normal-mode key you press in the game modes is
// tallied into a persistent "Vim fingerprint" — which motions you lean on,
// which you never touch. The STATS screen renders this; it's the habit coach's
// long-term memory.

import { Storage, type UsageStats } from "./storage.ts";
import type { KeyToken } from "../engine/keymap.ts";
import type { RemapContext } from "./keybinds.ts";

export interface CategoryMix {
  name: string;
  count: number;
  share: number; // 0..1 of all categorized keys
}

// Motion vocabulary, grouped the way a Vim mentor thinks about it.
const CATEGORIES: Array<{ name: string; keys: string[] }> = [
  { name: "steps (hjkl)", keys: ["h", "j", "k", "l", "<Left>", "<Right>", "<Up>", "<Down>"] },
  { name: "words (w b e)", keys: ["w", "b", "e", "W", "B", "E"] },
  { name: "finds (f t ; ,)", keys: ["f", "F", "t", "T", ";", ","] },
  { name: "jumps (G $ 0 % /)", keys: ["g", "G", "0", "$", "^", "{", "}", "%", "/", "?", "n", "N", "*", "`", "'"] },
  { name: "edits (d c y x .)", keys: ["d", "c", "y", "x", "X", "s", "S", "D", "C", "p", "P", "o", "O", "r", "~", ".", "u", "J", "i", "a", "A", "I", "v", "V"] },
  { name: "power (: q @ ^V m)", keys: [":", "q", "@", "<C-v>", "m"] },
];

// The keys worth calling out when they've never been pressed — each one is a
// real speed upgrade the player is leaving on the table.
const POWER_KEYS: Array<{ key: string; label: string }> = [
  { key: "f", label: "f" },
  { key: ";", label: ";" },
  { key: "t", label: "t" },
  { key: "%", label: "%" },
  { key: "g", label: "gg" },
  { key: "G", label: "G" },
  { key: "{", label: "{ }" },
  { key: "/", label: "/" },
  { key: "*", label: "*" },
  { key: ".", label: "." },
  { key: "q", label: "q (macros)" },
  { key: "<C-v>", label: "Ctrl-V" },
  { key: "m", label: "m (marks)" },
];

export function emptyStats(): UsageStats {
  return { keys: {}, totalKeys: 0, runs: 0 };
}

export class StatsTracker {
  private stats: UsageStats;
  private dirty = false;

  constructor() {
    this.stats = Storage.getStats() ?? emptyStats();
  }

  /** Tally one key. Only normal-context presses count toward the fingerprint —
   *  insert-mode typing and f/:-arguments are text, not habits. */
  record(token: KeyToken, ctx: RemapContext): void {
    this.stats.totalKeys++;
    if (ctx === "normal") {
      this.stats.keys[token] = (this.stats.keys[token] ?? 0) + 1;
    }
    this.dirty = true;
  }

  /** Count a finished run. */
  recordRun(): void {
    this.stats.runs++;
    this.dirty = true;
  }

  /** Persist if anything changed. Called at run end, not per keypress. */
  flush(): void {
    if (!this.dirty) return;
    Storage.setStats(this.stats);
    this.dirty = false;
  }

  get snapshot(): UsageStats {
    return this.stats;
  }
}

// --- pure presentation helpers (also used by tests) -------------------------

export function topKeys(stats: UsageStats, n: number): Array<{ key: string; count: number }> {
  return Object.entries(stats.keys)
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
    .slice(0, n);
}

export function categoryMix(stats: UsageStats): CategoryMix[] {
  const counts = CATEGORIES.map((c) => ({
    name: c.name,
    count: c.keys.reduce((sum, k) => sum + (stats.keys[k] ?? 0), 0),
  }));
  const total = counts.reduce((s, c) => s + c.count, 0);
  return counts.map((c) => ({ ...c, share: total > 0 ? c.count / total : 0 }));
}

export function neverUsed(stats: UsageStats): string[] {
  return POWER_KEYS.filter((p) => !(stats.keys[p.key] ?? 0)).map((p) => p.label);
}

/** One-line verdict on the step-vs-smart-motion balance. */
export function fingerprintVerdict(stats: UsageStats): string {
  const mix = categoryMix(stats);
  const steps = mix.find((m) => m.name.startsWith("steps"))?.share ?? 0;
  if (stats.totalKeys < 100) return "play a few rounds to build your fingerprint";
  if (steps > 0.6) return "heavy on hjkl — the coach smells a crawl. Words & finds await.";
  if (steps > 0.35) return "decent mix — push finds and jumps to get surgical.";
  return "motion connoisseur — hjkl is your last resort, as it should be.";
}
