import { beforeEach, describe, expect, it } from "vitest";
import { Storage } from "./storage.ts";

// Minimal localStorage stand-in for the node test environment.
const backing = new Map<string, string>();
beforeEach(() => {
  backing.clear();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => backing.get(k) ?? null,
    setItem: (k: string, v: string) => void backing.set(k, v),
    removeItem: (k: string) => void backing.delete(k),
  };
});

const KEY = "vimtrainer.save.v1";

describe("save migration", () => {
  it("fresh installs default to music on", () => {
    expect(Storage.getSettings().musicVolume).toBeGreaterThan(0);
  });

  it("v1 saves with music stuck at 0 are rescued to the default", () => {
    backing.set(KEY, JSON.stringify({ version: 1, settings: { musicVolume: 0, volume: 0.8 } }));
    const s = Storage.getSettings();
    expect(s.musicVolume).toBeGreaterThan(0); // rescued
    expect(s.volume).toBe(0.8); // everything else untouched
  });

  it("a deliberate music-off on a v2 save is respected", () => {
    backing.set(KEY, JSON.stringify({ version: 2, settings: { musicVolume: 0 } }));
    expect(Storage.getSettings().musicVolume).toBe(0);
  });

  it("pre-music saves pick up the music default", () => {
    backing.set(KEY, JSON.stringify({ version: 1, settings: { volume: 0.3 } }));
    expect(Storage.getSettings().musicVolume).toBeGreaterThan(0);
  });

  it("writing persists version 2 so the rescue never repeats", () => {
    backing.set(KEY, JSON.stringify({ version: 1, settings: { musicVolume: 0 } }));
    Storage.setSettings({}); // any write re-serializes the migrated save
    const stored = JSON.parse(backing.get(KEY)!) as { version: number };
    expect(stored.version).toBe(2);
  });
});
