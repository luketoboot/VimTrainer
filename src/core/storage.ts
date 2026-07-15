// localStorage-backed persistence: high scores, unlocked levels, settings.
// Everything is namespaced under one key and fails soft if storage is unavailable.

import { DEFAULT_KEYBINDS, type KeybindSettings } from "./keybinds.ts";

export interface Settings {
  volume: number;
  musicVolume: number;
  scanlines: boolean;
  bloom: number; // CRT phosphor glow, 0 (off) .. 1 (full Vectrex)
  screenScale: number; // CRT size zoom, 0.7 .. 1.5 (1 = default)
  theme: "green" | "amber";
  keybinds: KeybindSettings;
}

export interface SaveData {
  version: number; // bump when a migration is needed (see read())
  settings: Settings;
  highScores: Record<string, number>; // levelId -> best score
  stars: Record<string, number>; // levelId -> 0..3
  unlocked: Record<string, boolean>;
}

const KEY = "vimtrainer.save.v1";

const DEFAULT: SaveData = {
  version: 2,
  settings: {
    volume: 0.5,
    musicVolume: 0.6,
    scanlines: true,
    bloom: 0.4,
    screenScale: 1,
    theme: "green",
    keybinds: { ...DEFAULT_KEYBINDS },
  },
  highScores: {},
  stars: {},
  unlocked: {},
};

function read(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredCloneSafe(DEFAULT);
    const parsed = JSON.parse(raw) as Partial<SaveData>;
    const base = structuredCloneSafe(DEFAULT); // fresh objects — never share DEFAULT's references
    const data: SaveData = {
      ...base,
      ...parsed,
      settings: {
        ...base.settings,
        ...parsed.settings,
        // Deep-merge so saves from before the keybinds feature pick up defaults.
        keybinds: { ...base.settings.keybinds, ...parsed.settings?.keybinds },
      },
    };
    // v1 -> v2: music defaults ON. v1-era saves could end up with the music
    // dial stuck at 0 (from debugging silent-audio issues before the autoplay
    // fix); rescue those once. A deliberate 0 set after v2 is respected.
    if ((parsed.version ?? 1) < 2 && data.settings.musicVolume === 0) {
      data.settings.musicVolume = base.settings.musicVolume;
    }
    data.version = DEFAULT.version;
    return data;
  } catch {
    return structuredCloneSafe(DEFAULT);
  }
}

function write(data: SaveData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* storage disabled — run in-memory only */
  }
}

function structuredCloneSafe(d: SaveData): SaveData {
  return JSON.parse(JSON.stringify(d)) as SaveData;
}

export const Storage = {
  load: read,
  save: write,

  getSettings(): Settings {
    return read().settings;
  },
  setSettings(s: Partial<Settings>): void {
    const d = read();
    d.settings = { ...d.settings, ...s };
    write(d);
  },

  /** Returns true if this is a new best. */
  recordScore(levelId: string, score: number, stars: number): boolean {
    const d = read();
    const prev = d.highScores[levelId] ?? 0;
    const isBest = score > prev;
    if (isBest) d.highScores[levelId] = score;
    d.stars[levelId] = Math.max(d.stars[levelId] ?? 0, stars);
    write(d);
    return isBest;
  },

  getHighScore(levelId: string): number {
    return read().highScores[levelId] ?? 0;
  },
  getStars(levelId: string): number {
    return read().stars[levelId] ?? 0;
  },
  isUnlocked(levelId: string): boolean {
    return read().unlocked[levelId] ?? false;
  },
  unlock(levelId: string): void {
    const d = read();
    d.unlocked[levelId] = true;
    write(d);
  },
};
