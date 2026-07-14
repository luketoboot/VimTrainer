// Custom key bindings: a remap layer that sits between raw input and the Vim
// engine, mirroring how real users remap Vim. Supports the popular presets
// (researched from vim.fandom, jooize/vim-colemak, community threads) plus
// arbitrary user-defined single-key maps.
//
// Faithful to real Vim semantics:
//  - normal/visual maps never apply in insert mode (like nnoremap)
//  - nothing is remapped while the engine awaits a literal char argument
//    (f{char}, r{char}, m{mark}, "{reg}, q{reg}...) or during : / search entry
//  - jj/jk escapes apply only in insert mode (like inoremap), with a timeout
//    so a lone `j` still types after a beat

import type { KeyToken } from "../engine/keymap.ts";

export type PresetId = "standard" | "colemak" | "dvorak";
export type InsertEsc = "off" | "jj" | "jk" | "both";

export interface KeybindSettings {
  preset: PresetId;
  capsEsc: boolean; // Caps Lock acts as Esc
  insertEsc: InsertEsc; // jj / jk in insert mode -> Esc
  swapColon: boolean; // ; <-> : (ex commands without Shift)
  custom: Record<string, string>; // token -> token, normal/visual only
}

export const DEFAULT_KEYBINDS: KeybindSettings = {
  preset: "standard",
  capsEsc: false,
  insertEsc: "off",
  swapColon: false,
  custom: {},
};

/** What the remapper needs to know about the current engine state. */
export type RemapContext =
  | "normal" // normal/visual/operator-pending — full remaps apply
  | "insert" // only the insert-escape sequences apply
  | "literal"; // cmdline or char-argument entry — nothing is remapped

export interface Preset {
  id: PresetId;
  name: string;
  /** Why people use it — shown in the settings UI. */
  why: string;
  map: Record<string, string>;
}

export const PRESETS: Preset[] = [
  {
    id: "standard",
    name: "STANDARD",
    why: "Vim as shipped. The trainer teaches these defaults — start here.",
    map: {},
  },
  {
    id: "colemak",
    name: "COLEMAK (HNEI)",
    why:
      "For Colemak typists: the QWERTY hjkl positions type h n e i, so this keeps " +
      "arrows under your fingers (jooize/vim-colemak style). Displaced keys rotate: " +
      "j=end-of-word  k=next-match  u=insert  l=undo.",
    // Cycles (n j e k) and (i u l): pressing the key on the LEFT performs the
    // Vim command on the RIGHT.
    map: { n: "j", e: "k", i: "l", j: "e", k: "n", u: "i", l: "u" },
  },
  {
    id: "dvorak",
    name: "DVORAK (DHTN)",
    why:
      "For Dvorak typists: the QWERTY hjkl positions type d h t n, so dhtn becomes " +
      "left/down/up/right (vim.fandom's classic config). Displaced keys: " +
      "j=delete  k=till  l=next-match.",
    // Cycle (d h j) and swaps (t k), (n l).
    map: { d: "h", h: "j", t: "k", n: "l", j: "d", k: "t", l: "n" },
  },
];

export function getPreset(id: PresetId): Preset {
  return PRESETS.find((p) => p.id === id) ?? PRESETS[0]!;
}

const COLON_SWAP: Record<string, string> = { ";": ":", ":": ";" };

/** The single effective normal-mode map: preset, then ;-swap, then user custom. */
export function effectiveMap(kb: KeybindSettings): Record<string, string> {
  return {
    ...getPreset(kb.preset).map,
    ...(kb.swapColon ? COLON_SWAP : {}),
    ...kb.custom,
  };
}

/** Derive the remap context from a live engine — shared by every game mode. */
export function contextForEngine(engine: { awaitingLiteral: boolean; mode: string }): RemapContext {
  if (engine.awaitingLiteral) return "literal";
  return engine.mode === "insert" ? "insert" : "normal";
}

/** Whether the engine itself has a use for Esc right now — insert/visual mode,
 *  a pending operator/count, or cmdline entry. If so, the app must feed Esc to
 *  the engine instead of treating it as "quit the run". */
export function engineWantsEsc(engine: {
  mode: string;
  awaitingLiteral: boolean;
  getView(): { pending: string };
}): boolean {
  return engine.mode !== "normal" || engine.awaitingLiteral || engine.getView().pending !== "";
}

const SEQ_TIMEOUT_MS = 350; // vim's timeoutlen spirit, tuned snappy for a game

/**
 * Stateful remapper. Feed raw tokens in; it emits remapped tokens to `sink`
 * (usually 1:1, but insert-escape sequences may hold a `j` briefly).
 */
export class KeyRemapper {
  private pendingJ = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private kb: () => KeybindSettings,
    private ctx: () => RemapContext,
    private sink: (token: KeyToken) => void,
  ) {}

  feed(token: KeyToken): void {
    const context = this.ctx();

    // Anything but insert mode cancels a pending escape-sequence j.
    if (context !== "insert") this.flushPending();

    if (context === "literal") {
      this.sink(token); // arguments to f/r/m/:/… are always literal
      return;
    }

    if (context === "insert") {
      this.feedInsert(token);
      return;
    }

    const mapped = effectiveMap(this.kb())[token];
    this.sink(mapped ?? token);
  }

  private feedInsert(token: KeyToken): void {
    const seq = this.kb().insertEsc;
    if (seq === "off") {
      this.sink(token);
      return;
    }
    if (this.pendingJ) {
      this.clearTimer();
      this.pendingJ = false;
      const jj = token === "j" && (seq === "jj" || seq === "both");
      const jk = token === "k" && (seq === "jk" || seq === "both");
      if (jj || jk) {
        this.sink("<Esc>");
        return;
      }
      this.sink("j"); // the held j was just a j — deliver it, then handle token
    }
    if (token === "j") {
      this.pendingJ = true;
      this.timer = setTimeout(() => this.flushPending(), SEQ_TIMEOUT_MS);
      return;
    }
    this.sink(token);
  }

  /** Deliver a held `j` immediately (timeout fired, or context changed). */
  flushPending(): void {
    this.clearTimer();
    if (this.pendingJ) {
      this.pendingJ = false;
      this.sink("j");
    }
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
