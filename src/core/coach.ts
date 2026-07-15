// The habit coach: watches the raw keystream during play and calls out
// inefficient habits with a short tip — the thing a human Vim mentor does.
// One tip at a time, per-habit and global cooldowns so it teaches, not nags.
//
// It sees tokens only (no engine internals): each mode reports every key with
// its current remap context, and the coach's own tiny state machine tracks
// find-arguments so `f` retyping can be spotted without engine access.

import type { KeyToken } from "../engine/keymap.ts";
import type { RemapContext } from "./keybinds.ts";

interface Tip {
  id: string;
  text: string;
}

const TIP_SECONDS = 4.5; // how long a tip stays up
const HABIT_COOLDOWN = 30; // per-habit: don't repeat the same lesson too soon
const GLOBAL_COOLDOWN = 9; // between any two tips

const STEP_KEYS = new Set(["h", "j", "k", "l", "<Left>", "<Right>", "<Up>", "<Down>"]);
const WORD_KEYS = new Set(["w", "b", "e", "W", "B", "E"]);
const FIND_KEYS = new Set(["f", "F", "t", "T"]);

const ARROW_TO_LETTER: Record<string, string> = {
  "<Left>": "h",
  "<Right>": "l",
  "<Up>": "k",
  "<Down>": "j",
};

export class Coach {
  enabled = true;

  private tip: Tip | null = null;
  private tipTtl = 0;
  private lastTipAt = -Infinity; // seconds of coach-time
  private habitLastAt = new Map<string, number>();
  private clock = 0;

  // Streak tracking.
  private streakKey = "";
  private streakLen = 0;

  // Find-argument state machine: f/F/t/T consume the NEXT token as a literal.
  private pendingFind = false;
  private lastFind = ""; // e.g. "fq"

  update(dt: number): void {
    this.clock += dt;
    if (this.tipTtl > 0) {
      this.tipTtl -= dt;
      if (this.tipTtl <= 0) this.tip = null;
    }
  }

  /** The tip to display right now, or null. */
  get current(): string | null {
    return this.enabled ? this.tip?.text ?? null : null;
  }

  /** Reset per-run state (streaks, find memory) — call when a mode starts. */
  reset(): void {
    this.streakKey = "";
    this.streakLen = 0;
    this.pendingFind = false;
    this.lastFind = "";
    this.tip = null;
    this.tipTtl = 0;
  }

  observe(token: KeyToken, ctx: RemapContext): void {
    if (!this.enabled) return;

    // The one literal we care about: the char argument of a pending f/F/t/T.
    if (this.pendingFind) {
      this.pendingFind = false;
      const find = this.streakKey + token; // streakKey holds the find key itself
      if (find.length === 2 && find === this.lastFind && (find[0] === "f" || find[0] === "F")) {
        this.suggest("find-repeat", `you retyped ${find} — ; repeats your last find`);
      }
      this.lastFind = find;
      this.streakKey = "";
      this.streakLen = 0;
      return;
    }

    // Typing text or entering a : / search line is not a habit signal.
    if (ctx !== "normal") {
      this.streakKey = "";
      this.streakLen = 0;
      return;
    }

    if (FIND_KEYS.has(token)) {
      this.pendingFind = true;
      this.streakKey = token; // stash the find key for the arg step
      this.streakLen = 0;
      return;
    }

    const norm = ARROW_TO_LETTER[token] ?? token;
    if (norm === this.streakKey) this.streakLen++;
    else {
      this.streakKey = norm;
      this.streakLen = 1;
    }

    if (STEP_KEYS.has(norm) || ARROW_TO_LETTER[token]) this.checkStepCrawl(norm);
    else if (WORD_KEYS.has(norm)) this.checkCountlessMotion(norm);
    else if (norm === "x") this.checkXSpam();
  }

  private checkStepCrawl(key: string): void {
    const n = this.streakLen;
    if (key === "h" || key === "l") {
      if (n === 7) {
        this.suggest(
          "crawl-h-l",
          `${n}×${key} is a crawl — f{char} lands in one hop, or try ${n}${key}`,
        );
      }
    } else if (n === 6) {
      this.suggest("crawl-j-k", `${n}×${key} — counts work on every motion: ${n}${key} is one move`);
    }
  }

  private checkCountlessMotion(key: string): void {
    if (this.streakLen === 4) {
      this.suggest("countless-word", `${this.streakLen}×${key} — a count does that in one: ${this.streakLen}${key}`);
    }
  }

  private checkXSpam(): void {
    if (this.streakLen === 4) {
      this.suggest("x-spam", "x-x-x-x — dw eats a whole word, D to end of line");
    }
  }

  private suggest(habitId: string, text: string): void {
    const now = this.clock;
    if (now - this.lastTipAt < GLOBAL_COOLDOWN) return;
    if (now - (this.habitLastAt.get(habitId) ?? -Infinity) < HABIT_COOLDOWN) return;
    this.lastTipAt = now;
    this.habitLastAt.set(habitId, now);
    this.tip = { id: habitId, text };
    this.tipTtl = TIP_SECONDS;
  }
}
