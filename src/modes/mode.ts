// Contract shared by every game mode. The app owns the services (renderer + juice)
// and drives each mode's lifecycle; modes never touch the DOM directly.

import type { KeyToken } from "../engine/keymap.ts";
import type { RemapContext } from "../core/keybinds.ts";
import type { TerminalRenderer } from "../render/terminal.ts";
import type { ScreenShake } from "../juice/shake.ts";
import type { ParticlePool } from "../juice/particles.ts";
import type { Flash } from "../juice/flash.ts";
import type { HitStop } from "../juice/hitstop.ts";
import type { AudioFx } from "../juice/audio.ts";
import type { Coach } from "../core/coach.ts";

export interface GameServices {
  term: TerminalRenderer;
  shake: ScreenShake;
  particles: ParticlePool;
  flash: Flash;
  hitstop: HitStop;
  audio: AudioFx;
  coach: Coach;
}

export interface ModeResult {
  levelId: string;
  title: string;
  score: number;
  stars: number; // 0..3
  lines: string[]; // summary lines to show on the result screen
}

export interface GameMode {
  init(): void;
  handleKey(token: KeyToken): void;
  /** Current Vim input context, so the key-remap layer can be mode-aware
   *  (insert-only escapes, no remaps during f{char}/:cmd entry). Treated as
   *  "normal" when absent. */
  remapContext?(): RemapContext;
  /** True when Esc means something to the engine right now (leave insert,
   *  cancel a pending operator/cmdline) — the app then feeds Esc through
   *  instead of quitting the run. Treated as false when absent. */
  wantsEsc?(): boolean;
  /** Called each fixed step unless gameplay is frozen by hit-stop. */
  update(dt: number): void;
  render(): void;
  readonly done: boolean;
  getResult(): ModeResult | null;
}
