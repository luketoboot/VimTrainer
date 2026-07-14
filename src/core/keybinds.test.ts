import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_KEYBINDS,
  KeyRemapper,
  PRESETS,
  contextForEngine,
  effectiveMap,
  engineWantsEsc,
  type KeybindSettings,
  type RemapContext,
} from "./keybinds.ts";
import { normalizeKeyEvent } from "../engine/keymap.ts";
import { VimEngine } from "../engine/engine.ts";

function kb(overrides: Partial<KeybindSettings> = {}): KeybindSettings {
  return { ...DEFAULT_KEYBINDS, custom: {}, ...overrides };
}

function harness(settings: KeybindSettings, ctx: RemapContext = "normal") {
  const out: string[] = [];
  let context = ctx;
  const remapper = new KeyRemapper(
    () => settings,
    () => context,
    (t) => out.push(t),
  );
  return { out, remapper, setContext: (c: RemapContext) => (context = c) };
}

describe("presets", () => {
  it("every preset map is a bijection — no two keys collapse onto one command", () => {
    for (const p of PRESETS) {
      const targets = Object.values(p.map);
      expect(new Set(targets).size).toBe(targets.length);
    }
  });

  it("colemak preset restores hjkl under the fingers (hnei)", () => {
    const m = effectiveMap(kb({ preset: "colemak" }));
    expect([m["n"], m["e"], m["i"]]).toEqual(["j", "k", "l"]);
    expect(m["u"]).toBe("i"); // insert relocated
  });

  it("dvorak preset maps dhtn to hjkl", () => {
    const m = effectiveMap(kb({ preset: "dvorak" }));
    expect([m["d"], m["h"], m["t"], m["n"]]).toEqual(["h", "j", "k", "l"]);
  });

  it("custom binds win over the preset", () => {
    const m = effectiveMap(kb({ preset: "colemak", custom: { n: "G" } }));
    expect(m["n"]).toBe("G");
  });

  it("swapColon swaps ; and : both ways", () => {
    const m = effectiveMap(kb({ swapColon: true }));
    expect(m[";"]).toBe(":");
    expect(m[":"]).toBe(";");
  });
});

describe("KeyRemapper", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("passes tokens through untouched on the standard preset", () => {
    const h = harness(kb());
    for (const t of ["h", "j", "w", "<Esc>", "$"]) h.remapper.feed(t);
    expect(h.out).toEqual(["h", "j", "w", "<Esc>", "$"]);
  });

  it("applies the normal-mode map", () => {
    const h = harness(kb({ preset: "colemak" }));
    h.remapper.feed("n");
    h.remapper.feed("h");
    expect(h.out).toEqual(["j", "h"]);
  });

  it("never remaps in literal context (f{char}, : line)", () => {
    const h = harness(kb({ preset: "colemak", swapColon: true }), "literal");
    h.remapper.feed("n");
    h.remapper.feed(";");
    expect(h.out).toEqual(["n", ";"]);
  });

  it("does not apply normal-mode maps in insert mode", () => {
    const h = harness(kb({ preset: "colemak" }), "insert");
    h.remapper.feed("n");
    expect(h.out).toEqual(["n"]);
  });

  it("jk in insert mode becomes Esc", () => {
    const h = harness(kb({ insertEsc: "jk" }), "insert");
    h.remapper.feed("j");
    expect(h.out).toEqual([]); // j held
    h.remapper.feed("k");
    expect(h.out).toEqual(["<Esc>"]);
  });

  it("a lone j is delivered after the timeout", () => {
    const h = harness(kb({ insertEsc: "jk" }), "insert");
    h.remapper.feed("j");
    vi.advanceTimersByTime(400);
    expect(h.out).toEqual(["j"]);
  });

  it("j followed by another letter types both", () => {
    const h = harness(kb({ insertEsc: "both" }), "insert");
    h.remapper.feed("j");
    h.remapper.feed("a");
    expect(h.out).toEqual(["j", "a"]);
  });

  it("jj escapes only when enabled; under jk-only the first j flushes", () => {
    const h = harness(kb({ insertEsc: "jk" }), "insert");
    h.remapper.feed("j");
    h.remapper.feed("j");
    expect(h.out).toEqual(["j"]); // first delivered, second held
    h.remapper.feed("k");
    expect(h.out).toEqual(["j", "<Esc>"]);
  });

  it("leaving insert context flushes a held j", () => {
    const h = harness(kb({ insertEsc: "jj" }), "insert");
    h.remapper.feed("j");
    h.setContext("normal");
    h.remapper.feed("k");
    expect(h.out).toEqual(["j", "k"]);
  });
});

describe("engine context helpers", () => {
  it("reports literal while f awaits its char and during : entry", () => {
    const e = new VimEngine();
    e.load(["alpha beta"], { row: 0, col: 0 });
    expect(contextForEngine(e)).toBe("normal");
    e.feedKey("f");
    expect(contextForEngine(e)).toBe("literal");
    e.feedKey("b"); // completes the find
    expect(contextForEngine(e)).toBe("normal");
    e.feedKey(":");
    expect(contextForEngine(e)).toBe("literal");
  });

  it("reports insert in insert mode", () => {
    const e = new VimEngine();
    e.load(["alpha"], { row: 0, col: 0 });
    e.feedKey("i");
    expect(contextForEngine(e)).toBe("insert");
  });

  it("engineWantsEsc: true in insert / pending / cmdline, false when idle", () => {
    const e = new VimEngine();
    e.load(["alpha beta"], { row: 0, col: 0 });
    expect(engineWantsEsc(e)).toBe(false);
    e.feedKey("i");
    expect(engineWantsEsc(e)).toBe(true);
    e.feedKey("<Esc>");
    expect(engineWantsEsc(e)).toBe(false);
    e.feedKey("d"); // pending operator
    expect(engineWantsEsc(e)).toBe(true);
    e.feedKey("<Esc>");
    e.feedKey("2"); // pending count
    expect(engineWantsEsc(e)).toBe(true);
  });
});

describe("caps lock as Esc", () => {
  function fakeEvent(key: string, opts: { ctrl?: boolean; shift?: boolean; caps?: boolean } = {}) {
    return {
      key,
      ctrlKey: opts.ctrl ?? false,
      metaKey: false,
      shiftKey: opts.shift ?? false,
      getModifierState: (m: string) => (m === "CapsLock" ? opts.caps ?? false : false),
    } as unknown as KeyboardEvent;
  }

  it("CapsLock emits Esc when enabled, nothing when off", () => {
    expect(normalizeKeyEvent(fakeEvent("CapsLock"), { capsEsc: true })).toBe("<Esc>");
    expect(normalizeKeyEvent(fakeEvent("CapsLock"))).toBeNull();
  });

  it("compensates letter case while the OS lock state is on", () => {
    // Caps on, no shift: browser reports "H" but the finger meant "h".
    expect(normalizeKeyEvent(fakeEvent("H", { caps: true }), { capsEsc: true })).toBe("h");
    // Caps on + shift: browser reports "h" but the finger meant "H".
    expect(normalizeKeyEvent(fakeEvent("h", { caps: true, shift: true }), { capsEsc: true })).toBe("H");
    // Feature off: report what the browser said.
    expect(normalizeKeyEvent(fakeEvent("H", { caps: true }))).toBe("H");
  });
});
